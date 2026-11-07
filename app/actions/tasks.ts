"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAction } from "@/lib/auth";
import { markManualSent } from "@/lib/campaigns";
import { logActivity } from "@/lib/activity";

const T = schema.tasks;
const R = schema.campaignRecipients;

async function openTask(id: number, workspaceId: number) {
  const [t] = await db
    .select()
    .from(T)
    .where(and(eq(T.id, id), eq(T.workspaceId, workspaceId), eq(T.state, "open")))
    .limit(1);
  return t ?? null;
}

/** "Mark sent" / "Done": counts the message, puts it on the lead's timeline and clears the task. */
export async function completeTask(id: number, note?: string) {
  const user = await requireAction("campaigns");
  const t = await openTask(id, user.workspaceId);
  if (!t) return { error: "This task is already done" };
  // Claim it first so a double click can't log it twice.
  const claimed = await db
    .update(T)
    .set({ state: "done", doneAt: new Date(), doneBy: user.id })
    .where(and(eq(T.id, t.id), eq(T.state, "open")))
    .returning({ id: T.id });
  if (!claimed.length) return { error: "This task is already done" };
  if (t.recipientId && (await markManualSent(t.recipientId, user.workspaceId))) {
    // markManualSent logs "<channel>_sent" on the timeline; nothing else to do.
  } else if (t.channel === "call") {
    await logActivity({ workspaceId: user.workspaceId, leadId: t.leadId, userId: user.id, type: "call", body: note?.trim() || "Called (from Today)" });
  } else {
    const type = t.channel === "whatsapp" ? "wa_sent" : t.channel === "email" ? "email_sent" : "sms_sent";
    await logActivity({ workspaceId: user.workspaceId, leadId: t.leadId, userId: user.id, type, body: t.body ?? t.title });
  }
  revalidatePath("/today");
  return { ok: true };
}

/** Not sending this one: the sequence just carries on with its next step. */
export async function skipTask(id: number) {
  const user = await requireAction("campaigns");
  const t = await openTask(id, user.workspaceId);
  if (!t) return { error: "This task is already done" };
  await db.update(T).set({ state: "skipped", doneAt: new Date(), doneBy: user.id }).where(eq(T.id, t.id));
  if (t.recipientId)
    await db
      .update(R)
      .set({ status: "skipped" })
      .where(and(eq(R.id, t.recipientId), eq(R.status, "manual")));
  revalidatePath("/today");
  return { ok: true };
}
