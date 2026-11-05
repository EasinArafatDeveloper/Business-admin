"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { waSend } from "@/lib/wa";

const M = schema.inboundMessages;
export type ReplyState = { error?: string; ok?: number } | undefined;

/** Replies to a WhatsApp conversation from the campaign number and keeps it in the thread. */
export async function replyToThread(sender: string, _: ReplyState, formData: FormData): Promise<ReplyState> {
  const user = await requireUser();
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return { error: "Write a message first" };
  if (text.length > 2000) return { error: "Message is too long (2000 characters max)" };

  const [last] = await db
    .select({ channel: M.channel, leadId: M.leadId, optOut: M.optOut })
    .from(M)
    .where(and(eq(M.workspaceId, user.workspaceId), eq(M.sender, sender)))
    .orderBy(desc(M.createdAt))
    .limit(1);
  if (!last) return { error: "Conversation not found" };
  if (last.channel !== "whatsapp") return { error: "Replies are only available for WhatsApp for now" };

  const res = await waSend(sender, text);
  if (!res.ok)
    return { error: res.result === "disconnected" ? "WhatsApp is not connected — open Channels and scan the QR" : `Not sent — ${res.info ?? res.result}` };

  await db.insert(M).values({
    workspaceId: user.workspaceId,
    channel: "whatsapp",
    sender,
    body: text,
    leadId: last.leadId,
    direction: "out",
    userId: user.id,
    readAt: new Date()
  });
  if (last.leadId) {
    await db.insert(schema.leadActivities).values({
      workspaceId: user.workspaceId,
      leadId: last.leadId,
      userId: user.id,
      type: "wa_out",
      body: `You replied on WhatsApp: ${text}`
    });
  }
  revalidatePath("/inbox");
  return { ok: Date.now() };
}
