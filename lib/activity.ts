import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const L = schema.leads;

type Kind = { label: string; channel?: "sms" | "whatsapp" | "email" | "phone"; dir?: "out" | "in"; manual?: boolean };

/** Every kind of touch that can appear on a lead's timeline. `manual` ones can be logged by hand or by AI. */
export const ACTIVITY_KINDS = {
  note: { label: "Note", manual: true },
  status: { label: "Status" },
  created: { label: "Added" },
  form: { label: "Website form", dir: "in" },
  click: { label: "Link click", dir: "in" },
  sms_sent: { label: "SMS sent", channel: "sms", dir: "out", manual: true },
  wa_sent: { label: "WhatsApp sent", channel: "whatsapp", dir: "out", manual: true },
  email_sent: { label: "Email sent", channel: "email", dir: "out", manual: true },
  call: { label: "Call", channel: "phone", dir: "out", manual: true },
  meeting: { label: "Meeting", dir: "out", manual: true },
  wa_reply: { label: "WhatsApp reply", channel: "whatsapp", dir: "in", manual: true },
  email_reply: { label: "Email reply", channel: "email", dir: "in", manual: true },
  sms_reply: { label: "SMS reply", channel: "sms", dir: "in", manual: true },
  wa_out: { label: "You replied on WhatsApp", channel: "whatsapp", dir: "out" },
  email_out: { label: "You replied by email", channel: "email", dir: "out" },
  email_optout: { label: "Unsubscribed", channel: "email", dir: "in" }
} satisfies Record<string, Kind>;

export type ActivityType = keyof typeof ACTIVITY_KINDS;
export const MANUAL_TYPES = (Object.keys(ACTIVITY_KINDS) as ActivityType[]).filter((k) => (ACTIVITY_KINDS[k] as Kind).manual);
export const kindOf = (type: string): Kind => (ACTIVITY_KINDS as Record<string, Kind>)[type] ?? { label: type };

/**
 * Logs one touch on a lead. Something we sent moves a "new" lead to "contacted";
 * a reply moves "new"/"contacted" to "interested". The lead must belong to the workspace.
 */
export async function logActivity(a: {
  workspaceId: number;
  leadId: number;
  userId?: number | null;
  type: ActivityType;
  body: string;
  meta?: Record<string, unknown>;
  at?: Date;
}) {
  const kind = kindOf(a.type);
  const [lead] = await db
    .select({ id: L.id })
    .from(L)
    .where(and(eq(L.id, a.leadId), eq(L.workspaceId, a.workspaceId)))
    .limit(1);
  if (!lead) return null;
  const at = a.at ?? new Date();
  const [row] = await db
    .insert(schema.leadActivities)
    .values({
      workspaceId: a.workspaceId,
      leadId: a.leadId,
      userId: a.userId ?? null,
      type: a.type,
      channel: kind.channel ?? null,
      body: a.body.slice(0, 4000),
      meta: a.meta ?? null,
      createdAt: at
    })
    .returning({ id: schema.leadActivities.id });
  await db
    .update(L)
    .set({
      updatedAt: new Date(),
      ...(kind.dir === "out" ? { lastContactedAt: at, status: sql`case when ${L.status} = 'new' then 'contacted'::lead_status else ${L.status} end` } : {}),
      ...(kind.dir === "in" && a.type !== "email_optout"
        ? { status: sql`case when ${L.status} in ('new','contacted') then 'interested'::lead_status else ${L.status} end` }
        : {})
    })
    .where(eq(L.id, a.leadId));
  return row.id;
}
