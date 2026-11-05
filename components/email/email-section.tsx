import { CircleAlert, CircleCheck, Mail } from "lucide-react";
import type { ChannelHealth } from "@/lib/channels";
import { checkDomain } from "@/lib/email-dns";
import { SMTP_PRESETS } from "@/lib/email";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui";
import { AddSenderForm, RemoveSenderButton, ReplySyncToggle, TestSenderForm } from "@/components/email/sender-forms";
import { IMAP_FOR_SMTP } from "@/lib/email-inbox";
import { timeAgo } from "@/lib/utils";

const providerName = (host: string) => Object.values(SMTP_PRESETS).find((p) => p.host === host)?.label ?? host;

/** Email senders (one per business/domain) with a live DNS checklist for each domain. */
export async function EmailSection({ email, userEmail }: { email: ChannelHealth["email"]; userEmail: string }) {
  const domains = [...new Map(email.senders.map((s) => [s.fromEmail.split("@")[1], s.smtpHost])).entries()];
  const dns = await Promise.all(domains.map(async ([d, host]) => [d, await checkDomain(d, host)] as const));
  const presets = Object.entries(SMTP_PRESETS).map(([key, p]) => ({ key, ...p }));

  return (
    <div className="space-y-3">
      {email.senders.length === 0 && (
        <Card className="flex items-start gap-3 p-5 text-sm">
          <Mail className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
          <div className="text-muted">
            Connect the address you send from (e.g. <b className="text-fg">hello@scaleupweb.xyz</b> through your Gmail). Add one sender per business — each gets
            its own daily limit and DNS check. Incoming mail keeps arriving in your Gmail through Cloudflare Email Routing.
          </div>
        </Card>
      )}

      {email.senders.map((s) => {
        const pct = Math.min(100, (s.sentToday / s.dailyLimit) * 100);
        return (
          <Card key={s.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">
                  {s.fromName} <span className="text-muted">&lt;{s.fromEmail}&gt;</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-2">
                  {providerName(s.smtpHost)} · {s.sentToday}/{s.dailyLimit} today
                </div>
                {s.lastError ? (
                  <div className="mt-1 text-xs text-danger">Last error: {s.lastError}</div>
                ) : (
                  <div className="mt-1 text-xs text-success">Login OK</div>
                )}
              </div>
              <RemoveSenderButton id={s.id} email={s.fromEmail} />
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-[#f59e0b]" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-3 max-w-md">
              <TestSenderForm id={s.id} defaultTo={userEmail} />
            </div>
            {IMAP_FOR_SMTP[s.smtpHost] && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs">
                <span className={cn(s.imapError ? "text-danger" : "text-muted")}>
                  {!s.imapHost
                    ? "Replies stay in your mailbox only"
                    : s.imapError
                      ? `Reply sync error: ${s.imapError}`
                      : s.imapCheckedAt
                        ? `Replies sync to Inbox · checked ${timeAgo(s.imapCheckedAt)}`
                        : "Replies sync to Inbox · first check within 2 minutes"}
                </span>
                <ReplySyncToggle id={s.id} on={Boolean(s.imapHost)} />
              </div>
            )}
          </Card>
        );
      })}

      {dns.map(([domain, checks]) => (
        <Card key={domain} className="p-4">
          <div className="text-sm font-medium">DNS for {domain}</div>
          <p className="mt-0.5 text-xs text-muted-2">Checked live. Fix these in Cloudflare → DNS so emails land in the inbox, not spam.</p>
          <ul className="mt-3 space-y-2.5">
            {checks.map((c) => (
              <li key={c.key} className="flex gap-2.5 text-sm">
                {c.ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
                <div className="min-w-0">
                  <div>{c.label}</div>
                  <div className="break-all font-mono text-[11px] text-muted-2">{c.detail}</div>
                  {!c.ok && c.fix && <div className={cn("mt-1 break-all text-xs text-warning")}>Fix: {c.fix}</div>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <AddSenderForm presets={presets} suggestedFrom={email.senders.length === 0 ? "hello@scaleupweb.xyz" : undefined} startOpen={email.senders.length === 0} />
    </div>
  );
}
