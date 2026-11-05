import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const LL = schema.leadLists;
const LI = schema.leadListItems;
export const MAX_LIST = 1000;

/** Adds leads to a list, skipping ones already in it; keeps the order they come in. */
export async function addLeads(listId: number, items: { leadId: number; reason?: string | null; message?: string | null; subject?: string | null }[]) {
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
        subject: it.subject ?? null
      }))
    )
    .onConflictDoNothing()
    .returning({ id: LI.id });
  await db.update(LL).set({ updatedAt: new Date() }).where(eq(LL.id, listId));
  return rows.length;
}
