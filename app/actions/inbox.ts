"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { waSend } from "@/lib/wa";

const M = schema.inboundMessages;
export type ReplyState = { error?: string; ok?: number } | undefined;

const reSubject = (s: string | null) => (s ? (/^re:/i.test(s) ? s : `Re: ${s}`) : "Re: your message");

/** Replies to a conversation on its own channel (WhatsApp number, or the email address it came to) and keeps it in the thread. */
export async function replyToThread(sender: string, _: ReplyState, formData: FormData): Promise<ReplyState> {
  const user = await requireUser();
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return { error: "Write a message first" };
  if (text.length > 5000) return { error: "Message is too long (5000 characters max)" };

  const [last] = await db
    .select({ channel: M.channel, leadId: M.leadId, subject: M.subject, emailSenderId: M.emailSenderId })
    .from(M)
    .where(and(eq(M.workspaceId, user.workspaceId), eq(M.sender, sender), eq(M.direction, "in")))
    .orderBy(desc(M.createdAt))
    .limit(1);
  if (!last) return { error: "Conversation not found" };

  let subject: string | null = null;
  let emailSenderId: number | null = null;
  let externalId: string | null = null;

  if (last.channel === "email") {
    const [from] = last.emailSenderId
      ? await db
          .select()
          .from(schema.emailSenders)
          .where(and(eq(schema.emailSenders.id, last.emailSenderId), eq(schema.emailSenders.workspaceId, user.workspaceId)))
          .limit(1)
      : [];
    if (!from) return { error: "The mailbox this came to was removed — add it again in Channels" };
    // Thread it under their messages so it shows as one conversation in their mail app.
    const ids = (
      await db
        .select({ id: M.externalId })
        .from(M)
        .where(and(eq(M.workspaceId, user.workspaceId), eq(M.sender, sender), isNotNull(M.externalId)))
        .orderBy(asc(M.createdAt))
        .limit(20)
    )
      .map((r) => r.id!)
      .filter((id) => id.includes("@"));
    subject = reSubject(last.subject);
    const res = await sendEmail(from, { to: sender, subject, text, inReplyTo: ids.at(-1), references: ids });
    if (!res.ok) return { error: `Not sent — ${res.info}` };
    emailSenderId = from.id;
    externalId = res.id;
  } else if (last.channel === "whatsapp") {
    if (text.length > 2000) return { error: "WhatsApp messages can be 2000 characters at most" };
    const res = await waSend(sender, text);
    if (!res.ok)
      return { error: res.result === "disconnected" ? "WhatsApp is not connected — open Channels and scan the QR" : `Not sent — ${res.info ?? res.result}` };
  } else {
    return { error: "Replies aren't available for this channel yet" };
  }

  await db.insert(M).values({
    workspaceId: user.workspaceId,
    channel: last.channel,
    sender,
    body: text,
    subject,
    externalId,
    emailSenderId,
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
      type: last.channel === "email" ? "email_out" : "wa_out",
      body: `You replied by ${last.channel === "email" ? "email" : "WhatsApp"}: ${text}`
    });
  }
  revalidatePath("/inbox");
  return { ok: Date.now() };
}
