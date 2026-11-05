"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireAction } from "@/lib/auth";
import { getBilling, invoicePrefix, invoiceUrl, nextInvoiceNumber, publicToken, refreshPaid } from "@/lib/billing";
import { PAYMENT_METHODS, parseTaka, taka, totals } from "@/lib/money";
import { normalizeEmail, sendEmail } from "@/lib/email";
import { normalizeBdMobile } from "@/lib/sms-text";
import { waSend } from "@/lib/wa";

export type FormState = { error?: string; ok?: string } | undefined;

const W = schema.workspaces;
const K = schema.clients;
const I = schema.invoices;
const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

/* ---------------------------------------------------------------- business profile */

const billingSchema = z.object({
  legalName: opt(120),
  address: opt(400),
  phone: opt(40),
  email: opt(120),
  website: opt(200),
  paymentInfo: opt(1000),
  invoicePrefix: opt(12),
  defaultTerms: opt(1000),
  dueDays: z.coerce.number().int().min(0).max(120).default(7),
  bkashNumber: opt(20),
  bkashType: z.enum(["personal", "merchant", "agent"]).default("personal"),
  nagadNumber: opt(20),
  bankDetails: opt(600),
  shareDiscountPercent: z.coerce.number().int().min(0).max(50).default(10)
});

export async function saveBilling(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireAction("business");
  const p = billingSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const b = Object.fromEntries(Object.entries(p.data).filter(([, v]) => v !== null));
  await db.update(W).set({ billing: b }).where(eq(W.id, user.workspaceId));
  revalidatePath("/settings");
  return { ok: "Saved — new invoices will use these details" };
}

/* ---------------------------------------------------------------- clients */

const clientSchema = z.object({
  name: z.string().trim().min(2, "Enter the business name").max(160),
  contactName: opt(120),
  phone: opt(40),
  email: opt(160),
  address: opt(400),
  website: opt(200),
  notes: opt(4000),
  status: z.enum(["active", "paused", "past"]).default("active")
});

export async function saveClient(id: number | null, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireAction("clients");
  const p = clientSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const d = p.data;
  if (d.email && !normalizeEmail(d.email)) return { error: "That email address doesn't look right" };
  if (id) {
    await db
      .update(K)
      .set({ ...d, updatedAt: new Date() })
      .where(and(eq(K.id, id), eq(K.workspaceId, user.workspaceId)));
    revalidatePath(`/clients/${id}`);
    return { ok: "Saved" };
  }
  const [c] = await db
    .insert(K)
    .values({ ...d, workspaceId: user.workspaceId })
    .returning({ id: K.id });
  redirect(`/clients/${c.id}`);
}

/** Turns a lead into a client (or opens the existing one) and marks the lead Won. */
export async function convertLead(leadId: number) {
  const user = await requireAction("clients");
  const L = schema.leads;
  const [lead] = await db
    .select()
    .from(L)
    .where(and(eq(L.id, leadId), eq(L.workspaceId, user.workspaceId)))
    .limit(1);
  if (!lead) return;
  const [existing] = await db
    .select({ id: K.id })
    .from(K)
    .where(and(eq(K.workspaceId, user.workspaceId), eq(K.leadId, leadId)))
    .limit(1);
  let id = existing?.id;
  if (!id) {
    [{ id }] = await db
      .insert(K)
      .values({
        workspaceId: user.workspaceId,
        leadId,
        name: lead.pageName ?? "New client",
        phone: lead.whatsapp || lead.phone,
        email: normalizeEmail(lead.email),
        address: lead.address,
        website: lead.website ?? lead.pageLink
      })
      .returning({ id: K.id });
    await db.update(L).set({ status: "won", updatedAt: new Date() }).where(eq(L.id, leadId));
    await db.insert(schema.leadActivities).values({ workspaceId: user.workspaceId, leadId, userId: user.id, type: "status", body: "Became a client (Won)" });
  }
  redirect(`/clients/${id}`);
}

/* ---------------------------------------------------------------- invoices */

const lineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().int().min(1).max(100000),
  unitPrice: z.string()
});

async function ownedInvoice(id: number, workspaceId: number) {
  const [inv] = await db
    .select()
    .from(I)
    .where(and(eq(I.id, id), eq(I.workspaceId, workspaceId)))
    .limit(1);
  return inv ?? null;
}

/** Creates or updates an invoice with its lines. Paid and void invoices are locked. */
export async function saveInvoice(id: number | null, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireAction("invoices");
  const clientId = Number(formData.get("clientId"));
  const [client] = await db
    .select({ id: K.id })
    .from(K)
    .where(and(eq(K.id, clientId), eq(K.workspaceId, user.workspaceId)))
    .limit(1);
  if (!client) return { error: "Choose a client" };

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "Could not read the line items" };
  }
  const parsedLines = z.array(lineSchema).min(1, "Add at least one line").max(100).safeParse(rawLines);
  if (!parsedLines.success) return { error: parsedLines.error.issues[0]?.message ?? "Check the line items" };
  const lines = [];
  for (const l of parsedLines.data) {
    const unitPrice = parseTaka(l.unitPrice);
    if (unitPrice == null) return { error: `Price for “${l.description}” isn't a valid amount` };
    lines.push({ description: l.description, quantity: l.quantity, unitPrice });
  }
  const discount = parseTaka(String(formData.get("discount") || "0"));
  if (discount == null) return { error: "Discount isn't a valid amount" };
  const t = totals(lines, discount);

  const issueDate = new Date(String(formData.get("issueDate") || ""));
  const dueRaw = String(formData.get("dueDate") || "");
  const dueDate = dueRaw ? new Date(dueRaw) : null;
  if (Number.isNaN(issueDate.getTime()) || (dueDate && Number.isNaN(dueDate.getTime()))) return { error: "Check the dates" };
  const notes =
    String(formData.get("notes") ?? "")
      .trim()
      .slice(0, 2000) || null;
  const terms =
    String(formData.get("terms") ?? "")
      .trim()
      .slice(0, 2000) || null;
  const fields = { clientId, issueDate, dueDate, notes, terms, ...t, updatedAt: new Date() };

  let invoiceId = id;
  if (id) {
    const inv = await ownedInvoice(id, user.workspaceId);
    if (!inv) return { error: "Invoice not found" };
    if (inv.status === "void" || (inv.amountPaid > 0 && inv.amountPaid >= inv.total)) return { error: "Paid or void invoices can't be edited" };
    if (t.total < inv.amountPaid) return { error: `Total can't be less than what's already paid (${taka(inv.amountPaid)})` };
    await db.update(I).set(fields).where(eq(I.id, id));
    await db.delete(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, id));
  } else {
    const { billing } = await getBilling(user.workspaceId);
    const prefix = invoicePrefix(billing);
    // Two people saving at once could pick the same number: retry with the next one.
    for (let attempt = 0; attempt < 5 && !invoiceId; attempt++) {
      const number = await nextInvoiceNumber(user.workspaceId, prefix);
      const [row] = await db
        .insert(I)
        .values({ ...fields, workspaceId: user.workspaceId, number, publicToken: publicToken(), createdBy: user.id })
        .onConflictDoNothing()
        .returning({ id: I.id });
      invoiceId = row?.id ?? null;
    }
    if (!invoiceId) return { error: "Could not number the invoice — try again" };
  }
  await db
    .insert(schema.invoiceItems)
    .values(
      lines.map((l, i) => ({
        invoiceId: invoiceId!,
        position: i,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        amount: l.quantity * l.unitPrice
      }))
    );
  revalidatePath("/invoices");
  redirect(`/invoices/${invoiceId}`);
}

export async function setInvoiceStatus(id: number, status: "sent" | "void" | "draft") {
  const user = await requireAction("invoices");
  const inv = await ownedInvoice(id, user.workspaceId);
  if (!inv) return;
  if (status === "draft" && inv.amountPaid > 0) return;
  await db
    .update(I)
    .set({ status, sentAt: status === "sent" ? (inv.sentAt ?? new Date()) : inv.sentAt, updatedAt: new Date() })
    .where(eq(I.id, id));
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
}

export async function deleteDraft(id: number) {
  const user = await requireAction("invoices");
  const inv = await ownedInvoice(id, user.workspaceId);
  if (!inv || inv.status !== "draft" || inv.amountPaid > 0) return;
  await db.delete(I).where(eq(I.id, id));
  revalidatePath("/invoices");
  redirect("/invoices");
}

export async function duplicateInvoice(id: number) {
  const user = await requireAction("invoices");
  const inv = await ownedInvoice(id, user.workspaceId);
  if (!inv) return;
  const items = await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, id)).orderBy(asc(schema.invoiceItems.position));
  const { billing } = await getBilling(user.workspaceId);
  const now = new Date();
  let newId: number | null = null;
  for (let attempt = 0; attempt < 5 && !newId; attempt++) {
    const [row] = await db
      .insert(I)
      .values({
        workspaceId: user.workspaceId,
        clientId: inv.clientId,
        number: await nextInvoiceNumber(user.workspaceId, invoicePrefix(billing)),
        issueDate: now,
        dueDate: new Date(now.getTime() + (billing.dueDays ?? 7) * 86_400_000),
        subtotal: inv.subtotal,
        discount: inv.discount,
        total: inv.total,
        notes: inv.notes,
        terms: inv.terms,
        publicToken: publicToken(),
        createdBy: user.id
      })
      .onConflictDoNothing()
      .returning({ id: I.id });
    newId = row?.id ?? null;
  }
  if (!newId) return;
  if (items.length)
    await db
      .insert(schema.invoiceItems)
      .values(items.map((it) => ({ invoiceId: newId!, position: it.position, description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, amount: it.amount })));
  redirect(`/invoices/${newId}/edit`);
}

/* ---------------------------------------------------------------- payments */

const paymentSchema = z.object({
  amount: z.string(),
  method: z.enum(Object.keys(PAYMENT_METHODS) as [string, ...string[]]),
  reference: opt(120),
  note: opt(500),
  paidAt: z.string().optional()
});

export async function recordPayment(invoiceId: number, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireAction("invoices");
  const inv = await ownedInvoice(invoiceId, user.workspaceId);
  if (!inv) return { error: "Invoice not found" };
  if (inv.status === "void") return { error: "This invoice is void" };
  const p = paymentSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const amount = parseTaka(p.data.amount);
  if (!amount) return { error: "Enter the amount received" };
  const paidAt = p.data.paidAt ? new Date(p.data.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) return { error: "Check the date" };
  await db.insert(schema.payments).values({
    workspaceId: user.workspaceId,
    invoiceId,
    amount,
    method: p.data.method,
    reference: p.data.reference,
    note: p.data.note,
    paidAt,
    createdBy: user.id
  });
  await refreshPaid(invoiceId);
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  return { ok: `Recorded ${taka(amount)}` };
}

export async function deletePayment(paymentId: number) {
  const user = await requireAction("invoices");
  const P = schema.payments;
  const [pay] = await db
    .delete(P)
    .where(and(eq(P.id, paymentId), eq(P.workspaceId, user.workspaceId)))
    .returning({ invoiceId: P.invoiceId });
  if (!pay) return;
  await refreshPaid(pay.invoiceId);
  revalidatePath(`/invoices/${pay.invoiceId}`);
}

/* ---------------------------------------------------------------- sending */

async function invoiceForSend(id: number, workspaceId: number) {
  const [row] = await db
    .select({ inv: I, client: K })
    .from(I)
    .innerJoin(K, eq(K.id, I.clientId))
    .where(and(eq(I.id, id), eq(I.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

const message = (name: string, business: string, number: string, due: number, url: string, sharePercent: number) =>
  `Assalamu Alaikum ${name},\n\nYour invoice ${number} from ${business} is ready. Amount due: ${taka(due)}.\n\nView it, pay with bKash and download it here:\n${url}` +
  (sharePercent > 0 ? `\n\n🎁 Share your new website on Facebook and get ${sharePercent}% off — details on the same page.` : "") +
  `\n\nThank you!\n${business}`;

export async function sendInvoice(id: number, channel: "email" | "whatsapp", _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireAction("invoices");
  const row = await invoiceForSend(id, user.workspaceId);
  if (!row) return { error: "Invoice not found" };
  const { inv, client } = row;
  if (inv.status === "void") return { error: "This invoice is void" };
  const { name: wsName, billing } = await getBilling(user.workspaceId);
  const business = billing.legalName || wsName;
  const text = message(
    client.contactName || client.name,
    business,
    inv.number,
    inv.total - inv.amountPaid,
    invoiceUrl(inv.publicToken),
    billing.shareDiscountPercent ?? 0
  );
  const to = String(formData.get("to") ?? "").trim();

  if (channel === "email") {
    const addr = normalizeEmail(to);
    if (!addr) return { error: "Enter the client's email" };
    const [sender] = await db
      .select()
      .from(schema.emailSenders)
      .where(eq(schema.emailSenders.workspaceId, user.workspaceId))
      .orderBy(asc(schema.emailSenders.id))
      .limit(1);
    if (!sender) return { error: "Add an email sender in Channels first" };
    const res = await sendEmail(sender, { to: addr, subject: `Invoice ${inv.number} from ${business}`, text });
    if (!res.ok) return { error: `Not sent — ${res.info}` };
  } else {
    const phone = normalizeBdMobile(to);
    if (!phone) return { error: "Enter the client's mobile number" };
    const res = await waSend(phone, text);
    if (!res.ok)
      return { error: res.result === "disconnected" ? "WhatsApp isn't connected — scan the QR in Channels" : `Not sent — ${res.info ?? res.result}` };
  }
  await db
    .update(I)
    .set({ status: inv.status === "draft" ? "sent" : inv.status, sentAt: new Date(), updatedAt: new Date() })
    .where(eq(I.id, id));
  revalidatePath(`/invoices/${id}`);
  return { ok: `Sent by ${channel === "email" ? "email" : "WhatsApp"}` };
}

/* ---------------------------------------------------------------- client submissions */

/**
 * Approve or reject what a client sent from the invoice link.
 * Payment → becomes a real payment. Share → the share discount is taken off the invoice.
 */
export async function reviewSubmission(id: number, decision: "approve" | "reject"): Promise<FormState> {
  const user = await requireAction("invoices");
  const S = schema.invoiceSubmissions;
  const [sub] = await db
    .select()
    .from(S)
    .where(and(eq(S.id, id), eq(S.workspaceId, user.workspaceId)))
    .limit(1);
  if (!sub || sub.status !== "pending") return { error: "Already handled" };
  const row = await invoiceForSend(sub.invoiceId, user.workspaceId);
  if (!row) return { error: "Invoice not found" };
  const { inv, client } = row;
  const { name: wsName, billing } = await getBilling(user.workspaceId);
  const business = billing.legalName || wsName;
  const link = invoiceUrl(inv.publicToken);
  let note = "";

  if (decision === "approve" && sub.kind === "payment") {
    const [pay] = await db
      .insert(schema.payments)
      .values({
        workspaceId: user.workspaceId,
        invoiceId: inv.id,
        amount: sub.amount ?? 0,
        method: sub.method ?? "bkash",
        reference: sub.reference,
        note: "Sent by the client from the invoice link",
        createdBy: user.id
      })
      .returning({ id: schema.payments.id });
    await refreshPaid(inv.id);
    await db.update(S).set({ status: "approved", reviewedAt: new Date(), paymentId: pay.id }).where(eq(S.id, id));
    const paidNow = inv.amountPaid + (sub.amount ?? 0);
    note =
      paidNow >= inv.total
        ? `Your payment of ${taka(sub.amount ?? 0)} for invoice ${inv.number} is confirmed — it's now paid in full. Thank you!`
        : `Your payment of ${taka(sub.amount ?? 0)} for invoice ${inv.number} is confirmed. Remaining: ${taka(inv.total - paidNow)}.`;
  } else if (decision === "approve" && sub.kind === "share") {
    const percent = billing.shareDiscountPercent ?? 10;
    const extra = Math.round((inv.subtotal * percent) / 100);
    const discount = Math.min(inv.subtotal, inv.discount + extra);
    const total = inv.subtotal - discount;
    if (total < inv.amountPaid) return { error: "It's already paid — give the discount on the next invoice instead" };
    await db
      .update(I)
      .set({
        discount,
        total,
        notes: [inv.notes, `${percent}% share discount applied — thank you for sharing!`].filter(Boolean).join("\n"),
        updatedAt: new Date()
      })
      .where(eq(I.id, inv.id));
    await refreshPaid(inv.id);
    await db.update(S).set({ status: "approved", reviewedAt: new Date() }).where(eq(S.id, id));
    note = `Thanks for sharing! We've taken ${percent}% (${taka(extra)}) off invoice ${inv.number}. New amount due: ${taka(Math.max(0, total - inv.amountPaid))}.`;
  } else {
    await db.update(S).set({ status: "rejected", reviewedAt: new Date() }).where(eq(S.id, id));
    note =
      sub.kind === "payment"
        ? `We couldn't find your payment${sub.reference ? ` (TrxID ${sub.reference})` : ""} for invoice ${inv.number}. Please check and send it again from the invoice link, or reply to this email.`
        : "";
  }

  const to = sub.payerEmail ?? client.email;
  if (note && to) {
    const [sender] = await db
      .select()
      .from(schema.emailSenders)
      .where(eq(schema.emailSenders.workspaceId, user.workspaceId))
      .orderBy(asc(schema.emailSenders.id))
      .limit(1);
    if (sender) {
      await sendEmail(sender, {
        to,
        subject: decision === "approve" && sub.kind === "payment" ? `Payment confirmed — invoice ${inv.number}` : `Invoice ${inv.number} — update`,
        text: `Assalamu Alaikum ${client.contactName || client.name},\n\n${note}\n\nView or download your invoice:\n${link}\n\n${business}`
      }).catch(() => null);
    }
  }
  revalidatePath(`/invoices/${inv.id}`);
  revalidatePath("/invoices");
  return { ok: decision === "approve" ? "Approved" : "Rejected" };
}
