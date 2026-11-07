import "server-only";
import { and, asc, eq, inArray, lte, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { type Channel, type SequenceLead, WA_HOURS, addRecipient, contactFor, dhakaNow } from "@/lib/campaigns";
import { leadFields, renderTemplate } from "@/lib/sms-text";

const S = schema.sequences;
const ST = schema.sequenceSteps;
const E = schema.enrollments;
const T = schema.tasks;
const L = schema.leads;
const C = schema.campaigns;

export const STEP_CHANNELS = ["email", "sms", "whatsapp", "call"] as const;
export type StepChannel = (typeof STEP_CHANNELS)[number];
export const CHANNEL_LABEL: Record<string, string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp", call: "Call" };
/** Leads in these statuses never get sequence messages. */
const CLOSED = ["won", "lost", "skip"] as const;

const LEAD_COLS = {
  id: L.id,
  pageName: L.pageName,
  primaryService: L.primaryService,
  phone: L.phone,
  whatsapp: L.whatsapp,
  email: L.email,
  smsOptOut: L.smsOptOut,
  waOptOut: L.waOptOut,
  emailOptOut: L.emailOptOut,
  status: L.status,
  industry: L.industry,
  category: L.category,
  activeAds: L.activeAds,
  runningDays: L.runningDays,
  followers: L.followers,
  painPoint: L.painPoint,
  ordersVia: L.ordersVia,
  sizeTier: L.sizeTier,
  address: L.address
};

const PM = schema.planMessages;
const TZ = 6 * 3600_000; // Dhaka is UTC+6, no daylight saving

/** "2026-11-08" for a moment, in Dhaka. */
export const dhakaDate = (d: Date) => new Date(d.getTime() + TZ).toISOString().slice(0, 10);

/**
 * When a step is due for someone: day 1 is the later of the day they were added and the sequence's start date,
 * at the step's time (Dhaka). Never in the past unless clampToNow is false.
 */
export function stepDue(enrolledAt: Date, startDate: string | null, day: number, sendTime: string | null, clampToNow = true) {
  const base = [dhakaDate(enrolledAt), startDate ?? ""].sort().at(-1)!;
  const [y, m, d] = base.split("-").map(Number);
  const [hh, mm] = (sendTime || "00:00").split(":").map(Number);
  const at = Date.UTC(y, m - 1, d + Math.max(1, day) - 1, hh || 0, mm || 0) - TZ;
  return new Date(clampToNow ? Math.max(Date.now(), at) : at);
}

/** Recomputes when each planned message goes out (after adding people, approving, or changing days/times). */
export async function refreshSchedule(sequenceId: number) {
  await db.execute(sql`
    update plan_messages pm
    set scheduled_at = ((greatest((e.enrolled_at at time zone 'Asia/Dhaka')::date, coalesce(s.start_date::date, '1900-01-01'::date)) + (st.day - 1))
      + coalesce(nullif(st.send_time, ''), '00:00')::time) at time zone 'Asia/Dhaka'
    from enrollments e, sequence_steps st, sequences s
    where pm.sequence_id = ${sequenceId} and e.sequence_id = pm.sequence_id and e.lead_id = pm.lead_id
      and st.id = pm.step_id and s.id = pm.sequence_id and pm.status in ('draft', 'approved')`);
}

async function log(workspaceId: number, leadId: number, body: string, userId?: number | null) {
  await db.insert(schema.leadActivities).values({ workspaceId, leadId, userId: userId ?? null, type: "sequence", body });
}

/**
 * Puts leads into a sequence. "waiting" (used when the AI enrolls) needs your OK on the sequence page before anything is sent.
 * Leads already in it, or won/lost/skipped, are left out.
 */
export async function enrollLeads(workspaceId: number, sequenceId: number, leadIds: number[], userId: number | null, state: "active" | "waiting" = "active") {
  const [seq] = await db
    .select()
    .from(S)
    .where(and(eq(S.id, sequenceId), eq(S.workspaceId, workspaceId)))
    .limit(1);
  if (!seq) return { error: "Sequence not found" } as const;
  const [first] = await db.select().from(ST).where(eq(ST.sequenceId, seq.id)).orderBy(asc(ST.position)).limit(1);
  if (!first) return { error: "Add at least one step to the sequence first" } as const;
  const ids = [...new Set(leadIds.filter(Number.isInteger))].slice(0, 5000);
  if (!ids.length) return { enrolled: 0, skipped: 0 };
  const ok = await db
    .select({ id: L.id })
    .from(L)
    .where(and(eq(L.workspaceId, workspaceId), inArray(L.id, ids), notInArray(L.status, [...CLOSED])));
  const now = new Date();
  const rows = ok.length
    ? await db
        .insert(E)
        .values(
          ok.map((l) => ({
            workspaceId,
            sequenceId: seq.id,
            leadId: l.id,
            state,
            enrolledBy: userId,
            enrolledAt: now,
            nextDueAt: state === "active" ? stepDue(now, seq.startDate, first.day, first.sendTime) : null
          }))
        )
        .onConflictDoNothing()
        .returning({ leadId: E.leadId })
    : [];
  if (rows.length)
    await db.insert(schema.leadActivities).values(
      rows.map((r) => ({
        workspaceId,
        leadId: r.leadId,
        userId,
        type: "sequence",
        body: state === "waiting" ? `Added to sequence “${seq.name}” (waiting for your OK)` : `Started sequence “${seq.name}”`
      }))
    );
  if (rows.length) await refreshSchedule(seq.id);
  return { enrolled: rows.length, skipped: ids.length - rows.length };
}

/** Starts the leads the AI added (state "waiting"). Their day 1 is today. */
export async function approveWaiting(workspaceId: number, sequenceId: number) {
  const [seq] = await db
    .select()
    .from(S)
    .where(and(eq(S.id, sequenceId), eq(S.workspaceId, workspaceId)))
    .limit(1);
  const [first] = await db.select().from(ST).where(eq(ST.sequenceId, sequenceId)).orderBy(asc(ST.position)).limit(1);
  if (!seq || !first) return 0;
  const now = new Date();
  const rows = await db
    .update(E)
    .set({ state: "active", enrolledAt: now, nextDueAt: stepDue(now, seq.startDate, first.day, first.sendTime) })
    .where(and(eq(E.workspaceId, workspaceId), eq(E.sequenceId, sequenceId), eq(E.state, "waiting")))
    .returning({ leadId: E.leadId });
  if (rows.length) {
    // Their planned messages are approved with them.
    await db
      .update(PM)
      .set({ status: "approved", updatedAt: now })
      .where(
        and(
          eq(PM.sequenceId, sequenceId),
          eq(PM.status, "draft"),
          inArray(
            PM.leadId,
            rows.map((r) => r.leadId)
          )
        )
      );
    await refreshSchedule(sequenceId);
  }
  return rows.length;
}

/** The campaign that carries a step's messages (made on first use, so stats, tracking and sending work like any campaign). */
async function stepCampaign(seq: typeof S.$inferSelect, step: typeof ST.$inferSelect) {
  if (step.campaignId) return step.campaignId;
  const [c] = await db
    .insert(C)
    .values({
      workspaceId: seq.workspaceId,
      createdBy: seq.createdBy,
      name: `${seq.name} · Step ${step.position + 1} (Day ${step.day} ${CHANNEL_LABEL[step.channel]})`,
      message: step.body,
      subject: step.subject,
      destinationUrl: seq.destinationUrl || "https://scaleupweb.xyz",
      channel: step.channel,
      senderId: step.channel === "email" ? seq.emailSenderId : null,
      sequenceId: seq.id,
      status: "sending",
      startedAt: new Date(),
      // Human-like gaps (2–6 min) between automatic WhatsApp / email messages.
      minDelaySec: 120,
      maxDelaySec: 360,
      ratePerMinute: 10
    })
    .returning({ id: C.id });
  await db.update(ST).set({ campaignId: c.id }).where(eq(ST.id, step.id));
  step.campaignId = c.id;
  return c.id;
}

/** Runs one step for one lead: queue the message, make a task, or skip with a reason. */
async function runStep(seq: typeof S.$inferSelect, step: typeof ST.$inferSelect, enrollment: typeof E.$inferSelect, lead: SequenceLead & { status: string }) {
  const label = `${seq.name} · step ${step.position + 1}`;
  const dueAt = new Date();
  // This person's own message for the step (from a plan), if there is one.
  const [pm] = await db
    .select()
    .from(PM)
    .where(and(eq(PM.stepId, step.id), eq(PM.leadId, lead.id)))
    .limit(1);
  if (pm && (pm.status === "skipped" || pm.status === "cancelled"))
    return log(
      seq.workspaceId,
      lead.id,
      `Sequence “${seq.name}”: step ${step.position + 1} (${CHANNEL_LABEL[step.channel]}) skipped — you skipped it in the plan`
    );
  const body = pm?.body ?? step.body;
  const subject = pm?.subject ?? step.subject;
  const done = async (patch: Partial<typeof PM.$inferInsert>) => {
    if (pm)
      await db
        .update(PM)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(PM.id, pm.id));
  };
  if (step.channel !== "call" && !body.trim())
    return log(seq.workspaceId, lead.id, `Sequence “${seq.name}”: step ${step.position + 1} skipped — no message written for it`);
  if (step.channel === "call") {
    const c = contactFor(lead, "sms");
    if ("skip" in c) return log(seq.workspaceId, lead.id, `Sequence “${seq.name}”: step ${step.position + 1} (call) skipped — ${c.skip}`);
    const vars = { name: lead.pageName, service: lead.primaryService, link: seq.destinationUrl ?? "", fields: leadFields(lead) };
    const [task] = await db
      .insert(T)
      .values({
        workspaceId: seq.workspaceId,
        leadId: lead.id,
        enrollmentId: enrollment.id,
        stepId: step.id,
        channel: "call",
        title: `Call · ${label}`,
        body: body ? renderTemplate(body, vars) : null,
        contact: c.to,
        dueAt
      })
      .returning({ id: T.id });
    await done({ status: "task", taskId: task.id });
    return;
  }
  const manual = step.mode !== "auto";
  if (!manual && step.channel === "email" && !seq.emailSenderId)
    return log(seq.workspaceId, lead.id, `Sequence “${seq.name}”: step ${step.position + 1} skipped — no email sender chosen for the sequence`);
  const campaignId = await stepCampaign(seq, step);
  const res = await addRecipient(campaignId, lead, { channel: step.channel as Channel, workspaceId: seq.workspaceId, body, subject, manual });
  if ("skip" in res) {
    await done({ status: "skipped" });
    return log(seq.workspaceId, lead.id, `Sequence “${seq.name}”: step ${step.position + 1} (${CHANNEL_LABEL[step.channel]}) skipped — ${res.skip}`);
  }
  if (!manual) await done({ status: "queued", recipientId: res.recipientId });
  if (manual) {
    const [task] = await db
      .insert(T)
      .values({
        workspaceId: seq.workspaceId,
        leadId: lead.id,
        enrollmentId: enrollment.id,
        stepId: step.id,
        recipientId: res.recipientId,
        channel: step.channel,
        title: `${CHANNEL_LABEL[step.channel]} · ${label}`,
        subject: res.subject,
        body: res.message,
        contact: res.to,
        dueAt
      })
      .returning({ id: T.id });
    await done({ status: "task", recipientId: res.recipientId, taskId: task.id });
  }
}

/** Called every minute: every enrollment whose next step is due gets it, then moves on. */
export async function runDueSteps() {
  const { hour } = dhakaNow();
  const awake = hour >= WA_HOURS.from && hour < WA_HOURS.to;
  const due = await db
    .select({ e: E, s: S })
    .from(E)
    .innerJoin(S, eq(S.id, E.sequenceId))
    .where(and(eq(E.state, "active"), eq(S.status, "active"), lte(E.nextDueAt, new Date())))
    .orderBy(asc(E.nextDueAt))
    .limit(200);
  const stepsBySeq = new Map<number, (typeof ST.$inferSelect)[]>();
  for (const { e, s } of due) {
    let steps = stepsBySeq.get(s.id);
    if (!steps) {
      steps = await db.select().from(ST).where(eq(ST.sequenceId, s.id)).orderBy(asc(ST.position));
      stepsBySeq.set(s.id, steps);
    }
    const step = steps[e.currentStep];
    if (!step) {
      await db.update(E).set({ state: "done", endedAt: new Date(), nextDueAt: null }).where(eq(E.id, e.id));
      continue;
    }
    // Messages the app sends itself only go out 9am–9pm Dhaka; tasks for you can appear any time.
    if (step.mode === "auto" && step.channel !== "call" && !awake) continue;

    const [lead] = await db.select(LEAD_COLS).from(L).where(eq(L.id, e.leadId)).limit(1);
    if (!lead || (CLOSED as readonly string[]).includes(lead.status)) {
      await db
        .update(E)
        .set({ state: "stopped", endedAt: new Date(), nextDueAt: null, note: lead ? `Lead is ${lead.status}` : "Lead deleted" })
        .where(eq(E.id, e.id));
      continue;
    }
    // Claim the step first so a slow send can never run it twice.
    const next = steps[e.currentStep + 1];
    const claimed = await db
      .update(E)
      .set(
        next
          ? { currentStep: e.currentStep + 1, nextDueAt: stepDue(e.enrolledAt, s.startDate, next.day, next.sendTime) }
          : { currentStep: e.currentStep + 1, state: "done", endedAt: new Date(), nextDueAt: null }
      )
      .where(and(eq(E.id, e.id), eq(E.currentStep, e.currentStep), eq(E.state, "active")))
      .returning({ id: E.id });
    if (!claimed.length) continue;
    try {
      await runStep(s, step, e, lead);
    } catch (err) {
      console.error("[sequences] step failed", e.id, err);
      await log(s.workspaceId, lead.id, `Sequence “${s.name}”: step ${step.position + 1} failed — ${err instanceof Error ? err.message : "error"}`);
    }
  }
}

/** Started once from instrumentation.ts. */
export function startSequenceWorker() {
  const g = globalThis as unknown as { __sequenceWorker?: boolean };
  if (g.__sequenceWorker) return;
  g.__sequenceWorker = true;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runDueSteps();
    } catch (e) {
      console.error("[sequences] worker error", e);
    } finally {
      busy = false;
    }
  }, 60_000);
  console.log("[sequences] worker started");
}

/** Counts for the sequences list and page. */
export async function enrollmentCounts(workspaceId: number) {
  const rows = await db
    .select({ sequenceId: E.sequenceId, state: E.state, n: sql<number>`count(*)::int` })
    .from(E)
    .where(eq(E.workspaceId, workspaceId))
    .groupBy(E.sequenceId, E.state);
  const out = new Map<number, Record<string, number>>();
  for (const r of rows) out.set(r.sequenceId, { ...(out.get(r.sequenceId) ?? {}), [r.state]: r.n });
  return out;
}
