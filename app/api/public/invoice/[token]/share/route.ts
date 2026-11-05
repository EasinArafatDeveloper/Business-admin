import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { allow, hashIp, loadPublicInvoice, notifySubmission, requestIp } from "@/lib/public-invoice";

/** The client sends the link to their post about us, to claim the share discount. */
export async function POST(req: Request, ctx: RouteContext<"/api/public/invoice/[token]/share">) {
  const { token } = await ctx.params;
  const ip = requestIp(req);
  if (!allow(`share:${token}:${ip}`, 5, 3_600_000)) return NextResponse.json({ error: "Too many tries — wait a bit" }, { status: 429 });
  const data = await loadPublicInvoice(token);
  if (!data) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (!data.billing.shareDiscountPercent) return NextResponse.json({ error: "This offer isn't available" }, { status: 400 });
  if (data.submissions.some((s) => s.kind === "share" && s.status !== "rejected"))
    return NextResponse.json({ error: "You've already sent your post — we'll apply the discount soon" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  let url: URL;
  try {
    url = new URL(String(body?.url ?? "").trim());
  } catch {
    return NextResponse.json({ error: "Paste the link to your post" }, { status: 400 });
  }
  if (url.protocol !== "https:" || url.href.length > 500) return NextResponse.json({ error: "Paste the full link to your post (https://…)" }, { status: 400 });

  await db.insert(schema.invoiceSubmissions).values({
    workspaceId: data.inv.workspaceId,
    invoiceId: data.inv.id,
    kind: "share",
    shareUrl: url.href,
    ipHash: hashIp(ip)
  });
  await notifySubmission({
    workspaceId: data.inv.workspaceId,
    invoiceId: data.inv.id,
    number: data.inv.number,
    token,
    business: data.business,
    billingEmail: data.billing.email,
    clientName: data.client.contactName || data.client.name,
    clientEmail: data.client.email,
    kind: "share",
    shareUrl: url.href
  });
  return NextResponse.json({ ok: true });
}
