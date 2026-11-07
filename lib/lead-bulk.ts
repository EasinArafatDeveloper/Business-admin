import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LeadStatus } from "@/lib/constants";
import { cleanTags } from "@/lib/tags";

const L = schema.leads;

/** A text[] value for SQL (drizzle would otherwise expand a JS array into a list of params). */
const textArray = (items: string[]) => (items.length ? sql`array[${sql.join(items.map((i) => sql`${i}`), sql`, `)}]::text[]` : sql`'{}'::text[]`);

/**
 * Changes many leads at once: status, tags added/removed, and an optional note on each.
 * Only touches leads in the workspace; every change is written to each lead's timeline.
 */
export async function bulkUpdateLeads(
  workspaceId: number,
  userId: number | null,
  leadIds: number[],
  change: { status?: LeadStatus; addTags?: string[]; removeTags?: string[]; note?: string; via?: "ai" }
) {
  const ids = [...new Set(leadIds.filter((n) => Number.isInteger(n)))].slice(0, 1000);
  const plus = cleanTags(change.addTags ?? []);
  const minus = cleanTags(change.removeTags ?? []);
  const note = change.note?.trim().slice(0, 4000);
  if (!ids.length) return { updated: 0, ids: [] as number[] };

  const now = new Date();
  const changed = await db
    .update(L)
    .set({
      updatedAt: now,
      ...(change.status ? { status: change.status, ...(change.status === "contacted" ? { lastContactedAt: now } : {}) } : {}),
      ...(plus.length || minus.length
        ? { tags: sql`array(select distinct t from unnest(${L.tags} || ${textArray(plus)}) t where not (t = any(${textArray(minus)})) order by t)` }
        : {})
    })
    .where(and(eq(L.workspaceId, workspaceId), inArray(L.id, ids)))
    .returning({ id: L.id });

  const meta = change.via ? { via: change.via } : null;
  const rows = changed.flatMap((c) => [
    ...(change.status ? [{ workspaceId, leadId: c.id, userId, type: "status", body: `→ ${change.status} (bulk)`, meta }] : []),
    ...(note ? [{ workspaceId, leadId: c.id, userId, type: "note", body: note, meta }] : [])
  ]);
  if (rows.length) await db.insert(schema.leadActivities).values(rows);
  return { updated: changed.length, ids: changed.map((c) => c.id), tagsAdded: plus, tagsRemoved: minus };
}
