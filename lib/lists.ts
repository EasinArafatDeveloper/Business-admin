import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { offerGroup } from "@/lib/offer";
import { db, schema } from "@/db";

const LL = schema.leadLists;
const LI = schema.leadListItems;
export const MAX_LIST = 1000;

/** Adds leads to a list, skipping ones already in it; keeps the order they come in. */
export async function addLeads(
  listId: number,
  items: {
    leadId: number;
    reason?: string | null;
    message?: string | null;
    subject?: string | null;
    emailBody?: string | null;
    offer?: string | null;
    tag?: string | null;
  }[]
) {
  if (!items.length) return 0;
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${LI.position}), -1)::int` })
    .from(LI)
    .where(eq(LI.listId, listId));
  const rows = await db
    .insert(LI)
    .values(
      items.map((it, i) => ({
        listId,
        leadId: it.leadId,
        position: max + 1 + i,
        reason: it.reason ?? null,
        message: it.message ?? null,
        subject: it.subject ?? null,
        emailBody: it.emailBody ?? null,
        offer: it.offer ?? null,
        tag: it.tag ?? null
      }))
    )
    .onConflictDoNothing()
    .returning({ id: LI.id });
  await db.update(LL).set({ updatedAt: new Date() }).where(eq(LL.id, listId));
  return rows.length;
}

/**
 * Lists uploaded before offer groups existed: fill each entry's offer (and its group) from the
 * file data saved on the lead, e.g. its "Entry offer (first sale)" column. Only touches entries with no group.
 */
export async function autoTagFromDetails(listId: number) {
  const rows = await db
    .select({ id: LI.id, details: schema.leads.details })
    .from(LI)
    .innerJoin(schema.leads, eq(schema.leads.id, LI.leadId))
    .where(and(eq(LI.listId, listId), isNull(LI.tag)));
  let tagged = 0;
  for (const r of rows) {
    const d = r.details ?? {};
    const key = Object.keys(d).find((k) => /(entry offer|first sale|offer|package)/i.test(k) && !/(upsell|later)/i.test(k));
    const offer = key ? String(d[key]).slice(0, 300) : null;
    const tag = offerGroup(offer);
    if (!tag) continue;
    await db.update(LI).set({ offer, tag }).where(eq(LI.id, r.id));
    tagged++;
  }
  return tagged;
}
