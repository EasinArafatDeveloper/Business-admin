import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { asc, eq, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";

/** WhatsApp replies forwarded by the wa service. "STOP" opts the person out of WhatsApp campaigns. */
const STOP = /^\s*(stop|unsubscribe|remove|bondho|bondo|বন্ধ|বন্ধ করুন|stop koren|stop korun)\s*[.!]*\s*$/i;

function secretOk(given: string | null) {
  const expected = process.env.WA_SECRET ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!secretOk(request.headers.get("x-wa-secret"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { from?: string; text?: string; name?: string | null } | null;
  const from = String(body?.from ?? "").replace(/\D/g, "");
  const text = String(body?.text ?? "").slice(0, 2000);
  if (!from || !text) return NextResponse.json({ ok: false }, { status: 400 });

  // One WhatsApp number serves the main workspace (per-workspace sessions come with SaaS).
  const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).orderBy(asc(schema.workspaces.id)).limit(1);
  if (!ws) return NextResponse.json({ ok: false }, { status: 503 });

  const L = schema.leads;
  const local = from.startsWith("88") ? from.slice(2) : from; // 01XXXXXXXXX
  const digits = (c: AnyPgColumn) => sql`regexp_replace(coalesce(${c}, ''), '\\D', '', 'g')`;
  const matches = await db
    .select({ id: L.id, status: L.status })
    .from(L)
    .where(
      sql`${L.workspaceId} = ${ws.id} and (${or(
        sql`${digits(L.whatsapp)} in (${from}, ${local})`,
        sql`${digits(L.phone)} in (${from}, ${local})`
      )})`
    )
    .limit(20);

  const optOut = STOP.test(text);
  await db.insert(schema.inboundMessages).values({
    workspaceId: ws.id,
    channel: "whatsapp",
    sender: from,
    senderName: body?.name ?? null,
    body: text,
    leadId: matches[0]?.id ?? null,
    optOut
  });

  for (const lead of matches) {
    await db.insert(schema.leadActivities).values({
      workspaceId: ws.id,
      leadId: lead.id,
      type: "wa_reply",
      body: optOut ? `Replied “${text}” on WhatsApp → opted out of WhatsApp` : `WhatsApp reply: ${text}`
    });
    await db
      .update(L)
      .set({
        updatedAt: new Date(),
        ...(optOut
          ? { waOptOut: true }
          : { status: sql`case when ${L.status} in ('new','contacted') then 'interested'::lead_status else ${L.status} end` })
      })
      .where(eq(L.id, lead.id));
  }
  return NextResponse.json({ ok: true, matched: matches.length, optOut });
}
