import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { WA_HOURS, dhakaNow } from "@/lib/campaigns";
import { getBalance, smsRate } from "@/lib/sms";
import { getWaStatus, type WaStatus } from "@/lib/wa";

const C = schema.campaigns;
const R = schema.campaignRecipients;

/** Default WhatsApp daily cap shown when no campaign has set one yet (safe for a new number). */
export const WA_DEFAULT_DAILY = 30;

export type ChannelHealth = {
  sms: { configured: boolean; balance: number | null; rate: number; smsLeft: number | null; low: boolean };
  whatsapp: {
    status: WaStatus;
    sentToday: number;
    dailyLimit: number;
    windowOpen: boolean;
    window: string;
  };
};

/** Live state of every sending channel, for the Campaigns hub and the Channels page. */
export async function getChannelHealth(workspaceId: number): Promise<ChannelHealth> {
  const { hour, startOfDay } = dhakaNow();
  const configured = Boolean(process.env.BULKSMSBD_API_KEY && process.env.BULKSMSBD_SENDER_ID);
  const [balance, status, [today], [latest]] = await Promise.all([
    configured ? getBalance() : Promise.resolve(null),
    getWaStatus(),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(R)
      .innerJoin(C, eq(C.id, R.campaignId))
      .where(and(eq(C.workspaceId, workspaceId), eq(C.channel, "whatsapp"), eq(R.status, "sent"), gte(R.sentAt, startOfDay))),
    // The running campaign's cap wins; otherwise the most recent WhatsApp campaign's.
    db
      .select({ dailyLimit: C.dailyLimit })
      .from(C)
      .where(and(eq(C.workspaceId, workspaceId), eq(C.channel, "whatsapp")))
      .orderBy(sql`(${C.status} = 'sending') desc`, desc(C.id))
      .limit(1)
  ]);
  const rate = smsRate();
  const smsLeft = balance == null ? null : Math.floor(balance / rate);
  const fmt = (h: number) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
  return {
    sms: { configured, balance, rate, smsLeft, low: smsLeft != null && smsLeft < 100 },
    whatsapp: {
      status: { ...status, qr: null },
      sentToday: today?.n ?? 0,
      dailyLimit: latest?.dailyLimit ?? WA_DEFAULT_DAILY,
      windowOpen: hour >= WA_HOURS.from && hour < WA_HOURS.to,
      window: `${fmt(WA_HOURS.from)}–${fmt(WA_HOURS.to)}`
    }
  };
}
