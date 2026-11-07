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
const DAY = 86_400_000;
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

const dueFor = (enrolledAt: Date, day: number) => new Date(Math.max(Date.now(), enrolledAt.getTime() + (Math.max(1, day) - 1) * DAY));

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
            nextDueAt: state === "active" ? dueFor(now, first.day) : null
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
  return { enrolled: rows.length, skipped: ids.length - rows.length };
}

/** Starts the leads the AI added (state "waiting"). Their day 1 is today. */
export async function approveWaiting(workspaceId: number, sequenceId: number) {
  const [first] = await db.select().from(ST).where(eq(ST.sequenceId, sequenceId)).orderBy(asc(ST.position)).limit(1);
  if (!first) return 0;
  const now = new Date();
  const rows = await db
    .update(E)
    .set({ state: "active", enrolledAt: now, nextDueAt: dueFor(now, first.day) })
    .where(and(eq(E.workspaceId, workspaceId), eq(E.sequenceId, sequenceId), eq(E.state, "waiting")))
    .returning({ id: E.id });
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
  if (step.channel === "call") {
    const c = contactFor(lead, "sms");
    if ("skip" in c) return log(seq.workspaceId, lead.id, `Sequence “${seq.name}”: step ${step.position + 1} (call) skipped — ${c.skip}`);
    const vars = { name: lead.pageName, service: lead.primaryService, link: seq.destinationUrl ?? "", fields: leadFields(lead) };
    await db.insert(T).values({
      workspaceId: seq.workspaceId,
      leadId: lead.id,
      enrollmentId: enrollment.id,
      stepId: step.id,
      channel: "call",
      title: `Call · ${label}`,
      body: step.body ? renderTemplate(step.body, vars) : null,
      contact: c.to,
      dueAt
    });
    return;
  }
  const manual = step.mode !== "auto";
  if (!manual && step.channel === "email" && !seq.emailSenderId)
    return log(seq.workspaceId, lead.id, `Sequence “${seq.name}”: step ${step.position + 1} skipped — no email sender chosen for the sequence`);
  const campaignId = await stepCampaign(seq, step);
  const res = await addRecipient(campaignId, lead, { channel: step.channel as Channel, workspaceId: seq.workspaceId, body: step.body, subject: step.subject, manual });
  if ("skip" in res)
    return log(seq.workspaceId, lead.id, `Sequence “${seq.name}”: step ${step.position + 1} (${CHANNEL_LABEL[step.channel]}) skipped — ${res.skip}`);
  if (manual)
    await db.insert(T).values({
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
    });
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
          ? { currentStep: e.currentStep + 1, nextDueAt: dueFor(e.enrolledAt, next.day) }
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
