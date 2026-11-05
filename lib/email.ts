import "server-only";
import nodemailer from "nodemailer";
import type { EmailSender } from "@/db/schema";
import { decryptSecret } from "@/lib/secrets";

/** Ready-made SMTP settings so adding a sender is just address + password. */
export const SMTP_PRESETS = {
  gmail: { label: "Gmail / Google Workspace", host: "smtp.gmail.com", port: 465, limit: 100, hint: "Use a Google App Password, not your normal password." },
  brevo: { label: "Brevo", host: "smtp-relay.brevo.com", port: 587, limit: 300, hint: "SMTP key from Brevo → SMTP & API." },
  zoho: { label: "Zoho Mail", host: "smtp.zoho.com", port: 465, limit: 200, hint: "Use a Zoho app-specific password." },
  custom: { label: "Other SMTP", host: "", port: 465, limit: 100, hint: "Any SMTP server (Amazon SES, Mailgun, your own…)." }
} as const;
export type SmtpPreset = keyof typeof SMTP_PRESETS;

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/** First valid address in a cell like "info@shop.com, sales@shop.com". */
export function normalizeEmail(raw: string | null | undefined): string | null {
  for (const part of (raw ?? "").split(/[\s,;/|]+/)) {
    const e = part
      .trim()
      .replace(/^mailto:/i, "")
      .replace(/[.)>]+$/, "")
      .toLowerCase();
    if (EMAIL_RE.test(e) && e.length <= 254) return e;
  }
  return null;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text → simple, personal-looking HTML (no images or tracking pixels, so it reads like a normal email). */
export function textToHtml(text: string) {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2937">${body}</div>`;
}

function transport(s: Pick<EmailSender, "smtpHost" | "smtpPort" | "smtpUser" | "smtpPassEnc">) {
  return nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpPort === 465,
    auth: { user: s.smtpUser, pass: decryptSecret(s.smtpPassEnc) },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000
  });
}

/** Logs in to the SMTP server without sending anything. */
export async function verifySender(s: Pick<EmailSender, "smtpHost" | "smtpPort" | "smtpUser" | "smtpPassEnc">) {
  try {
    await transport(s).verify();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: smtpError(e).info };
  }
}

export type SendResult = { ok: true; id: string } | { ok: false; fatal: boolean; code: string; info: string };

/** fatal = sender-level problem (login, quota) → pause the campaign; otherwise only this address failed. */
function smtpError(e: unknown): { fatal: boolean; code: string; info: string } {
  const err = e as { responseCode?: number; code?: string; response?: string; message?: string };
  const rc = err.responseCode ?? 0;
  const info = (err.response ?? err.message ?? "Send failed").slice(0, 300);
  if (err.code === "EAUTH" || rc === 535 || rc === 534)
    return { fatal: true, code: "auth", info: "Login failed — check the email password (App Password for Gmail)" };
  if (/daily (user )?sending limit|quota|rate limit/i.test(info) || rc === 421 || rc === 454)
    return { fatal: true, code: "limit", info: "The mail provider's sending limit was reached — try again later" };
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS"].includes(err.code ?? "")) return { fatal: true, code: "network", info };
  return { fatal: false, code: String(rc || err.code || "error"), info };
}

export async function sendEmail(sender: EmailSender, msg: { to: string; subject: string; text: string; unsubscribeUrl?: string }): Promise<SendResult> {
  try {
    const info = await transport(sender).sendMail({
      from: { name: sender.fromName, address: sender.fromEmail },
      replyTo: sender.replyTo || sender.fromEmail,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: textToHtml(msg.text),
      headers: msg.unsubscribeUrl ? { "List-Unsubscribe": `<${msg.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined
    });
    return { ok: true, id: info.messageId };
  } catch (e) {
    return { ok: false, ...smtpError(e) };
  }
}
