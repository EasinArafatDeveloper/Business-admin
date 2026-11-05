import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getBilling, invoiceUrl } from "@/lib/billing";
import { sendEmail } from "@/lib/email";
import { taka } from "@/lib/money";

const I = schema.invoices;

export const tokenOk = (t: string) => /^[A-Za-z0-9_-]{20,40}$/.test(t);

/** Everything the public invoice page needs, found by the secret link token. */
export async function loadPublicInvoice(token: string) {
  if (!tokenOk(token)) return null;
  const [row] = await db
    .select({ inv: I, client: schema.clients })
    .from(I)
    .innerJoin(schema.clients, eq(schema.clients.id, I.clientId))
    .where(eq(I.publicToken, token))
    .limit(1);
  if (!row || row.inv.status === "draft") return null;
  const S = schema.invoiceSubmissions;
  const [items, payments, { name, billing }, submissions] = await Promise.all([
    db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, row.inv.id)).orderBy(asc(schema.invoiceItems.position)),
    db.select().from(schema.payments).where(eq(schema.payments.invoiceId, row.inv.id)).orderBy(asc(schema.payments.paidAt)),
    getBilling(row.inv.workspaceId),
    db
      .select({ id: S.id, kind: S.kind, status: S.status, amount: S.amount, reference: S.reference, shareUrl: S.shareUrl, createdAt: S.createdAt })
      .from(S)
      .where(eq(S.invoiceId, row.inv.id))
      .orderBy(desc(S.createdAt))
      .limit(20)
  ]);
  return { ...row, items, payments, business: billing.legalName || name, billing, submissions };
}

/** Small per-key limiter for the public forms (e.g. 8 submissions per hour per invoice + IP). */
const hits = new Map<string, number[]>();
export function allow(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) return false;
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

export const hashIp = (ip: string | null) => (ip ? createHash("sha256").update(ip).digest("hex").slice(0, 16) : null);

export function requestIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
}

/** The admin's own address for alerts: the business email, else the workspace owner. */
async function ownerEmail(workspaceId: number, billingEmail?: string) {
  if (billingEmail) return billingEmail;
  const [u] = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.workspaceId, workspaceId))
    .orderBy(asc(schema.users.id))
    .limit(1);
  return u?.email ?? null;
}

async function firstSender(workspaceId: number) {
  const [s] = await db.select().from(schema.emailSenders).where(eq(schema.emailSenders.workspaceId, workspaceId)).orderBy(asc(schema.emailSenders.id)).limit(1);
  return s ?? null;
}

/** Emails the client a copy of the invoice link, and alerts you to review. Never throws. */
export async function notifySubmission(opts: {
  workspaceId: number;
  invoiceId: number;
  number: string;
  token: string;
  business: string;
  billingEmail?: string;
  clientName: string;
  clientEmail: string | null;
  kind: "payment" | "share";
  amount?: number | null;
  reference?: string | null;
  shareUrl?: string | null;
}) {
  try {
    const sender = await firstSender(opts.workspaceId);
    if (!sender) return;
    const link = invoiceUrl(opts.token);
    if (opts.clientEmail) {
      const text =
        opts.kind === "payment"
          ? `Assalamu Alaikum ${opts.clientName},\n\nThank you! We received your payment details for invoice ${opts.number}${opts.amount ? ` (${taka(opts.amount)})` : ""}${opts.reference ? `, TrxID ${opts.reference}` : ""}.\n\nWe'll confirm it shortly. Your invoice — view or download it any time:\n${link}\n\nThank you for working with us!\n${opts.business}`
          : `Assalamu Alaikum ${opts.clientName},\n\nThank you for sharing about us! We'll check your post and apply your discount on invoice ${opts.number} shortly.\n\nYour invoice: ${link}\n\n${opts.business}`;
      await sendEmail(sender, {
        to: opts.clientEmail,
        subject: opts.kind === "payment" ? `Payment received — invoice ${opts.number}` : `Thanks for sharing — invoice ${opts.number}`,
        text
      });
    }
    const owner = await ownerEmail(opts.workspaceId, opts.billingEmail);
    if (owner) {
      const admin = `${new URL(link).origin}/invoices/${opts.invoiceId}`;
      await sendEmail(sender, {
        to: owner,
        subject:
          opts.kind === "payment"
            ? `💰 ${opts.clientName} sent ${opts.amount ? taka(opts.amount) : "a payment"} — ${opts.number}`
            : `📣 ${opts.clientName} shared a post — ${opts.number}`,
        text:
          opts.kind === "payment"
            ? `${opts.clientName} submitted a payment for ${opts.number}.\nAmount: ${opts.amount ? taka(opts.amount) : "—"}\nTrxID: ${opts.reference ?? "—"}\n\nCheck your bKash, then confirm it here:\n${admin}`
            : `${opts.clientName} says they shared a post about you:\n${opts.shareUrl}\n\nCheck it, then apply the discount here:\n${admin}`
      });
    }
  } catch (e) {
    console.error("[invoice] notify failed", e);
  }
}

/** Has this invoice got a payment or share waiting for review? */
export async function pendingFor(invoiceId: number) {
  const S = schema.invoiceSubmissions;
  return db
    .select()
    .from(S)
    .where(and(eq(S.invoiceId, invoiceId), eq(S.status, "pending")))
    .orderBy(desc(S.createdAt));
}
