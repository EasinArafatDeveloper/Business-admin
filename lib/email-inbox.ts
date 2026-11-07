import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { EmailSender } from "@/db/schema";
import { decryptSecret } from "@/lib/secrets";
import { isOptOutReply, stripQuoted } from "@/lib/email-quote";

/** IMAP server for each SMTP host we know (Brevo/SES are send-only, so no reply sync there). */
export const IMAP_FOR_SMTP: Record<string, string> = { "smtp.gmail.com": "imap.gmail.com", "smtp.zoho.com": "imap.zoho.com" };

const M = schema.inboundMessages;
const L = schema.leads;
const SYNC_MS = 2 * 60_000;
const FIRST_SYNC_DAYS = 14;

/**
 * Which lead (if any) an address belongs to. Only these people's mail is imported —
 * the rest of the mailbox (personal mail, newsletters) is never read past the envelope.
 */
async function matchAddress(workspaceId: number, addr: string): Promise<{ known: boolean; leadId: number | null }> {
  const R = schema.campaignRecipients;
  const C = schema.campaigns;
  const [sent] = await db
    .select({ leadId: R.leadId })
    .from(R)
    .innerJoin(C, eq(C.id, R.campaignId))
    .where(and(eq(C.workspaceId, workspaceId), eq(C.channel, "email"), eq(R.phone, addr)))
    .orderBy(desc(R.id))
    .limit(1);
  if (sent) return { known: true, leadId: sent.leadId };
  const [thread] = await db
    .select({ leadId: M.leadId })
    .from(M)
    .where(and(eq(M.workspaceId, workspaceId), eq(M.channel, "email"), eq(M.sender, addr)))
    .limit(1);
  if (thread) return { known: true, leadId: thread.leadId };
  const like = `%${addr.replace(/[%_\\]/g, "\\$&")}%`;
  const [lead] = await db
    .select({ id: L.id })
    .from(L)
    .where(and(eq(L.workspaceId, workspaceId), isNotNull(L.email), sql`lower(${L.email}) like ${like}`))
    .limit(1);
  return lead ? { known: true, leadId: lead.id } : { known: false, leadId: null };
}

async function saveReply(sender: EmailSender, m: { from: string; name: string | null; subject: string | null; body: string; messageId: string; date: Date; leadId: number | null }) {
  const optOut = isOptOutReply(m.body);
  const [row] = await db
    .insert(M)
    .values({
      workspaceId: sender.workspaceId,
      channel: "email",
      sender: m.from,
      senderName: m.name,
      subject: m.subject,
      body: m.body || "(empty message)",
      leadId: m.leadId,
      optOut,
      externalId: m.messageId,
      emailSenderId: sender.id,
      createdAt: m.date
    })
    .onConflictDoNothing()
    .returning({ id: M.id });
  if (!row || !m.leadId) return Boolean(row);

  await db.insert(schema.leadActivities).values({
    workspaceId: sender.workspaceId,
    leadId: m.leadId,
    type: "email_reply",
    channel: "email",
    body: optOut ? `Replied “${m.body.slice(0, 80)}” by email → opted out of email` : `Email reply: ${m.body.slice(0, 500)}`
  });
  await db
    .update(L)
    .set({
      updatedAt: new Date(),
      ...(optOut ? { emailOptOut: true } : { status: sql`case when ${L.status} in ('new','contacted') then 'interested'::lead_status else ${L.status} end` })
    })
    .where(eq(L.id, m.leadId));
  return true;
}

/** Reads new mail in one sender's INBOX and imports replies from leads. Returns how many were imported. */
export async function syncSender(sender: EmailSender): Promise<number> {
  if (!sender.imapHost) return 0;
  const client = new ImapFlow({
    host: sender.imapHost,
    port: 993,
    secure: true,
    auth: { user: sender.smtpUser, pass: decryptSecret(sender.smtpPassEnc).replace(/\s+/g, "") },
    logger: false,
    socketTimeout: 60_000
  });
  const own = new Set([sender.fromEmail.toLowerCase(), sender.smtpUser.toLowerCase()]);
  let imported = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const box = client.mailbox;
      if (!box) throw new Error("INBOX not available");
      const validity = String(box.uidValidity);
      const fresh = sender.imapUidValidity !== validity || sender.imapLastUid === 0;
      const lastUid = fresh ? 0 : sender.imapLastUid;

      // First run: only the last two weeks. After that: everything newer than the last seen UID.
      const range = fresh
        ? ((await client.search({ since: new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000) }, { uid: true })) || [])
        : `${lastUid + 1}:*`;
      let maxUid = lastUid;
      const candidates: { uid: number; from: string; name: string | null; leadId: number | null }[] = [];

      if (!Array.isArray(range) || range.length > 0) {
        for await (const msg of client.fetch(range, { uid: true, envelope: true }, { uid: true })) {
          if (msg.uid <= lastUid) continue; // "n:*" always returns the newest message, even if already seen
          maxUid = Math.max(maxUid, msg.uid);
          const f = msg.envelope?.from?.[0];
          const addr = f?.address?.toLowerCase();
          if (!addr || own.has(addr)) continue;
          candidates.push({ uid: msg.uid, from: addr, name: f?.name || null, leadId: null });
        }
      }

      for (const c of candidates) {
        const match = await matchAddress(sender.workspaceId, c.from);
        if (!match.known) continue;
        const one = await client.fetchOne(String(c.uid), { source: true }, { uid: true });
        if (!one || !one.source) continue;
        const parsed = await simpleParser(one.source);
        const text = parsed.text ?? (typeof parsed.html === "string" ? parsed.html.replace(/<[^>]+>/g, " ") : "");
        const ok = await saveReply(sender, {
          from: c.from,
          name: c.name,
          subject: parsed.subject ?? null,
          body: stripQuoted(text).slice(0, 5000),
          messageId: parsed.messageId ?? `uid-${sender.id}-${validity}-${c.uid}`,
          date: parsed.date ?? new Date(),
          leadId: match.leadId
        });
        if (ok) imported++;
      }

      await db
        .update(schema.emailSenders)
        .set({ imapUidValidity: validity, imapLastUid: maxUid, imapCheckedAt: new Date(), imapError: null })
        .where(eq(schema.emailSenders.id, sender.id));
    } finally {
      lock.release();
    }
  } catch (e) {
    const err = e as { authenticationFailed?: boolean; message?: string; responseText?: string };
    const msg = err.authenticationFailed ? "Login failed — check the App Password" : (err.responseText ?? err.message ?? "IMAP error").slice(0, 300);
    await db.update(schema.emailSenders).set({ imapCheckedAt: new Date(), imapError: msg }).where(eq(schema.emailSenders.id, sender.id));
  } finally {
    await client.logout().catch(() => client.close());
  }
  return imported;
}

/** Every 2 minutes, checks each sender that has reply sync on. Started from instrumentation.ts. */
export function startInboxSync() {
  const g = globalThis as unknown as { __inboxSync?: boolean };
  if (g.__inboxSync) return;
  g.__inboxSync = true;
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const senders = await db.select().from(schema.emailSenders).where(isNotNull(schema.emailSenders.imapHost));
      for (const s of senders) await syncSender(s);
    } catch (e) {
      console.error("[inbox] sync error", e);
    } finally {
      busy = false;
    }
  };
  setTimeout(run, 20_000);
  setInterval(run, SYNC_MS);
  console.log("[inbox] email reply sync started");
}
