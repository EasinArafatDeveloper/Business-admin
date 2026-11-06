import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { normalizeEmail } from "@/lib/email";
import { prettyBd } from "@/lib/paste-audience";
import { normalizeBdMobile } from "@/lib/sms-text";
import { addLeads } from "@/lib/lists";
import type { Mapping, Sheet } from "@/lib/sheet";
import { offerGroup } from "@/lib/offer";

const L = schema.leads;

export type ImportedRow = {
  name: string | null;
  phone: string | null;
  email: string | null;
  message: string | null;
  subject: string | null;
  reason: string | null;
};

/** One clean row per line of the sheet, using the column mapping. */
export function mapRows(sheet: Sheet, m: Mapping) {
  const get = (r: string[], i: number | undefined) => (i === undefined ? "" : (r[i] ?? "").trim());
  return sheet.rows.map((r) => {
    const phone = normalizeBdMobile(get(r, m.phone));
    const email = normalizeEmail(get(r, m.email));
    return {
      row: r,
      name: get(r, m.name).slice(0, 160) || null,
      phone,
      email,
      message: get(r, m.message).slice(0, 5000) || null,
      subject: get(r, m.subject).slice(0, 200) || null,
      emailBody: get(r, m.emailBody).slice(0, 10000) || null,
      reason: get(r, m.reason).slice(0, 1000) || null,
      offer: get(r, m.offer).slice(0, 300) || null,
      industry: get(r, m.industry).slice(0, 120) || null,
      address: get(r, m.address).slice(0, 400) || null,
      page: get(r, m.page).slice(0, 500) || null
    };
  });
}

/**
 * Creates a saved list from an uploaded sheet: each row is matched to an existing lead
 * (same mobile or email) or saved as a new one, and keeps its own message for campaigns.
 */
export async function importSheetAsList(opts: { workspaceId: number; userId: number; sheet: Sheet; mapping: Mapping; listName: string; fileName: string }) {
  const rows = mapRows(opts.sheet, opts.mapping).filter((r) => r.phone || r.email);
  const skipped = opts.sheet.rows.length - rows.length;
  if (rows.length === 0) throw new Error("No row has a valid Bangladeshi mobile number or email");

  // Find existing leads by the last 10 digits of their phone/WhatsApp, or by email.
  const ws = opts.workspaceId;
  const d10 = (c: AnyPgColumn) => sql<string>`right(regexp_replace(coalesce(${c}, ''), '\\D', '', 'g'), 10)`;
  const keys10 = [...new Set(rows.map((r) => r.phone?.slice(-10)).filter((x): x is string => Boolean(x)))];
  const emails = [...new Set(rows.map((r) => r.email).filter((x): x is string => Boolean(x)))];
  const conds = [
    keys10.length ? inArray(d10(L.phone), keys10) : undefined,
    keys10.length ? inArray(d10(L.whatsapp), keys10) : undefined,
    emails.length ? inArray(sql`lower(${L.email})`, emails) : undefined
  ].filter(Boolean);
  const existing = conds.length
    ? await db
        .select({ id: L.id, p: d10(L.phone), w: d10(L.whatsapp), e: sql<string>`lower(coalesce(${L.email}, ''))` })
        .from(L)
        .where(and(eq(L.workspaceId, ws), or(...(conds as never[]))))
    : [];
  const byPhone = new Map<string, number>();
  const byEmail = new Map<string, number>();
  for (const l of existing) {
    if (l.p) byPhone.set(l.p, l.id);
    if (l.w) byPhone.set(l.w, l.id);
    if (l.e) byEmail.set(l.e, l.id);
  }
  const findId = (r: (typeof rows)[number]) => (r.phone ? byPhone.get(r.phone.slice(-10)) : undefined) ?? (r.email ? byEmail.get(r.email) : undefined);

  // Save the new ones (every other column goes into the lead's details).
  const fresh = rows.filter((r) => !findId(r));
  if (fresh.length) {
    const details = (row: string[]) =>
      Object.fromEntries(
        opts.sheet.headers
          .map((h, i) => [h, (row[i] ?? "").slice(0, 500)] as const)
          .filter(([, v]) => v)
          .slice(0, 40)
      );
    const created = await db
      .insert(L)
      .values(
        fresh.map((r) => ({
          workspaceId: ws,
          source: "upload",
          externalKey: `file:${r.phone ?? r.email}`,
          pageName: r.name ?? (r.phone ? prettyBd(r.phone) : r.email),
          phone: r.phone ? prettyBd(r.phone) : null,
          whatsapp: r.phone ? prettyBd(r.phone) : null,
          email: r.email,
          industry: r.industry,
          address: r.address,
          pageLink: r.page,
          details: details(r.row)
        }))
      )
      .onConflictDoNothing()
      .returning({ id: L.id, key: L.externalKey });
    for (const c of created) {
      const k = c.key.slice(5);
      if (k.includes("@")) byEmail.set(k, c.id);
      else byPhone.set(k.slice(-10), c.id);
    }
    // Rows that clashed with an earlier upload of the same number: find those leads too.
    const missing = fresh.filter((r) => !findId(r)).map((r) => `file:${r.phone ?? r.email}`);
    if (missing.length) {
      const again = await db
        .select({ id: L.id, key: L.externalKey })
        .from(L)
        .where(and(eq(L.workspaceId, ws), inArray(L.externalKey, missing)));
      for (const c of again) {
        const k = c.key.slice(5);
        if (k.includes("@")) byEmail.set(k, c.id);
        else byPhone.set(k.slice(-10), c.id);
      }
    }
  }

  const [list] = await db
    .insert(schema.leadLists)
    .values({
      workspaceId: ws,
      name: opts.listName.slice(0, 120),
      description: `Uploaded from ${opts.fileName} — ${rows.length} rows`,
      source: "file",
      createdBy: opts.userId
    })
    .returning({ id: schema.leadLists.id });

  const seen = new Set<number>();
  const items = [];
  for (const r of rows) {
    const id = findId(r);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({ leadId: id, reason: r.reason, message: r.message, subject: r.subject, emailBody: r.emailBody, offer: r.offer, tag: offerGroup(r.offer) });
  }
  const added = await addLeads(list.id, items);
  return { listId: list.id, added, matched: rows.length - fresh.length, created: fresh.length, skipped, duplicates: rows.length - items.length };
}
