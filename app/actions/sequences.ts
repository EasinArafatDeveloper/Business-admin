"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireAction } from "@/lib/auth";
import { safeUrl } from "@/lib/tracking";
import { STEP_CHANNELS, approveWaiting, enrollLeads, refreshSchedule } from "@/lib/sequences";
import { stopEnrollments } from "@/lib/sequence-stop";

const S = schema.sequences;
const ST = schema.sequenceSteps;
const C = schema.campaigns;

async function owned(id: number, workspaceId: number) {
  const [s] = await db
    .select()
    .from(S)
    .where(and(eq(S.id, id), eq(S.workspaceId, workspaceId)))
    .limit(1);
  return s ?? null;
}

export async function createSequence(formData: FormData) {
  const user = await requireAction("campaigns");
  const name = String(formData.get("name") ?? "").trim().slice(0, 120) || "New sequence";
  const [sender] = await db
    .select({ id: schema.emailSenders.id })
    .from(schema.emailSenders)
    .where(eq(schema.emailSenders.workspaceId, user.workspaceId))
    .limit(1);
  const [s] = await db
    .insert(S)
    .values({ workspaceId: user.workspaceId, name, createdBy: user.id, destinationUrl: "https://scaleupweb.xyz", emailSenderId: sender?.id ?? null })
    .returning({ id: S.id });
  // A sensible start the user can edit: email, then SMS, then a WhatsApp from their phone.
  await db.insert(ST).values([
    { sequenceId: s.id, position: 0, day: 1, channel: "email", mode: "auto", subject: "{name} — quick idea", body: "Assalamu Alaikum {name},\n\n" },
    { sequenceId: s.id, position: 1, day: 2, channel: "sms", mode: "auto", body: "{name}, " },
    { sequenceId: s.id, position: 2, day: 4, channel: "whatsapp", mode: "manual", body: "Assalamu Alaikum {name}! " }
  ]);
  redirect(`/sequences/${s.id}`);
}

const stepSchema = z.object({
  id: z.number().int().optional(),
  day: z.number().int().min(1).max(90),
  sendTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must look like 10:00")
    .nullable()
    .optional(),
  channel: z.enum(STEP_CHANNELS),
  mode: z.enum(["auto", "manual"]),
  subject: z.string().max(200).optional().nullable(),
  body: z.string().max(10000)
});
const saveSchema = z.object({
  name: z.string().trim().min(2, "Name the sequence").max(120),
  destinationUrl: z.string().trim().max(500),
  emailSenderId: z.number().int().nullable(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  steps: z.array(stepSchema).min(1, "Add at least one step").max(15)
});
export type SequenceInput = z.infer<typeof saveSchema>;

/** Saves the sequence and its steps. Steps keep their id (and campaign) when edited; removed ones are deleted. */
export async function saveSequence(id: number, input: SequenceInput): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireAction("campaigns");
  const seq = await owned(id, user.workspaceId);
  if (!seq) return { error: "Sequence not found" };
  const p = saveSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message };
  const d = p.data;
  const url = d.destinationUrl ? safeUrl(d.destinationUrl) : null;
  if (d.destinationUrl && !url) return { error: "The link must be a full address starting with https://" };
  const steps = [...d.steps].sort((a, b) => a.day - b.day || (a.sendTime ?? "").localeCompare(b.sendTime ?? ""));
  for (const [i, s] of steps.entries()) {
    if (s.channel !== "call" && !s.body.trim()) return { error: `Step ${i + 1}: write the message` };
    if (s.channel === "email" && !s.subject?.trim()) return { error: `Step ${i + 1}: add an email subject` };
    if (/\{link\}/i.test(s.body) && !url) return { error: `Step ${i + 1} uses {link}: add the link it should open` };
  }
  if (d.emailSenderId) {
    const [snd] = await db
      .select({ id: schema.emailSenders.id })
      .from(schema.emailSenders)
      .where(and(eq(schema.emailSenders.id, d.emailSenderId), eq(schema.emailSenders.workspaceId, user.workspaceId)))
      .limit(1);
    if (!snd) return { error: "Pick an email sender from Channels" };
  }

  await db
    .update(S)
    .set({ name: d.name, destinationUrl: url, emailSenderId: d.emailSenderId, startDate: d.startDate || null, updatedAt: new Date() })
    .where(eq(S.id, id));
  const existing = await db.select().from(ST).where(eq(ST.sequenceId, id));
  const keep = new Set(steps.map((s) => s.id).filter(Boolean));
  const gone = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (gone.length) await db.delete(ST).where(inArray(ST.id, gone));
  for (const [position, s] of steps.entries()) {
    const old = existing.find((e) => e.id === s.id);
    const values = { position, day: s.day, sendTime: s.sendTime || null, channel: s.channel, mode: s.channel === "call" ? "manual" : s.mode, subject: s.channel === "email" ? (s.subject ?? null) : null, body: s.body };
    if (old) {
      // A new channel needs a new campaign; same channel just gets the new text.
      const campaignId = old.channel === s.channel ? old.campaignId : null;
      await db
        .update(ST)
        .set({ ...values, campaignId })
        .where(eq(ST.id, old.id));
      if (campaignId) await db.update(C).set({ message: s.body, subject: values.subject, senderId: s.channel === "email" ? d.emailSenderId : null }).where(eq(C.id, campaignId));
    } else {
      await db.insert(ST).values({ ...values, sequenceId: id });
    }
  }
  await refreshSchedule(id);
  revalidatePath(`/sequences/${id}`);
  revalidatePath("/sequences");
  return { ok: true };
}

/** Turn on / pause. Turning on checks what each step needs. */
export async function setSequenceStatus(id: number, status: "active" | "paused") {
  const user = await requireAction("campaigns");
  const seq = await owned(id, user.workspaceId);
  if (!seq) return { error: "Sequence not found" };
  if (status === "active") {
    const steps = await db.select().from(ST).where(eq(ST.sequenceId, id)).orderBy(asc(ST.position));
    if (!steps.length) return { error: "Add at least one step first" };
    if (steps.some((s) => s.channel === "email" && s.mode === "auto") && !seq.emailSenderId) return { error: "Pick an email sender for the automatic email steps" };
  }
  await db.update(S).set({ status, updatedAt: new Date() }).where(eq(S.id, id));
  // Paused step campaigns stop sending; turning back on resumes them.
  await db
    .update(C)
    .set({ status: status === "active" ? "sending" : "paused" })
    .where(and(eq(C.sequenceId, id), notInArray(C.status, ["cancelled"])));
  revalidatePath(`/sequences/${id}`);
  revalidatePath("/sequences");
  return { ok: true };
}

export async function deleteSequence(id: number) {
  const user = await requireAction("campaigns");
  const seq = await owned(id, user.workspaceId);
  if (!seq) return;
  const enrolled = await db.select({ id: schema.enrollments.id }).from(schema.enrollments).where(eq(schema.enrollments.sequenceId, id));
  if (enrolled.length) await stopEnrollments(user.workspaceId, enrolled.map((e) => e.id));
  await db.update(C).set({ status: "cancelled" }).where(and(eq(C.sequenceId, id), inArray(C.status, ["sending", "paused", "draft"])));
  await db.delete(S).where(eq(S.id, id));
  revalidatePath("/sequences");
  redirect("/sequences");
}

/** Enroll selected leads (Leads table) or a whole saved list. */
export async function enrollInSequence(sequenceId: number, leadIds: number[]) {
  const user = await requireAction("campaigns");
  const r = await enrollLeads(user.workspaceId, sequenceId, leadIds, user.id);
  revalidatePath(`/sequences/${sequenceId}`);
  return r;
}

export async function enrollList(sequenceId: number, listId: number) {
  const user = await requireAction("campaigns");
  const [list] = await db
    .select({ id: schema.leadLists.id })
    .from(schema.leadLists)
    .where(and(eq(schema.leadLists.id, listId), eq(schema.leadLists.workspaceId, user.workspaceId)))
    .limit(1);
  if (!list) return { error: "List not found" };
  const items = await db.select({ leadId: schema.leadListItems.leadId }).from(schema.leadListItems).where(eq(schema.leadListItems.listId, listId));
  const r = await enrollLeads(
    user.workspaceId,
    sequenceId,
    items.map((i) => i.leadId),
    user.id
  );
  revalidatePath(`/sequences/${sequenceId}`);
  return r;
}

export async function approveWaitingLeads(sequenceId: number) {
  const user = await requireAction("campaigns");
  const n = await approveWaiting(user.workspaceId, sequenceId);
  revalidatePath(`/sequences/${sequenceId}`);
  return n;
}

export async function stopEnrollment(sequenceId: number, enrollmentIds: number[]) {
  const user = await requireAction("campaigns");
  const n = await stopEnrollments(user.workspaceId, enrollmentIds);
  revalidatePath(`/sequences/${sequenceId}`);
  return n;
}
