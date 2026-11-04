import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";

/**
 * Leads from the public website's forms (contact + free audit).
 * Called server-to-server by scaleup-web over the Docker network, with a shared secret.
 */
const body = z.object({
  form: z.enum(["contact", "audit"]),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.string().trim().max(160).optional().default(""),
  business: z.string().trim().max(160).optional().default(""),
  website: z.string().trim().max(300).optional().default(""),
  facebook: z.string().trim().max(300).optional().default(""),
  service: z.string().trim().max(120).optional().default(""),
  details: z.record(z.string(), z.string().max(4000)).optional().default({})
});

function secretOk(given: string | null) {
  const expected = process.env.INBOUND_SECRET ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!secretOk(request.headers.get("x-inbound-secret"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid lead" }, { status: 400 });
  const d = parsed.data;

  // Website leads go to the main workspace (the first one created).
  const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).orderBy(asc(schema.workspaces.id)).limit(1);
  if (!ws) return NextResponse.json({ error: "Admin not set up yet" }, { status: 503 });

  const source = d.form === "audit" ? "website-audit" : "website-contact";
  const [lead] = await db
    .insert(schema.leads)
    .values({
      workspaceId: ws.id,
      source,
      externalKey: `web:${randomUUID()}`,
      pageName: d.business || d.name,
      phone: d.phone || null,
      whatsapp: d.phone || null,
      email: d.email || null,
      website: d.website || null,
      pageLink: d.facebook || null,
      primaryService: d.service || null,
      priority: "A - Hot",
      inBangladesh: true,
      details: { name: d.name, ...d.details }
    })
    .returning({ id: schema.leads.id });

  await db.insert(schema.leadActivities).values({
    workspaceId: ws.id,
    leadId: lead.id,
    type: "form",
    body: d.form === "audit" ? "Free audit request from the website" : "Contact form message from the website",
    meta: { name: d.name, ...d.details }
  });

  return NextResponse.json({ ok: true, id: lead.id });
}

/** Lets the website check the connection (no data returned). */
export async function GET(request: Request) {
  return NextResponse.json({ ok: secretOk(request.headers.get("x-inbound-secret")) });
}

