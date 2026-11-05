"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { SMTP_PRESETS, normalizeEmail, sendEmail, verifySender } from "@/lib/email";
import { encryptSecret } from "@/lib/secrets";
import { IMAP_FOR_SMTP, syncSender } from "@/lib/email-inbox";

const S = schema.emailSenders;
export type SenderState = { error?: string; ok?: string } | undefined;

const addSchema = z.object({
  preset: z.enum(Object.keys(SMTP_PRESETS) as [keyof typeof SMTP_PRESETS, ...(keyof typeof SMTP_PRESETS)[]]),
  fromName: z.string().trim().min(2, "Enter the name people will see").max(80),
  fromEmail: z.string().trim().toLowerCase().email("Enter the address you send from"),
  smtpUser: z.string().trim().max(200).optional(),
  smtpPass: z.string().min(4, "Enter the password / app password").max(200),
  smtpHost: z.string().trim().max(200).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  replyTo: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  dailyLimit: z.coerce.number().int().min(10).max(2000),
  syncReplies: z.string().optional()
});

export async function addSender(_: SenderState, formData: FormData): Promise<SenderState> {
  const user = await requireUser();
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const preset = SMTP_PRESETS[d.preset];
  const smtpHost = d.preset === "custom" ? d.smtpHost : preset.host;
  if (!smtpHost) return { error: "Enter the SMTP server" };
  const row = {
    workspaceId: user.workspaceId,
    fromName: d.fromName,
    fromEmail: d.fromEmail,
    replyTo: d.replyTo || null,
    smtpHost,
    smtpPort: d.preset === "custom" ? (d.smtpPort ?? 465) : preset.port,
    smtpUser: d.smtpUser || d.fromEmail,
    // App passwords are often copied with spaces ("abcd efgh …").
    smtpPassEnc: encryptSecret(d.preset === "gmail" ? d.smtpPass.replace(/\s+/g, "") : d.smtpPass),
    dailyLimit: d.dailyLimit,
    imapHost: d.syncReplies === "on" ? (IMAP_FOR_SMTP[smtpHost] ?? null) : null
  };

  // Only save a sender that can actually log in.
  const check = await verifySender(row);
  if (!check.ok) return { error: `Could not sign in to ${smtpHost}: ${check.error}` };
  await db.insert(S).values({ ...row, verifiedAt: new Date() });
  revalidatePath("/channels");
  return { ok: `Connected ${d.fromEmail}` };
}

/** Turns reply sync on/off; turning it on also checks the mailbox right away. */
export async function setReplySync(id: number, on: boolean) {
  const user = await requireUser();
  const [s] = await db.select().from(S).where(and(eq(S.id, id), eq(S.workspaceId, user.workspaceId))).limit(1);
  if (!s) return;
  const imapHost = on ? (IMAP_FOR_SMTP[s.smtpHost] ?? null) : null;
  await db.update(S).set({ imapHost, imapError: null }).where(eq(S.id, id));
  if (imapHost) await syncSender({ ...s, imapHost });
  revalidatePath("/channels");
  revalidatePath("/inbox");
}

export async function removeSender(id: number) {
  const user = await requireUser();
  await db.delete(S).where(and(eq(S.id, id), eq(S.workspaceId, user.workspaceId)));
  revalidatePath("/channels");
}

export async function testSender(id: number, _: SenderState, formData: FormData): Promise<SenderState> {
  const user = await requireUser();
  const to = normalizeEmail(String(formData.get("to") ?? ""));
  if (!to) return { error: "Enter an email address" };
  const [sender] = await db
    .select()
    .from(S)
    .where(and(eq(S.id, id), eq(S.workspaceId, user.workspaceId)))
    .limit(1);
  if (!sender) return { error: "Sender not found" };
  const res = await sendEmail(sender, {
    to,
    subject: `Test from ${sender.fromName}`,
    text: `This is a test email from the ScaleUp admin.\n\nIf you can read this, ${sender.fromEmail} is ready for campaigns.\n\n— ${sender.fromName}`
  });
  await db
    .update(S)
    .set(res.ok ? { verifiedAt: new Date(), lastError: null } : { lastError: res.info })
    .where(eq(S.id, id));
  revalidatePath("/channels");
  return res.ok ? { ok: `Sent to ${to} — check the inbox (and spam folder)` } : { error: res.info };
}
