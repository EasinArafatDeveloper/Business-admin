"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { createCampaignWithRecipients } from "@/lib/campaigns";
import { parseFilters } from "@/lib/leads-query";
import { normalizeBdMobile, renderTemplate } from "@/lib/sms-text";
import { sendSms } from "@/lib/sms";
import { waSend } from "@/lib/wa";
import { safeUrl } from "@/lib/tracking";

const C = schema.campaigns;
export type ActionState = { error?: string; ok?: string } | undefined;

const createSchema = z.object({
  name: z.string().trim().min(2, "Give the campaign a name").max(120),
  message: z.string().trim().min(10, "Message is too short").max(1000).refine((m) => /\{link\}/i.test(m), "The message must contain {link}"),
  destinationUrl: z.string().trim().refine((u) => Boolean(safeUrl(u)), "Enter a full link starting with https://"),
  ratePerMinute: z.coerce.number().int().min(5).max(300),
  audienceQuery: z.string().max(2000).default(""),
  cleanNames: z.string().optional(),
  channel: z.enum(["sms", "whatsapp"]).default("sms"),
  minDelaySec: z.coerce.number().int().min(10).max(600).default(30),
  maxDelaySec: z.coerce.number().int().min(10).max(1200).default(90),
  dailyLimit: z.coerce.number().int().min(10).max(1000).default(150)
});

export async function createCampaign(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const q = new URLSearchParams(d.audienceQuery);
  const filters = parseFilters({ ...Object.fromEntries(q.entries()), has: q.getAll("has") });

  let id: number;
  try {
    id = await createCampaignWithRecipients({
      workspaceId: user.workspaceId,
      userId: user.id,
      name: d.name,
      message: d.message,
      destinationUrl: safeUrl(d.destinationUrl)!,
      audienceQuery: d.audienceQuery,
      ratePerMinute: d.ratePerMinute,
      filters,
      cleanNames: d.cleanNames === "on",
      channel: d.channel,
      minDelaySec: Math.min(d.minDelaySec, d.maxDelaySec),
      maxDelaySec: Math.max(d.minDelaySec, d.maxDelaySec),
      dailyLimit: d.dailyLimit
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the campaign" };
  }
  redirect(`/campaigns/${id}`);
}

async function owned(id: number) {
  const user = await requireUser();
  const [c] = await db.select().from(C).where(and(eq(C.id, id), eq(C.workspaceId, user.workspaceId))).limit(1);
  return c ? { user, c } : null;
}

export async function startCampaign(id: number) {
  const o = await owned(id);
  if (!o || !["draft", "paused"].includes(o.c.status)) return;
  await db.update(C).set({ status: "sending", lastError: null, startedAt: o.c.startedAt ?? new Date() }).where(eq(C.id, id));
  revalidatePath(`/campaigns/${id}`);
}

export async function pauseCampaign(id: number) {
  const o = await owned(id);
  if (!o || o.c.status !== "sending") return;
  await db.update(C).set({ status: "paused" }).where(eq(C.id, id));
  revalidatePath(`/campaigns/${id}`);
}

export async function cancelCampaign(id: number) {
  const o = await owned(id);
  if (!o || !["draft", "paused", "sending"].includes(o.c.status)) return;
  await db.update(C).set({ status: "cancelled", finishedAt: new Date() }).where(eq(C.id, id));
  // Unsent messages are dropped from the queue.
  await db
    .update(schema.campaignRecipients)
    .set({ status: "failed", error: "Campaign cancelled" })
    .where(and(eq(schema.campaignRecipients.campaignId, id), inArray(schema.campaignRecipients.status, ["queued", "sending"])));
  revalidatePath(`/campaigns/${id}`);
}

/** Sends the message to your own number first (same channel). The link in a test goes straight to the destination. */
export async function sendTestSms(id: number, _: ActionState, formData: FormData): Promise<ActionState> {
  const o = await owned(id);
  if (!o) return { error: "Campaign not found" };
  const phone = normalizeBdMobile(String(formData.get("phone") ?? ""));
  if (!phone) return { error: "Enter a Bangladeshi mobile number (01XXXXXXXXX)" };
  const text = renderTemplate(o.c.message, { name: "Test", service: "website", link: o.c.destinationUrl });
  if (o.c.channel === "whatsapp") {
    const wa = await waSend(phone, text);
    return wa.ok ? { ok: `Test WhatsApp sent to ${phone}` } : { error: `Not sent — ${wa.info ?? wa.result}` };
  }
  const res = await sendSms(phone, text);
  return res.ok ? { ok: `Test SMS sent to ${phone}` } : { error: `Not sent — ${res.info} (${res.code})` };
}
