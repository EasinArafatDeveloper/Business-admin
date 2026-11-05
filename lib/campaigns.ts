import "server-only";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { type LeadFilters, whereFor } from "@/lib/leads-query";
import { normalizeBdMobile, renderTemplate, smsParts } from "@/lib/sms-text";
import { FATAL_CODES, sendSms } from "@/lib/sms";
import { linkBase, newCode } from "@/lib/tracking";
import { waSend } from "@/lib/wa";

const L = schema.leads;
const C = schema.campaigns;
const R = schema.campaignRecipients;

export const MAX_RECIPIENTS = 50_000;
export type Channel = "sms" | "whatsapp";

/** WhatsApp only sends in these Dhaka hours (people reply; nobody gets pinged at night). */
export const WA_HOURS = { from: 9, to: 21 };

/**
 * Leads matching the filters that can get a message on this channel: valid BD mobile,
 * not opted out of the channel, one per number. WhatsApp prefers the WhatsApp column.
 */
export async function buildAudience(workspaceId: number, filters: LeadFilters, channel: Channel = "sms") {
  const optOut = channel === "whatsapp" ? L.waOptOut : L.smsOptOut;
  const rows = await db
    .select({ id: L.id, name: L.pageName, service: L.primaryService, phone: L.phone, whatsapp: L.whatsapp })
    .from(L)
    .where(and(whereFor(workspaceId, filters), eq(optOut, false)))
    .orderBy(sql`${L.score} desc nulls last`, asc(L.id))
    .limit(MAX_RECIPIENTS * 2);

  const seen = new Set<string>();
  const audience: { leadId: number; phone: string; name: string | null; service: string | null }[] = [];
  let noNumber = 0;
  let duplicate = 0;
  for (const r of rows) {
    const phone =
      channel === "whatsapp"
        ? normalizeBdMobile(r.whatsapp) ?? normalizeBdMobile(r.phone)
        : normalizeBdMobile(r.phone) ?? normalizeBdMobile(r.whatsapp);
    if (!phone) {
      noNumber++;
      continue;
    }
    if (seen.has(phone)) {
      duplicate++;
      continue;
    }
    seen.add(phone);
    if (audience.length < MAX_RECIPIENTS) audience.push({ leadId: r.id, phone, name: r.name, service: r.service });
  }
  return { audience, matched: rows.length, noNumber, duplicate };
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
}) {
  const channel = input.channel ?? "sms";
  const { audience } = await buildAudience(input.workspaceId, input.filters, channel);
  if (audience.length === 0) throw new Error("No leads with a valid Bangladeshi mobile number match these filters.");

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
        const message = renderTemplate(input.message, { name: a.name, service: a.service, link: `${base}/${code}` }, { cleanNames: input.cleanNames });
        return {
          workspaceId: input.workspaceId,
          campaignId: campaign.id,
          leadId: a.leadId,
          phone: a.phone,
          trackingCode: code,
          message,
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
  if (left === 0) await db.update(C).set({ status: "done", finishedAt: new Date() }).where(and(eq(C.id, campaignId), eq(C.status, "sending")));
}

/** Claims up to `n` queued recipients so a restart or second tick can't send the same message twice. */
async function claim(campaignId: number, n: number) {
  const rows = await db.execute<{ id: number; phone: string; message: string; lead_id: number | null }>(sql`
    update campaign_recipients set status = 'sending'
    where id in (
      select id from campaign_recipients where campaign_id = ${campaignId} and status = 'queued'
      order by id limit ${n} for update skip locked
    )
    returning id, phone, message, lead_id`);
  return [...rows];
}

async function markSent(campaignId: number, r: { id: number; lead_id: number | null }, code: string | null) {
  const now = new Date();
  await db.update(R).set({ status: "sent", sentAt: now, providerCode: code, error: null }).where(eq(R.id, r.id));
  await db.update(C).set({ sentCount: sql`${C.sentCount} + 1` }).where(eq(C.id, campaignId));
  if (r.lead_id) await db.update(L).set({ lastContactedAt: now }).where(eq(L.id, r.lead_id));
}

async function markFailed(campaignId: number, recipientId: number, code: string | null, error: string) {
  await db.update(R).set({ status: "failed", providerCode: code, error }).where(eq(R.id, recipientId));
  await db.update(C).set({ failedCount: sql`${C.failedCount} + 1` }).where(eq(C.id, campaignId));
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
      await db.update(R).set({ status: "queued" }).where(and(eq(R.id, r.id), eq(R.status, "sending")));
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
  await db.update(C).set({ nextSendAt: new Date(Date.now() + gap * 1000) }).where(eq(C.id, camp.id));
}

async function tick() {
  const active = await db.select().from(C).where(eq(C.status, "sending"));
  for (const camp of active) {
    if (camp.channel === "whatsapp") await tickWhatsapp(camp);
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
