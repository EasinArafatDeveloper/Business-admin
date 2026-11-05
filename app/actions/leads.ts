"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/constants";
import { requireUser } from "@/lib/auth";

const L = schema.leads;
const isStatus = (s: string): s is LeadStatus => (LEAD_STATUSES as readonly string[]).includes(s);

export async function setLeadStatus(leadId: number, status: string) {
  const user = await requireUser();
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
  const user = await requireUser();
  if (!isStatus(status) || leadIds.length === 0) return { updated: 0 };
  const ids = leadIds.slice(0, 1000).filter((n) => Number.isInteger(n));
  const changed = await db
    .update(L)
    .set({ status, updatedAt: new Date(), ...(status === "contacted" ? { lastContactedAt: new Date() } : {}) })
    .where(and(eq(L.workspaceId, user.workspaceId), inArray(L.id, ids)))
    .returning({ id: L.id });
  if (changed.length) {
    await db.insert(schema.leadActivities).values(
      changed.map((c) => ({ workspaceId: user.workspaceId, leadId: c.id, userId: user.id, type: "status", body: `→ ${status} (bulk)` }))
    );
  }
  revalidatePath("/leads");
  return { updated: changed.length };
}

export async function addLeadNote(leadId: number, formData: FormData) {
  const user = await requireUser();
  const body = String(formData.get("body") ?? "").trim().slice(0, 4000);
  if (!body) return;
  const [lead] = await db
    .select({ id: L.id })
    .from(L)
    .where(and(eq(L.id, leadId), eq(L.workspaceId, user.workspaceId)))
    .limit(1);
  if (!lead) return;
  await db.insert(schema.leadActivities).values({ workspaceId: user.workspaceId, leadId, userId: user.id, type: "note", body });
  await db.update(L).set({ updatedAt: new Date() }).where(eq(L.id, leadId));
  revalidatePath(`/leads/${leadId}`);
}

/** "Don't SMS me" — excluded from every future campaign. */
export async function setSmsOptOut(leadId: number, optOut: boolean, channel: "sms" | "whatsapp" = "sms") {
  const user = await requireUser();
  const changed = await db
    .update(L)
    .set({ ...(channel === "whatsapp" ? { waOptOut: optOut } : { smsOptOut: optOut }), updatedAt: new Date() })
    .where(and(eq(L.id, leadId), eq(L.workspaceId, user.workspaceId)))
    .returning({ id: L.id });
  if (changed.length) {
    await db.insert(schema.leadActivities).values({
      workspaceId: user.workspaceId,
      leadId,
      userId: user.id,
      type: "status",
      body: `${optOut ? "Opted out of" : "Allowed again:"} ${channel === "whatsapp" ? "WhatsApp" : "SMS"}`
    });
  }
  revalidatePath(`/leads/${leadId}`);
}
