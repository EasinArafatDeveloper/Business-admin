import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { normalizeEmail } from "@/lib/email";
import { parseTaka } from "@/lib/money";
import { allow, hashIp, loadPublicInvoice, notifySubmission, requestIp } from "@/lib/public-invoice";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];
const METHODS = ["bkash", "nagad", "bank"];

/**
 * The client tells us they paid: method, amount, TrxID and a screenshot.
 * Stored as "pending" — it only becomes a payment when you confirm it in the admin.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/public/invoice/[token]/pay">) {
  const { token } = await ctx.params;
  const ip = requestIp(req);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 200_000)
    return NextResponse.json({ error: "The screenshot is too big (5 MB max)" }, { status: 413 });
  if (!allow(`pay:${token}:${ip}`, 6, 3_600_000)) return NextResponse.json({ error: "Too many tries — wait a bit" }, { status: 429 });
  const data = await loadPublicInvoice(token);
  if (!data) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  const { inv, client } = data;
  if (inv.status === "void") return NextResponse.json({ error: "This invoice is cancelled" }, { status: 400 });
  const due = inv.total - inv.amountPaid;
  if (due <= 0) return NextResponse.json({ error: "This invoice is already paid" }, { status: 400 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Could not read the form" }, { status: 400 });
  const method = String(form.get("method") ?? "");
  const reference = String(form.get("reference") ?? "")
    .trim()
    .toUpperCase();
  const amount = parseTaka(String(form.get("amount") ?? ""));
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const phone = String(form.get("phone") ?? "")
    .trim()
    .slice(0, 40);
  const file = form.get("screenshot");

  if (!METHODS.includes(method)) return NextResponse.json({ error: "Choose how you paid" }, { status: 400 });
  if (!amount || amount > due) return NextResponse.json({ error: `Enter the amount you sent (up to ${due / 100})` }, { status: 400 });
  if (!/^[A-Z0-9-]{6,30}$/.test(reference)) return NextResponse.json({ error: "Enter the Transaction ID from the bKash message" }, { status: 400 });
  if (!email) return NextResponse.json({ error: "Enter your email to get the invoice" }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Attach the payment screenshot" }, { status: 400 });
  if (!TYPES.includes(file.type) || file.size > MAX_BYTES)
    return NextResponse.json({ error: "Screenshot must be a PNG/JPG image under 5 MB" }, { status: 400 });

  await db.insert(schema.invoiceSubmissions).values({
    workspaceId: inv.workspaceId,
    invoiceId: inv.id,
    kind: "payment",
    method,
    amount,
    reference,
    screenshot: Buffer.from(await file.arrayBuffer()),
    screenshotType: file.type,
    payerEmail: email,
    payerPhone: phone || null,
    ipHash: hashIp(ip)
  });

  await notifySubmission({
    workspaceId: inv.workspaceId,
    invoiceId: inv.id,
    number: inv.number,
    token,
    business: data.business,
    billingEmail: data.billing.email,
    clientName: client.contactName || client.name,
    clientEmail: email,
    kind: "payment",
    amount,
    reference
  });
  return NextResponse.json({ ok: true });
}
