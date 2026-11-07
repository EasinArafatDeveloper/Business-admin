"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { updatePlanMessage } from "@/lib/plans";
import { approveWaiting } from "@/lib/sequences";
import { setSequenceStatus } from "@/app/actions/sequences";

/** Edit or skip one cell of the Plan screen. */
export async function savePlanCell(sequenceId: number, leadId: number, stepId: number, change: { body?: string; subject?: string | null; skip?: boolean }) {
  const user = await requireAction("campaigns");
  const r = await updatePlanMessage(user.workspaceId, sequenceId, leadId, stepId, change);
  revalidatePath(`/sequences/${sequenceId}`);
  return r;
}

/** "Approve & start": everyone waiting starts, and the sequence is turned on. */
export async function approvePlan(sequenceId: number) {
  const user = await requireAction("campaigns");
  const on = await setSequenceStatus(sequenceId, "active");
  if (on.error) return { error: on.error };
  const started = await approveWaiting(user.workspaceId, sequenceId);
  revalidatePath(`/sequences/${sequenceId}`);
  return { ok: true, started };
}
