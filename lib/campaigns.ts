import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { type LeadFilters, whereFor } from "@/lib/leads-query";
import { normalizeBdMobile, renderTemplate } from "@/lib/sms-text";
import { FATAL_CODES, sendSms } from "@/lib/sms";
import { linkBase, newCode } from "@/lib/tracking";

const L = schema.leads;
const C = schema.campaigns;
const R = schema.campaignRecipients;

export const MAX_RECIPIENTS = 50_000;

/** Leads matching the filters that can get an SMS: valid BD mobile, not opted out, one per number. */
export async function buildAudience(workspaceId: number, filters: LeadFilters) {
  const rows = await db
    .select({ id: L.id, name: L.pageName, service: L.primaryService, phone: L.phone, whatsapp: L.whatsapp })
    .from(L)
    .where(and(whereFor(workspaceId, filters), eq(L.smsOptOut, false)))
    .orderBy(sql`${L.score} desc nulls last`, asc(L.id))
    .limit(MAX_RECIPIENTS * 2);

  const seen = new Set<string>();
  const audience: { leadId: number; phone: string; name: string | null; service: string | null }[] = [];
  let noNumber = 0;
  let duplicate = 0;
  for (const r of rows) {
    const phone = normalizeBdMobile(r.phone) ?? normalizeBdMobile(r.whatsapp);
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
}) {
  const { audience } = await buildAudience(input.workspaceId, input.filters);
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
      ratePerMinute: input.ratePerMinute,
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
        return {
          workspaceId: input.workspaceId,
          campaignId: campaign.id,
          leadId: a.leadId,
          phone: a.phone,
          trackingCode: code,
          message: renderTemplate(input.message, { name: a.name, service: a.service, link: `${base}/${code}` })
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

/** One pass: for every sending campaign, send up to its per-tick share of messages. */
async function tick() {
  const active = await db.select({ id: C.id, rate: C.ratePerMinute }).from(C).where(eq(C.status, "sending"));
  for (const camp of active) {
    const batch = Math.max(1, Math.round((camp.rate * TICK_MS) / 60_000));
    // Claim rows so a restart or second tick can't send the same SMS twice.
    const claimed = await db.execute<{ id: number; phone: string; message: string; lead_id: number | null }>(sql`
      update campaign_recipients set status = 'sending'
      where id in (
        select id from campaign_recipients where campaign_id = ${camp.id} and status = 'queued'
        order by id limit ${batch} for update skip locked
      )
      returning id, phone, message, lead_id`);
    const rows = [...claimed];

    for (const r of rows) {
      // Stop early if the campaign was paused or cancelled meanwhile.
      const [still] = await db.select({ status: C.status }).from(C).where(eq(C.id, camp.id)).limit(1);
      if (still?.status !== "sending") {
        await db.update(R).set({ status: "queued" }).where(and(eq(R.id, r.id), eq(R.status, "sending")));
        continue;
      }
      const res = await sendSms(r.phone, r.message);
      const now = new Date();
      if (res.ok) {
        await db.update(R).set({ status: "sent", sentAt: now, providerCode: res.code, error: null }).where(eq(R.id, r.id));
        await db.update(C).set({ sentCount: sql`${C.sentCount} + 1` }).where(eq(C.id, camp.id));
        if (r.lead_id) await db.update(L).set({ lastContactedAt: now }).where(eq(L.id, r.lead_id));
      } else if (FATAL_CODES.has(res.code) || res.code === "network") {
        // Account-level problem (balance, sender ID, network…): put it back and pause the campaign.
        await db.update(R).set({ status: "queued" }).where(eq(R.id, r.id));
        await db.update(C).set({ status: "paused", lastError: `${res.code}: ${res.info}` }).where(eq(C.id, camp.id));
        break;
      } else {
        await db.update(R).set({ status: "failed", providerCode: res.code, error: res.info }).where(eq(R.id, r.id));
        await db.update(C).set({ failedCount: sql`${C.failedCount} + 1` }).where(eq(C.id, camp.id));
      }
    }
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
