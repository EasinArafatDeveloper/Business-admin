import "server-only";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { type Channel, type SequenceLead, contactFor } from "@/lib/campaigns";
import { CHANNEL_LABEL, dhakaDate, refreshSchedule, stepDue } from "@/lib/sequences";
import { leadFields, renderTemplate } from "@/lib/sms-text";
import { safeUrl } from "@/lib/tracking";

const S = schema.sequences;
const ST = schema.sequenceSteps;
const E = schema.enrollments;
const PM = schema.planMessages;
const L = schema.leads;
const R = schema.campaignRecipients;
const T = schema.tasks;

export const MAX_PLAN_LEADS = 200;
const CLOSED = ["won", "lost", "skip"];

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

/** What a cell of the Plan screen shows. */
export type CellStatus = "draft" | "approved" | "planned" | "queued" | "task" | "sent" | "failed" | "skipped" | "cancelled";
export const CELL_LABEL: Record<CellStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  planned: "Planned",
  queued: "Sending",
  task: "On Today",
  sent: "Sent",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled"
};

const fromRecipient = (s: string | undefined): CellStatus | null =>
  s === "sent"
    ? "sent"
    : s === "failed"
      ? "failed"
      : s === "cancelled"
        ? "cancelled"
        : s === "skipped"
          ? "skipped"
          : s === "manual"
            ? "task"
            : s === "queued" || s === "sending"
              ? "queued"
              : null;

/** Every lead × step of a sequence with its message and where it stands. */
export async function getPlan(workspaceId: number, sequenceId: number) {
  const [seq] = await db
    .select()
    .from(S)
    .where(and(eq(S.id, sequenceId), eq(S.workspaceId, workspaceId)))
    .limit(1);
  if (!seq) return null;
  const steps = await db.select().from(ST).where(eq(ST.sequenceId, seq.id)).orderBy(asc(ST.position));
  const enrolled = await db
    .select({ e: E, l: LEAD_COLS })
    .from(E)
    .innerJoin(L, eq(L.id, E.leadId))
    .where(eq(E.sequenceId, seq.id))
    .orderBy(asc(E.id))
    .limit(1000);
  const leadIds = enrolled.map((r) => r.e.leadId);
  const pms = leadIds.length ? await db.select().from(PM).where(eq(PM.sequenceId, seq.id)) : [];
  const campaignIds = steps.map((s) => s.campaignId).filter((x): x is number => x != null);
  const recs =
    campaignIds.length && leadIds.length
      ? await db
          .select({ id: R.id, campaignId: R.campaignId, leadId: R.leadId, status: R.status, sentAt: R.sentAt })
          .from(R)
          .where(and(inArray(R.campaignId, campaignIds), inArray(R.leadId, leadIds)))
      : [];
  const pmIds = pms.map((p) => p.recipientId).filter(Boolean);
  const recById = new Map(recs.map((r) => [r.id, r]));
  const callTasks = leadIds.length
    ? await db
        .select({ leadId: T.leadId, stepId: T.stepId, state: T.state })
        .from(T)
        .where(and(eq(T.channel, "call"), inArray(T.leadId, leadIds), inArray(T.stepId, steps.length ? steps.map((s) => s.id) : [0])))
    : [];

  const rows = enrolled.map(({ e, l }) => {
    const lead = { id: l.id, name: l.pageName, status: l.status };
    // Shared step messages are shown with this lead's data filled in ({link} stays as is).
    const vars = { name: l.pageName, service: l.primaryService, link: "{link}", fields: leadFields(l) };
    const cells = steps.map((st, i) => {
      const pm = pms.find((p) => p.stepId === st.id && p.leadId === lead.id);
      const rec = pm?.recipientId ? recById.get(pm.recipientId) : recs.find((r) => r.campaignId === st.campaignId && r.leadId === lead.id && !pmIds.includes(r.id));
      let status: CellStatus = fromRecipient(rec?.status) ?? (pm ? (pm.status as CellStatus) : i < e.currentStep ? "skipped" : "planned");
      if (st.channel === "call" && i < e.currentStep) {
        const t = callTasks.find((x) => x.leadId === lead.id && x.stepId === st.id);
        status = t?.state === "done" ? "sent" : t?.state === "open" ? "task" : t ? (t.state as CellStatus) : status;
      }
      if (["planned", "draft", "approved"].includes(status) && (e.state === "replied" || e.state === "stopped")) status = "cancelled";
      if (status === "planned" && e.state === "waiting") status = "draft";
      const c = contactFor(l as SequenceLead, st.channel === "call" ? "sms" : (st.channel as Channel));
      const open = ["planned", "draft", "approved"].includes(status);
      return {
        stepId: st.id,
        personal: Boolean(pm),
        subject: pm?.subject ?? (st.subject ? renderTemplate(st.subject, vars) : null),
        body: pm?.body ?? (st.body ? renderTemplate(st.body, vars) : ""),
        status,
        problem: open && "skip" in c ? `Will be skipped: ${c.skip}` : open && !pm && !st.body.trim() && st.channel !== "call" ? "No message written" : null,
        at: (rec?.sentAt ?? pm?.scheduledAt ?? stepDue(e.enrolledAt, seq.startDate, st.day, st.sendTime, false)).toISOString()
      };
    });
    return { lead, enrollment: { id: e.id, state: e.state, note: e.note }, cells };
  });
  return { seq, steps, rows };
}

/** Change one person's message for one step (only before it is prepared for sending). */
export async function updatePlanMessage(workspaceId: number, sequenceId: number, leadId: number, stepId: number, change: { body?: string; subject?: string | null; skip?: boolean }) {
  const [step] = await db
    .select({ st: ST, ws: S.workspaceId })
    .from(ST)
    .innerJoin(S, eq(S.id, ST.sequenceId))
    .where(and(eq(ST.id, stepId), eq(ST.sequenceId, sequenceId)))
    .limit(1);
  if (!step || step.ws !== workspaceId) return { error: "Step not found" };
  const [en] = await db
    .select()
    .from(E)
    .where(and(eq(E.sequenceId, sequenceId), eq(E.leadId, leadId)))
    .limit(1);
  if (!en) return { error: "That lead is not in this plan" };
  const [pm] = await db
    .select()
    .from(PM)
    .where(and(eq(PM.stepId, stepId), eq(PM.leadId, leadId)))
    .limit(1);
  const ran = step.st.position < en.currentStep;
  if (ran || (pm && !["draft", "approved", "skipped"].includes(pm.status)))
    return { error: "This message was already prepared or sent. Change it on the Today screen, or skip it there." };
  if (en.state === "replied" || en.state === "stopped") return { error: "This lead has left the plan (replied or stopped)." };
  const body = (change.body ?? pm?.body ?? step.st.body).slice(0, 10000);
  const subject = step.st.channel === "email" ? (change.subject !== undefined ? change.subject : (pm?.subject ?? step.st.subject)) : null;
  const status = change.skip === true ? "skipped" : change.skip === false || pm?.status !== "skipped" ? (en.state === "waiting" ? "draft" : "approved") : "skipped";
  if (!body.trim() && step.st.channel !== "call" && status !== "skipped") return { error: "Write the message" };
  await db
    .insert(PM)
    .values({ workspaceId, sequenceId, stepId, leadId, body, subject, status, scheduledAt: stepDue(en.enrolledAt, null, step.st.day, step.st.sendTime, false) })
    .onConflictDoUpdate({ target: [PM.stepId, PM.leadId], set: { body, subject, status, updatedAt: new Date() } });
  await refreshSchedule(sequenceId);
  return { ok: true, status };
}

/* ---------------------------------------------------------------- plan_outreach (AI) */

export type PlanInput = {
  name: string;
  leadIds: number[];
  steps: { day: number; time?: string | null; channel: "email" | "sms" | "whatsapp" | "call"; mode?: "auto" | "manual"; subject?: string | null; body?: string | null }[];
  messages: { leadId: number; day: number; channel: string; subject?: string | null; body: string }[];
  startDate?: string | null;
  link?: string | null;
  dryRun: boolean;
};

const keyOf = (day: number, channel: string) => `${day}:${channel}`;

/**
 * Builds (or, with the same name, updates) a list + sequence + enrollments + each person's message, in one go.
 * dryRun only returns the preview. Nothing is ever sent from here: the leads wait for your OK in the app.
 */
export async function planOutreach(workspaceId: number, userId: number, input: PlanInput) {
  const name = input.name.trim().slice(0, 120);
  const ids = [...new Set(input.leadIds)].slice(0, MAX_PLAN_LEADS);
  const link = input.link ? safeUrl(input.link) : null;
  if (input.link && !link) return { error: "link must start with https://" };
  if (input.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return { error: "start_date must look like 2026-11-08" };
  const steps = [...input.steps]
    .map((s) => ({ ...s, time: s.time || null, mode: s.channel === "call" ? "manual" : (s.mode ?? "manual") }))
    .sort((a, b) => a.day - b.day || (a.time ?? "").localeCompare(b.time ?? ""));
  const seen = new Set<string>();
  for (const s of steps) {
    if (seen.has(keyOf(s.day, s.channel))) return { error: `Two steps on day ${s.day} use ${s.channel}; use one per channel per day` };
    seen.add(keyOf(s.day, s.channel));
    if (s.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) return { error: `Step day ${s.day}: time must look like 10:00` };
  }

  const leads = ids.length
    ? await db
        .select(LEAD_COLS)
        .from(L)
        .where(and(eq(L.workspaceId, workspaceId), inArray(L.id, ids)))
    : [];
  const notFound = ids.filter((id) => !leads.some((l) => l.id === id));
  const closed = leads.filter((l) => CLOSED.includes(l.status)).map((l) => ({ id: l.id, name: l.pageName, status: l.status }));
  const usable = leads.filter((l) => !CLOSED.includes(l.status));
  const msgFor = (leadId: number, day: number, channel: string) => input.messages.find((m) => m.leadId === leadId && m.day === day && m.channel === channel);
  const unknownMessages = input.messages.filter((m) => !seen.has(keyOf(m.day, m.channel))).map((m) => ({ leadId: m.leadId, day: m.day, channel: m.channel }));

  // Preview: day by day, who gets what.
  const today = dhakaDate(new Date());
  const start = input.startDate && input.startDate > today ? input.startDate : null;
  const missing: { leadId: number; day: number; channel: string }[] = [];
  const preview = steps.map((s) => {
    const date = start ? stepDue(new Date(`${start}T06:00:00Z`), null, s.day, s.time, false) : null;
    return {
      day: s.day,
      date: date ? dhakaDate(date) : `day ${s.day} after you approve`,
      time: s.time,
      channel: s.channel,
      mode: s.mode,
      people: usable.map((l) => {
        const m = msgFor(l.id, s.day, s.channel);
        const body = m?.body ?? s.body ?? "";
        const c = contactFor(l as SequenceLead, s.channel === "call" ? "sms" : (s.channel as Channel));
        // Only worth flagging when they could actually get it.
        if (!body.trim() && s.channel !== "call" && "to" in c) missing.push({ leadId: l.id, day: s.day, channel: s.channel });
        const vars = { name: l.pageName, service: l.primaryService, link: link ?? "{link}", fields: leadFields(l) };
        return {
          leadId: l.id,
          name: l.pageName,
          to: "to" in c ? c.to : null,
          problem: "skip" in c ? `will be skipped: ${c.skip}` : undefined,
          own: Boolean(m),
          subject: s.channel === "email" ? renderTemplate(m?.subject ?? s.subject ?? "", vars).slice(0, 200) : undefined,
          message: renderTemplate(body, vars).slice(0, 400)
        };
      })
    };
  });
  const usesLink = steps.some((s) => /\{link\}/i.test(s.body ?? "")) || input.messages.some((m) => /\{link\}/i.test(m.body));
  const problems = [
    ...(notFound.length ? [`${notFound.length} lead ids not found: ${notFound.join(", ")}`] : []),
    ...(closed.length ? [`${closed.length} leads are won/lost/skipped and left out`] : []),
    ...(missing.length ? [`${missing.length} messages are empty (no step text and no personal message) — those will be skipped`] : []),
    ...(unknownMessages.length ? [`${unknownMessages.length} messages don't match any step (day + channel)`] : []),
    ...(usesLink && !link ? ["A message uses {link} but no link was given"] : [])
  ];
  const summary = { name, leads: usable.length, steps: steps.length, messages: usable.length * steps.length, startDate: start, problems, notFound, closed, missing: missing.slice(0, 50) };
  if (input.dryRun || !usable.length || (usesLink && !link)) return { dryRun: true as const, ...summary, preview };

  // Commit everything in one transaction.
  const result = await db.transaction(async (tx) => {
    const LL = schema.leadLists;
    let [list] = await tx
      .select({ id: LL.id })
      .from(LL)
      .where(and(eq(LL.workspaceId, workspaceId), eq(LL.name, name)))
      .limit(1);
    if (!list) [list] = await tx.insert(LL).values({ workspaceId, name, source: "ai", createdBy: userId, description: "Made with an outreach plan" }).returning({ id: LL.id });
    await tx
      .insert(schema.leadListItems)
      .values(usable.map((l, i) => ({ listId: list.id, leadId: l.id, position: i })))
      .onConflictDoNothing();

    let [seq] = await tx
      .select()
      .from(S)
      .where(and(eq(S.workspaceId, workspaceId), eq(S.name, name)))
      .limit(1);
    if (seq) {
      [seq] = await tx
        .update(S)
        .set({ destinationUrl: link ?? seq.destinationUrl, startDate: start ?? seq.startDate, listId: list.id, updatedAt: new Date() })
        .where(eq(S.id, seq.id))
        .returning();
    } else {
      const [sender] = await tx.select({ id: schema.emailSenders.id }).from(schema.emailSenders).where(eq(schema.emailSenders.workspaceId, workspaceId)).limit(1);
      [seq] = await tx
        .insert(S)
        .values({ workspaceId, name, status: "draft", destinationUrl: link, startDate: start, listId: list.id, emailSenderId: sender?.id ?? null, createdBy: userId })
        .returning();
    }

    // Steps: same day + channel keeps its id (and anything already sent); new ones are added.
    const existing = await tx.select().from(ST).where(eq(ST.sequenceId, seq.id));
    const stepIds = new Map<string, number>();
    for (const [position, s] of steps.entries()) {
      const old = existing.find((x) => x.day === s.day && x.channel === s.channel);
      const values = { position, day: s.day, sendTime: s.time, channel: s.channel, mode: s.mode, subject: s.channel === "email" ? (s.subject ?? old?.subject ?? null) : null, body: s.body ?? old?.body ?? "" };
      if (old) {
        await tx.update(ST).set(values).where(eq(ST.id, old.id));
        stepIds.set(keyOf(s.day, s.channel), old.id);
      } else {
        const [row] = await tx.insert(ST).values({ ...values, sequenceId: seq.id }).returning({ id: ST.id });
        stepIds.set(keyOf(s.day, s.channel), row.id);
      }
    }
    // Steps left out are removed only while nothing has run yet.
    const dropped = existing.filter((x) => !stepIds.has(keyOf(x.day, x.channel)));
    if (dropped.length && seq.status === "draft") await tx.delete(ST).where(inArray(ST.id, dropped.map((d) => d.id)));
    else for (const [i, d] of dropped.entries()) await tx.update(ST).set({ position: steps.length + i }).where(eq(ST.id, d.id));

    const enrolled = await tx
      .insert(E)
      .values(usable.map((l) => ({ workspaceId, sequenceId: seq.id, leadId: l.id, state: "waiting", enrolledBy: userId })))
      .onConflictDoNothing()
      .returning({ leadId: E.leadId });
    if (enrolled.length)
      await tx.insert(schema.leadActivities).values(
        enrolled.map((r) => ({ workspaceId, leadId: r.leadId, userId, type: "sequence", body: `Added to plan “${name}” (waiting for your OK)`, meta: { via: "ai" } }))
      );

    // Each person's messages: new ones are drafts; ones not prepared yet are updated.
    const rows = usable.flatMap((l) =>
      steps
        .map((s) => ({ s, m: msgFor(l.id, s.day, s.channel) }))
        .filter(({ m }) => m)
        .map(({ s, m }) => ({
          workspaceId,
          sequenceId: seq.id,
          stepId: stepIds.get(keyOf(s.day, s.channel))!,
          leadId: l.id,
          subject: s.channel === "email" ? (m!.subject ?? s.subject ?? null) : null,
          body: m!.body.slice(0, 10000),
          status: "draft"
        }))
    );
    for (let i = 0; i < rows.length; i += 500)
      await tx
        .insert(PM)
        .values(rows.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [PM.stepId, PM.leadId],
          set: { body: sql`excluded.body`, subject: sql`excluded.subject`, updatedAt: new Date() },
          setWhere: sql`${PM.status} in ('draft', 'approved')`
        });
    return { seq, listId: list.id, enrolled: enrolled.length };
  });
  await refreshSchedule(result.seq.id);
  return { dryRun: false as const, planId: result.seq.id, listId: result.listId, newlyAdded: result.enrolled, status: result.seq.status, ...summary, preview };
}

/** Sent / replied / demo / won for a plan, per lead and per channel. */
export async function planReport(workspaceId: number, sequenceId: number) {
  const plan = await getPlan(workspaceId, sequenceId);
  if (!plan) return null;
  const leadIds = plan.rows.map((r) => r.lead.id);
  const acts = leadIds.length
    ? await db
        .select({ leadId: schema.leadActivities.leadId, type: schema.leadActivities.type, channel: schema.leadActivities.channel })
        .from(schema.leadActivities)
        .where(and(inArray(schema.leadActivities.leadId, leadIds), notInArray(schema.leadActivities.type, ["note", "status", "sequence"])))
    : [];
  const channels: Record<string, { sent: number; replied: number }> = {};
  for (const st of plan.steps) channels[st.channel] ??= { sent: 0, replied: 0 };
  const perLead = plan.rows.map((r) => {
    const sent = r.cells.filter((c) => c.status === "sent").length;
    r.cells.forEach((c, i) => c.status === "sent" && channels[plan.steps[i].channel] && channels[plan.steps[i].channel].sent++);
    const replies = acts.filter((a) => a.leadId === r.lead.id && a.type.endsWith("_reply"));
    for (const a of replies) if (a.channel) (channels[a.channel] ??= { sent: 0, replied: 0 }).replied++;
    return {
      leadId: r.lead.id,
      name: r.lead.name,
      leadStatus: r.lead.status,
      planState: r.enrollment.state,
      sent,
      replied: replies.length > 0,
      demo: ["proposal", "won"].includes(r.lead.status) || acts.some((a) => a.leadId === r.lead.id && a.type === "meeting"),
      won: r.lead.status === "won"
    };
  });
  const totals = {
    leads: perLead.length,
    messagesSent: perLead.reduce((n, p) => n + p.sent, 0),
    replied: perLead.filter((p) => p.replied).length,
    demo: perLead.filter((p) => p.demo).length,
    won: perLead.filter((p) => p.won).length
  };
  return { plan: { id: plan.seq.id, name: plan.seq.name, status: plan.seq.status }, totals, byChannel: channels, perLead, stepLabels: plan.steps.map((s) => `Day ${s.day} ${CHANNEL_LABEL[s.channel]}`) };
}

/** Every step that will run between two moments (for "what's planned on <date>"), from running and waiting plans. */
export async function plannedBetween(workspaceId: number, from: Date, to: Date) {
  const rows = await db
    .select({ e: E, seq: { id: S.id, name: S.name, status: S.status, startDate: S.startDate }, lead: { id: L.id, name: L.pageName } })
    .from(E)
    .innerJoin(S, eq(S.id, E.sequenceId))
    .innerJoin(L, eq(L.id, E.leadId))
    .where(and(eq(E.workspaceId, workspaceId), inArray(E.state, ["active", "waiting"])))
    .limit(5000);
  if (!rows.length) return [];
  const seqIds = [...new Set(rows.map((r) => r.seq.id))];
  const steps = await db.select().from(ST).where(inArray(ST.sequenceId, seqIds)).orderBy(asc(ST.position));
  const pms = await db
    .select()
    .from(PM)
    .where(and(inArray(PM.sequenceId, seqIds), inArray(PM.leadId, [...new Set(rows.map((r) => r.lead.id))])));
  const now = new Date();
  const out = [];
  for (const { e, seq, lead } of rows) {
    const mine = steps.filter((s) => s.sequenceId === seq.id);
    for (const [i, st] of mine.entries()) {
      if (i < e.currentStep) continue;
      const pm = pms.find((x) => x.stepId === st.id && x.leadId === lead.id);
      if (pm && (pm.status === "skipped" || pm.status === "cancelled")) continue;
      // Waiting leads start the day you approve; assume today.
      const at = stepDue(e.state === "waiting" ? now : e.enrolledAt, seq.startDate, st.day, st.sendTime, false);
      if (at < from || at >= to) continue;
      out.push({
        planId: seq.id,
        plan: seq.name,
        lead,
        day: st.day,
        channel: st.channel,
        mode: st.mode === "auto" && st.channel !== "call" ? "app sends it" : "by hand (will appear on Today)",
        status: e.state === "waiting" || seq.status !== "active" ? "waiting for approval" : (pm?.status ?? "planned"),
        at,
        subject: pm?.subject ?? st.subject,
        message: pm?.body ?? st.body,
        own: Boolean(pm)
      });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 500);
}
