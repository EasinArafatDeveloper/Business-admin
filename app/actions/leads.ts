"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/constants";
import { requireAction } from "@/lib/auth";
import { addLeads, MAX_LIST } from "@/lib/lists";
import { bulkUpdateLeads } from "@/lib/lead-bulk";
import { type ActivityType, MANUAL_TYPES, logActivity } from "@/lib/activity";

const L = schema.leads;
const isStatus = (s: string): s is LeadStatus => (LEAD_STATUSES as readonly string[]).includes(s);

export async function setLeadStatus(leadId: number, status: string) {
  const user = await requireAction("leads");
  if (!isStatus(status)) return;
  const [before] = await db
    .select({ status: L.status })
    .from(L)
    .where(and(eq(L.id, leadId), eq(L.workspaceId, user.workspaceId)))
    .limit(1);
  if (!before || before.status === status) return;

  await db
    .update(L)
    .set({ status, updatedAt: new Date(), ...(status === "contacted" ? { lastContactedAt: new Date() } : {}) })
    .where(and(eq(L.id, leadId), eq(L.workspaceId, user.workspaceId)));
  await db.insert(schema.leadActivities).values({
    workspaceId: user.workspaceId,
    leadId,
    userId: user.id,
    type: "status",
    body: `${before.status} → ${status}`
  });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
}

export async function setLeadsStatus(leadIds: number[], status: string) {
  const user = await requireAction("leads");
  if (!isStatus(status) || leadIds.length === 0) return { updated: 0 };
  const ids = leadIds.slice(0, 1000).filter((n) => Number.isInteger(n));
  const changed = await db
    .update(L)
    .set({ status, updatedAt: new Date(), ...(status === "contacted" ? { lastContactedAt: new Date() } : {}) })
    .where(and(eq(L.workspaceId, user.workspaceId), inArray(L.id, ids)))
    .returning({ id: L.id });
  if (changed.length) {
    await db
      .insert(schema.leadActivities)
      .values(changed.map((c) => ({ workspaceId: user.workspaceId, leadId: c.id, userId: user.id, type: "status", body: `→ ${status} (bulk)` })));
  }
  revalidatePath("/leads");
  return { updated: changed.length };
}

/** Adds and/or removes tags on many leads at once (also used for one lead's tag editor). */
export async function setLeadsTags(leadIds: number[], add: string[], remove: string[] = []) {
  const user = await requireAction("leads");
  const r = await bulkUpdateLeads(user.workspaceId, user.id, leadIds, { addTags: add, removeTags: remove });
  revalidatePath("/leads");
  if (leadIds.length === 1) revalidatePath(`/leads/${leadIds[0]}`);
  return { updated: r.updated };
}

/** Puts the selected leads into an existing list, or a new one when `newName` is given. */
export async function addLeadsToList(leadIds: number[], listId: number | null, newName?: string) {
  const user = await requireAction("leads");
  const ids = [...new Set(leadIds.filter((n) => Number.isInteger(n)))].slice(0, MAX_LIST);
  if (!ids.length) return { error: "Select some leads first." };
  let id = listId;
  if (!id) {
    const name = (newName ?? "").trim().slice(0, 120);
    if (!name) return { error: "Give the new list a name." };
    const [l] = await db
      .insert(schema.leadLists)
      .values({ workspaceId: user.workspaceId, name, source: "manual", createdBy: user.id })
      .returning({ id: schema.leadLists.id });
    id = l.id;
  } else {
    const [l] = await db
      .select({ id: schema.leadLists.id })
      .from(schema.leadLists)
      .where(and(eq(schema.leadLists.id, id), eq(schema.leadLists.workspaceId, user.workspaceId)))
      .limit(1);
    if (!l) return { error: "List not found." };
  }
  // Only leads from this workspace.
  const mine = await db
    .select({ id: L.id })
    .from(L)
    .where(and(eq(L.workspaceId, user.workspaceId), inArray(L.id, ids)));
  const added = await addLeads(
    id,
    mine.map((m) => ({ leadId: m.id }))
  );
  revalidatePath("/leads/lists");
  revalidatePath(`/leads/lists/${id}`);
  return { listId: id, added, already: mine.length - added };
}

/** A note, or a touch done outside the app (WhatsApp from your phone, a call, a meeting, a reply). */
export async function addLeadNote(leadId: number, formData: FormData) {
  const user = await requireAction("leads");
  const body = String(formData.get("body") ?? "")
    .trim()
    .slice(0, 4000);
  const raw = String(formData.get("type") ?? "note");
  const type = (MANUAL_TYPES as string[]).includes(raw) ? (raw as ActivityType) : "note";
  if (!body && type === "note") return;
  await logActivity({ workspaceId: user.workspaceId, leadId, userId: user.id, type, body });
  revalidatePath(`/leads/${leadId}`);
}

/** "Don't SMS me" — excluded from every future campaign. */
export async function setSmsOptOut(leadId: number, optOut: boolean, channel: "sms" | "whatsapp" | "email" = "sms") {
  const user = await requireAction("leads");
  const changed = await db
    .update(L)
    .set({ ...(channel === "whatsapp" ? { waOptOut: optOut } : channel === "email" ? { emailOptOut: optOut } : { smsOptOut: optOut }), updatedAt: new Date() })
    .where(and(eq(L.id, leadId), eq(L.workspaceId, user.workspaceId)))
    .returning({ id: L.id });
  if (changed.length) {
    await db.insert(schema.leadActivities).values({
      workspaceId: user.workspaceId,
      leadId,
      userId: user.id,
      type: "status",
      body: `${optOut ? "Opted out of" : "Allowed again:"} ${channel === "whatsapp" ? "WhatsApp" : channel === "email" ? "email" : "SMS"}`
    });
  }
  revalidatePath(`/leads/${leadId}`);
}
