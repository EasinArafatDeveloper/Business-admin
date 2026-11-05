import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { normalizeEmail } from "@/lib/email";
import { allow, loadPublicInvoice, requestIp } from "@/lib/public-invoice";

/** The client confirms or corrects their own details from the invoice link. */
const bodySchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().max(160),
  phone: z.string().trim().min(6).max(40)
});

export async function POST(req: Request, ctx: RouteContext<"/api/public/invoice/[token]/details">) {
  const { token } = await ctx.params;
  if (!allow(`details:${token}:${requestIp(req)}`, 10, 3_600_000)) return NextResponse.json({ error: "Too many tries — wait a bit" }, { status: 429 });
  const data = await loadPublicInvoice(token);
  if (!data) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  const p = bodySchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Please fill in every field" }, { status: 400 });
  const email = normalizeEmail(p.data.email);
  if (!email) return NextResponse.json({ error: "That email doesn't look right" }, { status: 400 });

  await db
    .update(schema.clients)
    .set({ name: p.data.businessName, contactName: p.data.name, email, phone: p.data.phone, updatedAt: new Date() })
    .where(eq(schema.clients.id, data.client.id));
  return NextResponse.json({ ok: true });
}
