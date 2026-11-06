"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { CheckCircle2, ClipboardPaste, Copy, Database, Loader2, UserPlus, XCircle } from "lucide-react";
import { type PastedMatch, checkWhatsappNumbers, lookupPasted } from "@/app/actions/campaigns";
import { parsePasted, prettyBd } from "@/lib/paste-audience";
import { groupAudience } from "@/lib/sms-text";
import { cn, nf } from "@/lib/utils";
import { Button, Card, StatusBadge } from "@/components/ui";
import { CampaignForm, type SenderOption } from "@/components/campaigns/campaign-form";
import { StepHead } from "@/components/campaigns/step-head";
import type { LeadStatus } from "@/lib/constants";

type Channel = "sms" | "whatsapp" | "email";

/** Step 2 for pasted numbers/emails: who's already in your leads (with their data), who has WhatsApp — then message + review. */
export function PasteAudience(props: {
  channel: Channel;
  linkBase: string;
  rate: number;
  balance: number | null;
  waConnected: boolean;
  senders: SenderOption[];
}) {
  const { channel } = props;
  const wa = channel === "whatsapp";
  const [text, setText] = useState("");
  const [saveAsLeads, setSaveAsLeads] = useState(true);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [checkError, setCheckError] = useState("");
  const [checking, startCheck] = useTransition();
  const [copied, setCopied] = useState(false);
  const [matches, setMatches] = useState<Record<string, PastedMatch["lead"]>>({});
  const [looking, setLooking] = useState(false);

  const parsed = useMemo(() => parsePasted(text, channel), [text, channel]);
  const key = parsed.entries.map((e) => e.to).join(",");

  // Look the numbers up in your leads shortly after you stop typing/pasting.
  useEffect(() => {
    if (!key) return;
    const t = setTimeout(async () => {
      setLooking(true);
      const res = await lookupPasted(key.split(","), channel).catch(() => []);
      setMatches(Object.fromEntries(res.map((r) => [r.to, r.lead])));
      setLooking(false);
    }, 500);
    return () => clearTimeout(t);
  }, [key, channel]);

  const noWa = wa ? parsed.entries.filter((e) => checked[e.to] === false) : [];
  const unchecked = wa ? parsed.entries.filter((e) => checked[e.to] === undefined) : [];
  const optedOut = parsed.entries.filter((e) => matches[e.to]?.optedOut);
  const exclude = [...noWa, ...optedOut].map((e) => e.to);
  const sendTo = parsed.entries.filter((e) => !exclude.includes(e.to));
  const inLeads = parsed.entries.filter((e) => matches[e.to]).length;
  const groups = groupAudience(sendTo.map((e) => ({ name: e.name ?? matches[e.to]?.name ?? null, service: matches[e.to]?.service ?? null })));
  // Preview with a real lead when there is one, so {ads} {days} … show real data.
  const sampleEntry = sendTo.find((e) => matches[e.to]) ?? sendTo.find((e) => e.name) ?? sendTo[0];
  const sampleLead = sampleEntry ? matches[sampleEntry.to] : null;

  return (
    <>
      <section className="space-y-3">
        <StepHead n={2} title="Audience" hint="paste numbers or emails" />
        <Card className="space-y-4 p-5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={
              channel === "email"
                ? "One per line, name optional:\ninfo@shop.com, Sign of Modesty\nsales@glow.com.bd"
                : "One per line, name optional:\n01711-000001, Rahim Store\n+880 1811 000002\nGlow Skincare 01911000003"
            }
            className="w-full rounded-xl border border-line-strong bg-ink-alt p-3 font-mono text-sm outline-none focus:border-accent"
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold">
              {nf.format(parsed.entries.length)} {channel === "email" ? "emails" : "numbers"}
            </span>
            {parsed.entries.length > 0 && (
              <span className="inline-flex items-center gap-1 text-accent-soft">
                {looking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
                {nf.format(inLeads)} already in your leads · {nf.format(parsed.entries.length - inLeads)} new
              </span>
            )}
            {wa && Object.keys(checked).length > 0 && (
              <span className="text-muted">
                {nf.format(parsed.entries.length - noWa.length - unchecked.length)} have WhatsApp
                {noWa.length > 0 && <span className="text-danger"> · {nf.format(noWa.length)} don&apos;t</span>}
              </span>
            )}
            {optedOut.length > 0 && <span className="text-warning">{nf.format(optedOut.length)} opted out — skipped</span>}
            {parsed.duplicates > 0 && <span className="text-muted-2">{nf.format(parsed.duplicates)} duplicates removed</span>}
            {parsed.invalid.length > 0 && <span className="text-warning">{nf.format(parsed.invalid.length)} lines not recognised</span>}
          </div>
          {parsed.invalid.length > 0 && (
            <div className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
              Not a {channel === "email" ? "valid email" : "Bangladeshi mobile number"}: {parsed.invalid.slice(0, 6).join(" · ")}
              {parsed.invalid.length > 6 && " …"}
            </div>
          )}

          {parsed.entries.length > 0 && (
            <div className="space-y-3 rounded-xl border border-line">
              {wa && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                  <div className="text-sm">
                    <b>Who has WhatsApp?</b>
                    <span className="text-muted"> — numbers without it are skipped.</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={checking || unchecked.length === 0 || !props.waConnected}
                    onClick={() =>
                      startCheck(async () => {
                        setCheckError("");
                        const r = await checkWhatsappNumbers(unchecked.slice(0, 300).map((e) => e.to));
                        if (r.error) setCheckError(r.error);
                        else setChecked((c) => ({ ...c, ...r.results }));
                      })
                    }
                  >
                    {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {checking
                      ? `Checking ${nf.format(Math.min(unchecked.length, 300))}…`
                      : unchecked.length
                        ? `Check ${nf.format(Math.min(unchecked.length, 300))} numbers`
                        : "All checked"}
                  </Button>
                </div>
              )}
              {!props.waConnected && wa && <p className="px-4 text-xs text-warning">Connect WhatsApp in Channels to check numbers.</p>}
              {checkError && <p className="px-4 text-xs text-danger">{checkError}</p>}

              <ul className="scroll-thin max-h-96 divide-y divide-line overflow-y-auto">
                {parsed.entries.map((e) => {
                  const lead = matches[e.to];
                  const f = lead?.fields;
                  const bits = [
                    f?.industry,
                    f?.ads && `${f.ads} ads`,
                    f?.days && `${f.days} days`,
                    f?.followers && `${f.followers} followers`,
                    f?.orders && `orders via ${f.orders}`
                  ].filter(Boolean);
                  return (
                    <li key={e.to} className={cn("flex items-start gap-3 px-4 py-2.5", (checked[e.to] === false || lead?.optedOut) && "opacity-60")}>
                      {wa &&
                        (checked[e.to] === true ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Has WhatsApp" />
                        ) : checked[e.to] === false ? (
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-label="No WhatsApp" />
                        ) : (
                          <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-line-strong" aria-label="Not checked" />
                        ))}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs">{channel === "email" ? e.to : prettyBd(e.to)}</span>
                          {lead ? (
                            <a href={`/leads/${lead.id}`} target="_blank" rel="noreferrer" className="truncate text-sm font-medium hover:text-accent-soft">
                              {lead.name ?? "Lead"}
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-2">
                              <UserPlus className="h-3 w-3" /> {e.name ?? "New — not in your leads"}
                            </span>
                          )}
                          {lead && <StatusBadge status={lead.status as LeadStatus} />}
                          {checked[e.to] === false && <span className="text-[11px] text-danger">no WhatsApp</span>}
                          {lead?.optedOut && <span className="text-[11px] text-warning">opted out</span>}
                        </div>
                        {bits.length > 0 && <div className="mt-0.5 truncate text-[11px] text-muted">{bits.join(" · ")}</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {noWa.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-muted">
                  <span>{nf.format(noWa.length)} without WhatsApp will be skipped — you can send them an SMS campaign instead.</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await navigator.clipboard.writeText(noWa.map((e) => `${prettyBd(e.to)}${e.name ? `, ${e.name}` : ""}`).join("\n"));
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy those numbers"}
                  </Button>
                </div>
              )}
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" checked={saveAsLeads} onChange={(e) => setSaveAsLeads(e.target.checked)} className="mt-0.5 accent-[#3b6bff]" />
            <span>
              Save new {channel === "email" ? "addresses" : "numbers"} as leads
              <span className="block text-xs text-muted">So their clicks and replies are tracked. Ones already in your leads are matched automatically.</span>
            </span>
          </label>
        </Card>
      </section>

      {parsed.entries.length === 0 ? (
        <Card className="flex items-center gap-3 p-5 text-sm text-muted">
          <ClipboardPaste className="h-5 w-5 text-accent" /> Paste the {channel === "email" ? "emails" : "numbers"} above to write the message.
        </Card>
      ) : (
        <CampaignForm
          key={channel}
          channel={channel}
          audienceQuery=""
          audienceSize={sendTo.length}
          groups={groups}
          sample={{
            name: sampleEntry?.name ?? sampleLead?.name ?? "Sir/Madam",
            service: sampleLead?.service ?? "website",
            fields: sampleLead?.fields
          }}
          linkBase={props.linkBase}
          rate={props.rate}
          balance={props.balance}
          waConnected={props.waConnected}
          senders={props.senders}
          pasted={{ text, exclude, saveAsLeads }}
        />
      )}
    </>
  );
}
