import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

const E = schema.enrollments;
const T = schema.tasks;
const R = schema.campaignRecipients;
const C = schema.campaigns;

/** Ends these enrollments: open tasks are cancelled and their messages not yet sent are dropped. */
async function endEnrollments(where: ReturnType<typeof and>, state: "replied" | "stopped", note?: string) {
  const ended = await db
    .update(E)
    .set({ state, endedAt: new Date(), nextDueAt: null, ...(note ? { note } : {}) })
    .where(and(where, inArray(E.state, ["active", "waiting"])))
    .returning({ id: E.id, leadId: E.leadId, sequenceId: E.sequenceId });
  for (const e of ended) {
    await db
      .update(schema.planMessages)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(schema.planMessages.sequenceId, e.sequenceId),
          eq(schema.planMessages.leadId, e.leadId),
          inArray(schema.planMessages.status, ["draft", "approved", "queued", "task"])
        )
      );
    await db
      .update(T)
      .set({ state: "cancelled" })
      .where(and(eq(T.enrollmentId, e.id), eq(T.state, "open")));
    await db
      .update(R)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(R.leadId, e.leadId),
          inArray(R.status, ["queued", "manual"]),
          inArray(R.campaignId, db.select({ id: C.id }).from(C).where(eq(C.sequenceId, e.sequenceId)))
        )
      );
  }
  return ended.length;
}

/** A lead replied or opted out: take them out of every running sequence. */
export const stopSequencesForLead = (leadId: number, state: "replied" | "stopped", note?: string) => endEnrollments(eq(E.leadId, leadId), state, note);

/** The Stop button on a sequence: only these enrollments. */
export const stopEnrollments = (workspaceId: number, enrollmentIds: number[]) =>
  endEnrollments(and(eq(E.workspaceId, workspaceId), inArray(E.id, enrollmentIds)), "stopped", "Stopped by you");
