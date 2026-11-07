import "server-only";
import { and, asc, eq, gte, inArray, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { type LeadFilters, whereFor } from "@/lib/leads-query";
import { type LeadFields, leadFields, normalizeBdMobile, renderTemplate, smsParts } from "@/lib/sms-text";
import { FATAL_CODES, sendSms } from "@/lib/sms";
import { linkBase, newCode } from "@/lib/tracking";
import { waSend } from "@/lib/wa";
import { normalizeEmail, sendEmail } from "@/lib/email";
import { type PastedEntry, prettyBd } from "@/lib/paste-audience";

const L = schema.leads;
const C = schema.campaigns;
const R = schema.campaignRecipients;

export const MAX_RECIPIENTS = 50_000;
export type Channel = "sms" | "whatsapp" | "email";

/** Base URL of the public unsubscribe page (same host as the tracking links). */
export const unsubscribeUrl = (code: string) => `${new URL(linkBase()).origin}/u/${code}`;
const EMAIL_FOOTER = (url: string) => `

--
Don't want these emails? Unsubscribe: ${url}`;

/** WhatsApp only sends in these Dhaka hours (people reply; nobody gets pinged at night). */
export const WA_HOURS = { from: 9, to: 21 };

/**
 * Leads matching the filters that can get a message on this channel: valid BD mobile,
 * not opted out of the channel, one per number. WhatsApp prefers the WhatsApp column.
 */
export async function buildAudience(workspaceId: number, filters: LeadFilters, channel: Channel = "sms") {
  const optOut = channel === "whatsapp" ? L.waOptOut : channel === "email" ? L.emailOptOut : L.smsOptOut;
  const rows = await db
    .select({ id: L.id, name: L.pageName, service: L.primaryService, phone: L.phone, whatsapp: L.whatsapp, email: L.email, ...FIELD_COLS })
    .from(L)
    .where(and(whereFor(workspaceId, filters), eq(optOut, false)))
    .orderBy(sql`${L.score} desc nulls last`, asc(L.id))
    .limit(MAX_RECIPIENTS * 2);

  // From a saved list: each lead may have their own message (written by you or the AI).
  const personal = new Map<number, { message: string | null; subject: string | null }>();
  if (filters.list !== undefined) {
    const items = await db
      .select({
        leadId: schema.leadListItems.leadId,
        message: schema.leadListItems.message,
        subject: schema.leadListItems.subject,
        emailBody: schema.leadListItems.emailBody
      })
      .from(schema.leadListItems)
      .where(eq(schema.leadListItems.listId, filters.list));
    for (const it of items) {
      const text = channel === "email" ? it.emailBody?.trim() || it.message?.trim() : it.message?.trim();
      if (text) personal.set(it.leadId, { message: text, subject: channel === "email" ? it.subject : null });
    }
  }

  const seen = new Set<string>();
  const audience: {
    leadId: number;
    phone: string;
    name: string | null;
    service: string | null;
    fields?: LeadFields;
    personal?: { message: string; subject: string | null };
  }[] = [];
  let noNumber = 0;
  let duplicate = 0;
  for (const r of rows) {
    const phone =
      channel === "email"
        ? normalizeEmail(r.email)
        : channel === "whatsapp"
          ? (normalizeBdMobile(r.whatsapp) ?? normalizeBdMobile(r.phone))
          : (normalizeBdMobile(r.phone) ?? normalizeBdMobile(r.whatsapp));
    if (!phone) {
      noNumber++;
      continue;
    }
    if (seen.has(phone)) {
      duplicate++;
      continue;
    }
    seen.add(phone);
    const own = personal.get(r.id);
    if (audience.length < MAX_RECIPIENTS)
      audience.push({
        leadId: r.id,
        phone,
        name: r.name,
        service: r.service,
        fields: leadFields(r),
        personal: own?.message ? { message: own.message, subject: own.subject } : undefined
      });
  }
  return { audience, matched: rows.length, noNumber, duplicate, personalCount: audience.filter((a) => a.personal).length };
}

/**
 * Audience from pasted numbers / emails. Each one is matched to an existing lead when possible
 * (so clicks and replies show on that lead); people who opted out of this channel are skipped;
 * the rest can be saved as new "manual" leads.
 */
/** Lead columns behind the {ads} {days} {followers}… placeholders. */
const FIELD_COLS = {
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

/**
 * Finds existing leads for pasted mobiles (last 10 digits of phone/WhatsApp) or emails.
 * Returns key → lead, where key is the email or the last 10 digits.
 */
export async function findLeadsByContacts(workspaceId: number, contacts: string[], channel: Channel) {
  const keyOf = (to: string) => (channel === "email" ? to.toLowerCase() : to.slice(-10));
  const keys = [...new Set(contacts.map(keyOf))];
  const digits10 = (c: AnyPgColumn) => sql<string>`right(regexp_replace(coalesce(${c}, ''), '\\D', '', 'g'), 10)`;
  const found = keys.length
    ? await db
        .select({
          id: L.id,
          name: L.pageName,
          service: L.primaryService,
          status: L.status,
          priority: L.priority,
          phone: digits10(L.phone),
          whatsapp: digits10(L.whatsapp),
          email: sql<string>`lower(coalesce(${L.email}, ''))`,
          smsOptOut: L.smsOptOut,
          waOptOut: L.waOptOut,
          emailOptOut: L.emailOptOut,
          ...FIELD_COLS
        })
        .from(L)
        .where(
          and(
            eq(L.workspaceId, workspaceId),
            channel === "email"
              ? or(...keys.map((k) => sql`lower(coalesce(${L.email}, '')) like ${`%${k}%`}`))!
              : sql`(${inArray(digits10(L.phone), keys)} or ${inArray(digits10(L.whatsapp), keys)})`
          )
        )
    : [];
  const byKey = new Map<string, (typeof found)[number] & { fields: LeadFields }>();
  for (const l of found) {
    const withFields = { ...l, fields: leadFields(l) };
    if (channel === "email") {
      for (const k of keys) if (l.email.includes(k) && !byKey.has(k)) byKey.set(k, withFields);
    } else {
      for (const k of [l.whatsapp, l.phone]) if (k && keys.includes(k) && !byKey.has(k)) byKey.set(k, withFields);
    }
  }
  return { byKey, keyOf };
}

/**
 * Audience from pasted numbers / emails. Each one is matched to an existing lead when possible
 * (so clicks and replies show on that lead, and {ads} {days}… use its data); people who opted out
 * of this channel are skipped; the rest can be saved as new "manual" leads.
 */
export async function buildPastedAudience(workspaceId: number, entries: PastedEntry[], channel: Channel, saveAsLeads: boolean) {
  const { byKey, keyOf } = await findLeadsByContacts(
    workspaceId,
    entries.map((e) => e.to),
    channel
  );

  const audience: {
    leadId: number | null;
    phone: string;
    name: string | null;
    service: string | null;
    fields?: LeadFields;
    personal?: { message: string; subject: string | null };
  }[] = [];
  let optedOut = 0;
  let matched = 0;
  const toCreate: PastedEntry[] = [];
  for (const e of entries) {
    const lead = byKey.get(keyOf(e.to));
    if (lead) {
      const out = channel === "whatsapp" ? lead.waOptOut : channel === "email" ? lead.emailOptOut : lead.smsOptOut;
      if (out) {
        optedOut++;
        continue;
      }
      matched++;
      audience.push({ leadId: lead.id, phone: e.to, name: e.name ?? lead.name, service: lead.service, fields: lead.fields });
    } else {
      audience.push({ leadId: null, phone: e.to, name: e.name, service: null });
      if (saveAsLeads) toCreate.push(e);
    }
  }

  if (toCreate.length) {
    const created = await db
      .insert(L)
      .values(
        toCreate.map((e) => ({
          workspaceId,
          source: "manual",
          externalKey: `manual:${e.to}`,
          pageName: e.name ?? (channel === "email" ? e.to : prettyBd(e.to)),
          ...(channel === "email" ? { email: e.to } : { phone: prettyBd(e.to), whatsapp: channel === "whatsapp" ? prettyBd(e.to) : null })
        }))
      )
      .onConflictDoNothing()
      .returning({ id: L.id, key: L.externalKey });
    const idOf = new Map(created.map((c) => [c.key, c.id]));
    for (const a of audience) if (a.leadId === null) a.leadId = idOf.get(`manual:${a.phone}`) ?? null;
  }
  return { audience, matched, optedOut, created: toCreate.length };
}

/** Creates the campaign and one recipient row (unique code + final message) per person. */
export async function createCampaignWithRecipients(input: {
  workspaceId: number;
  userId: number;
  name: string;
  message: string;
  destinationUrl: string;
  audienceQuery: string;
  ratePerMinute: number;
  filters: LeadFilters;
  /** Drop Bangla/emoji from names so SMS stay in cheap English parts. */
  cleanNames: boolean;
  channel?: Channel;
  minDelaySec?: number;
  maxDelaySec?: number;
  dailyLimit?: number;
  subject?: string;
  senderId?: number;
  /** Send each lead their own saved message (from a list) instead of the shared one, when they have one. */
  usePersonal?: boolean;
  /** Pasted numbers / emails instead of lead filters. */
  pasted?: PastedEntry[];
  saveAsLeads?: boolean;
}) {
  const channel = input.channel ?? "sms";
  const { audience } = input.pasted
    ? await buildPastedAudience(input.workspaceId, input.pasted, channel, input.saveAsLeads ?? true)
    : await buildAudience(input.workspaceId, input.filters, channel);
  if (audience.length === 0)
    throw new Error(
      channel === "email" ? "No leads with a valid email address match these filters." : "No leads with a valid Bangladeshi mobile number match these filters."
    );

  const [campaign] = await db
    .insert(C)
    .values({
      workspaceId: input.workspaceId,
      createdBy: input.userId,
      name: input.name,
      message: input.message,
      destinationUrl: input.destinationUrl,
      audienceQuery: input.audienceQuery,
      channel,
      ratePerMinute: input.ratePerMinute,
      minDelaySec: input.minDelaySec ?? 30,
      maxDelaySec: input.maxDelaySec ?? 90,
      dailyLimit: input.dailyLimit ?? 150,
      subject: input.subject ?? null,
      senderId: input.senderId ?? null,
      totalRecipients: audience.length
    })
    .returning({ id: C.id });

  const base = linkBase();
  for (let i = 0; i < audience.length; i += 1000) {
    let pending = audience.slice(i, i + 1000);
    // Codes are random (31^6 ≈ 887 million); on the rare clash just draw again.
    for (let attempt = 0; pending.length > 0 && attempt < 5; attempt++) {
      const rows = pending.map((a) => {
        const code = newCode();
        const vars = { name: a.name, service: a.service, link: `${base}/${code}`, fields: a.fields };
        const own = input.usePersonal ? a.personal : undefined;
        // A personal message still needs the tracking link; add it at the end if it was left out.
        const template = own ? (/\{link\}/i.test(own.message) ? own.message : `${own.message.trim()}${channel === "sms" ? " " : "\n\n"}{link}`) : input.message;
        let message = renderTemplate(template, vars, { cleanNames: input.cleanNames });
        if (channel === "email") message += EMAIL_FOOTER(unsubscribeUrl(code));
        return {
          workspaceId: input.workspaceId,
          campaignId: campaign.id,
          leadId: a.leadId,
          phone: a.phone,
          trackingCode: code,
          message,
          subject: channel === "email" ? renderTemplate(own?.subject || input.subject || "", vars).slice(0, 200) : null,
          parts: channel === "sms" ? smsParts(message).parts : 1
        };
      });
      const inserted = await db.insert(R).values(rows).onConflictDoNothing({ target: R.trackingCode }).returning({ leadId: R.leadId });
      const done = new Set(inserted.map((r) => r.leadId));
      pending = pending.filter((a) => !done.has(a.leadId));
    }
  }
  return campaign.id;
}

/* ---------------------------------------------------------------- sending queue */

const TICK_MS = 5000;

async function finishIfEmpty(campaignId: number) {
  const [{ left }] = await db
    .select({ left: sql<number>`count(*)::int` })
    .from(R)
    .where(and(eq(R.campaignId, campaignId), inArray(R.status, ["queued", "sending"])));
  if (left === 0)
    await db
      .update(C)
      .set({ status: "done", finishedAt: new Date() })
      .where(and(eq(C.id, campaignId), eq(C.status, "sending")));
}

/** Claims up to `n` queued recipients so a restart or second tick can't send the same message twice. */
async function claim(campaignId: number, n: number) {
  const rows = await db.execute<{ id: number; phone: string; message: string; subject: string | null; tracking_code: string; lead_id: number | null }>(sql`
    update campaign_recipients set status = 'sending'
    where id in (
      select id from campaign_recipients where campaign_id = ${campaignId} and status = 'queued'
      order by id limit ${n} for update skip locked
    )
    returning id, phone, message, subject, tracking_code, lead_id`);
  return [...rows];
}

async function markSent(campaignId: number, r: { id: number; lead_id: number | null; message: string; subject: string | null }, code: string | null) {
  const now = new Date();
  await db.update(R).set({ status: "sent", sentAt: now, providerCode: code, error: null }).where(eq(R.id, r.id));
  const [camp] = await db
    .update(C)
    .set({ sentCount: sql`${C.sentCount} + 1` })
    .where(eq(C.id, campaignId))
    .returning({ workspaceId: C.workspaceId, channel: C.channel, name: C.name });
  if (r.lead_id && camp) {
    await db.update(L).set({ lastContactedAt: now }).where(eq(L.id, r.lead_id));
    // One timeline row per message, so the lead page shows exactly what they got and when.
    await db.insert(schema.leadActivities).values({
      workspaceId: camp.workspaceId,
      leadId: r.lead_id,
      type: `${camp.channel === "whatsapp" ? "wa" : camp.channel}_sent`,
      channel: camp.channel,
      body: ((r.subject ? `${r.subject}\n` : "") + r.message).slice(0, 1000),
      meta: { campaignId, campaign: camp.name, recipientId: r.id },
      createdAt: now
    });
  }
}

async function markFailed(campaignId: number, recipientId: number, code: string | null, error: string) {
  await db.update(R).set({ status: "failed", providerCode: code, error }).where(eq(R.id, recipientId));
  await db
    .update(C)
    .set({ failedCount: sql`${C.failedCount} + 1` })
    .where(eq(C.id, campaignId));
}

async function pause(campaignId: number, recipientId: number, reason: string) {
  await db.update(R).set({ status: "queued" }).where(eq(R.id, recipientId));
  await db.update(C).set({ status: "paused", lastError: reason }).where(eq(C.id, campaignId));
}

async function stillSending(campaignId: number) {
  const [c] = await db.select({ status: C.status }).from(C).where(eq(C.id, campaignId)).limit(1);
  return c?.status === "sending";
}

async function tickSms(camp: { id: number; ratePerMinute: number }) {
  const batch = Math.max(1, Math.round((camp.ratePerMinute * TICK_MS) / 60_000));
  for (const r of await claim(camp.id, batch)) {
    if (!(await stillSending(camp.id))) {
      await db
        .update(R)
        .set({ status: "queued" })
        .where(and(eq(R.id, r.id), eq(R.status, "sending")));
      continue;
    }
    const res = await sendSms(r.phone, r.message);
    if (res.ok) await markSent(camp.id, r, res.code);
    else if (FATAL_CODES.has(res.code) || res.code === "network") {
      // Account-level problem (balance, sender ID, network…): pause, the rest can't succeed either.
      await pause(camp.id, r.id, `${res.code}: ${res.info}`);
      break;
    } else await markFailed(camp.id, r.id, res.code, res.info);
  }
}

/** Dhaka hour 0–23 and start of today's Dhaka day (UTC+6, no DST). */
export function dhakaNow() {
  const now = new Date();
  const local = new Date(now.getTime() + 6 * 3600_000);
  const hour = local.getUTCHours();
  const startOfDay = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 6 * 3600_000);
  return { now, hour, startOfDay };
}

/** One WhatsApp message per campaign per due time, with a random human-like gap. */
async function tickWhatsapp(camp: { id: number; workspaceId: number; minDelaySec: number; maxDelaySec: number; dailyLimit: number; nextSendAt: Date | null }) {
  const { now, hour, startOfDay } = dhakaNow();
  if (hour < WA_HOURS.from || hour >= WA_HOURS.to) return;
  if (camp.nextSendAt && camp.nextSendAt > now) return;

  // Daily cap is per WhatsApp number, i.e. across every WhatsApp campaign of the workspace.
  const [{ today }] = await db
    .select({ today: sql<number>`count(*)::int` })
    .from(R)
    .innerJoin(C, eq(C.id, R.campaignId))
    .where(and(eq(C.workspaceId, camp.workspaceId), eq(C.channel, "whatsapp"), eq(R.status, "sent"), gte(R.sentAt, startOfDay)));
  if (today >= camp.dailyLimit) return;

  const [r] = await claim(camp.id, 1);
  if (!r) return;
  const res = await waSend(r.phone, r.message);
  if (res.result === "ok") await markSent(camp.id, r, "wa");
  else if (res.result === "not_on_whatsapp") await markFailed(camp.id, r.id, "not_on_whatsapp", "Not on WhatsApp");
  else if (res.result === "disconnected") return pause(camp.id, r.id, "WhatsApp is not connected — open WhatsApp in the admin and scan the QR");
  else await markFailed(camp.id, r.id, "error", res.info ?? "Send failed");

  // Nothing was sent to a number that isn't on WhatsApp, so no need to wait the full gap.
  const gap = res.result === "not_on_whatsapp" ? 3 : camp.minDelaySec + Math.random() * Math.max(0, camp.maxDelaySec - camp.minDelaySec);
  await db
    .update(C)
    .set({ nextSendAt: new Date(Date.now() + gap * 1000) })
    .where(eq(C.id, camp.id));
}

/** Emails sent today from one sender, across all its campaigns. */
export async function emailsSentToday(senderId: number) {
  const { startOfDay } = dhakaNow();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(R)
    .innerJoin(C, eq(C.id, R.campaignId))
    .where(and(eq(C.senderId, senderId), eq(R.status, "sent"), gte(R.sentAt, startOfDay)));
  return n;
}

/** One email per due time with a random gap, capped per sender per day. */
async function tickEmail(camp: { id: number; senderId: number | null; minDelaySec: number; maxDelaySec: number; nextSendAt: Date | null }) {
  const now = new Date();
  if (camp.nextSendAt && camp.nextSendAt > now) return;
  const [sender] = camp.senderId ? await db.select().from(schema.emailSenders).where(eq(schema.emailSenders.id, camp.senderId)).limit(1) : [];
  if (!sender) {
    await db.update(C).set({ status: "paused", lastError: "The email sender was removed — pick another sender" }).where(eq(C.id, camp.id));
    return;
  }
  if ((await emailsSentToday(sender.id)) >= sender.dailyLimit) return;

  const [r] = await claim(camp.id, 1);
  if (!r) return;
  const res = await sendEmail(sender, { to: r.phone, subject: r.subject ?? "", text: r.message, unsubscribeUrl: unsubscribeUrl(r.tracking_code) });
  if (res.ok) await markSent(camp.id, r, "email");
  else if (res.fatal) return pause(camp.id, r.id, res.info);
  else await markFailed(camp.id, r.id, res.code, res.info);

  const gap = camp.minDelaySec + Math.random() * Math.max(0, camp.maxDelaySec - camp.minDelaySec);
  await db
    .update(C)
    .set({ nextSendAt: new Date(Date.now() + gap * 1000) })
    .where(eq(C.id, camp.id));
}

async function tick() {
  const active = await db.select().from(C).where(eq(C.status, "sending"));
  for (const camp of active) {
    if (camp.channel === "email") await tickEmail(camp);
    else if (camp.channel === "whatsapp") await tickWhatsapp(camp);
    else await tickSms(camp);
    await finishIfEmpty(camp.id);
  }
}

/** Started once from instrumentation.ts. Survives restarts: rows stuck in "sending" go back to the queue. */
export async function startCampaignWorker() {
  const g = globalThis as unknown as { __campaignWorker?: boolean };
  if (g.__campaignWorker) return;
  g.__campaignWorker = true;
  await db.update(R).set({ status: "queued" }).where(eq(R.status, "sending"));
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
    } catch (e) {
      console.error("[campaigns] worker error", e);
    } finally {
      busy = false;
    }
  }, TICK_MS);
  console.log("[campaigns] sending worker started");
}
