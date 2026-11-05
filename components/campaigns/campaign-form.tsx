"use client";

import { useActionState, useRef, useState } from "react";
import { createCampaign } from "@/app/actions/campaigns";
import { type AudienceGroup, estimateParts, renderTemplate, sampleLink, smsParts } from "@/lib/sms-text";
import { Button, Card, Label, inputClass } from "@/components/ui";
import { cn, nf } from "@/lib/utils";
import { StepHead } from "@/components/campaigns/step-head";

const DEFAULT_MESSAGE: Record<Channel, string> = {
  sms: "Assalamu Alaikum {name}! Apnar business er jonno ekta fast website + auto order system banale order 24/7 ashbe. Free audit nite: {link} - ScaleUp Web",
  whatsapp:
    "{Assalamu Alaikum|Assalamualaikum|Salam} {name} 👋\n\n{Apnar page er ad gula dekhlam|Apnar Facebook page dekhlam} — {onek sundor products|business ta khub valo cholche}! Apnar jonno ekta fast website + 24/7 auto order system banale Messenger e order miss hobe na.\n\nFree audit (kono charge nai): {link}\n\n— Easin, ScaleUp Web\n(Ar message na chaile STOP likhun)"
};

const GAPS = [
  ["20-45", "20–45 s (faster)"],
  ["30-90", "30–90 s (recommended)"],
  ["60-180", "1–3 min (safest)"]
] as const;

type Channel = "sms" | "whatsapp";

export function CampaignForm({
  channel,
  audienceQuery,
  audienceSize,
  groups,
  sample,
  linkBase,
  rate,
  balance,
  waConnected = true
}: {
  channel: Channel;
  audienceQuery: string;
  audienceSize: number;
  groups: AudienceGroup[];
  sample: { name: string; service: string };
  linkBase: string;
  rate: number;
  balance: number | null;
  waConnected?: boolean;
}) {
  const wa = channel === "whatsapp";
  const [state, action, pending] = useActionState(createCampaign, undefined);
  const [message, setMessage] = useState(DEFAULT_MESSAGE[channel]);
  const [speed, setSpeed] = useState(30);
  const [cleanNames, setCleanNames] = useState(!wa);
  const [gap, setGap] = useState<(typeof GAPS)[number][0]>("30-90");
  const [daily, setDaily] = useState(30);
  const ta = useRef<HTMLTextAreaElement>(null);

  const link = sampleLink(linkBase);
  const preview = renderTemplate(message, { ...sample, link }, { cleanNames });
  const { parts, chars, unicode } = smsParts(preview);
  const est = estimateParts(message, groups, link.length, { cleanNames });
  const cost = est.totalParts * rate;
  const minutes = Math.ceil(audienceSize / speed);
  const notEnough = !wa && balance != null && cost > balance;
  const [minGap, maxGap] = gap.split("-").map(Number);
  const days = Math.ceil(audienceSize / daily);

  const insert = (token: string) => {
    const el = ta.current;
    if (!el) return setMessage((m) => m + token);
    const { selectionStart: s, selectionEnd: e } = el;
    setMessage((m) => m.slice(0, s) + token + m.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = s + token.length;
    });
  };

  return (
    <form action={action} className="grid grid-cols-1 gap-5 lg:grid-cols-5">
      <input type="hidden" name="audienceQuery" value={audienceQuery} />
      <input type="hidden" name="channel" value={channel} />
      {wa && (
        <>
          <input type="hidden" name="minDelaySec" value={minGap} />
          <input type="hidden" name="maxDelaySec" value={maxGap} />
          <input type="hidden" name="ratePerMinute" value={30} />
        </>
      )}

      <div className="space-y-3 lg:col-span-3">
        <StepHead n={3} title="Message" />
        <Card className="space-y-4 p-5">
          <label className="block">
            <Label>Campaign name</Label>
            <input
              name="name"
              required
              placeholder={wa ? "e.g. Fashion Hot — WhatsApp intro" : "e.g. Fashion Hot leads — e-commerce offer"}
              className={inputClass}
            />
          </label>

          <div>
            <Label
              hint={
                wa
                  ? `${[...preview].length} chars · WhatsApp is free per message`
                  : `preview: ${chars} chars · ${parts} part${parts > 1 ? "s" : ""}${unicode ? " · Bangla/emoji → 70 per part" : " · English → 160 per part"}`
              }
            >
              Message
            </Label>
            <textarea
              ref={ta}
              name="message"
              required
              rows={wa ? 10 : 6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full rounded-xl border border-line-strong bg-ink-alt p-3 text-sm outline-none focus:border-accent"
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-2">Insert:</span>
              {[
                ["{name}", "business name"],
                ["{service}", "best-fit service"],
                ["{link}", "tracking link (required)"],
                ["{Hi|Hello|Assalamu Alaikum}", "random variation per person"]
              ].map(([t, hint]) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => insert(t)}
                  title={hint}
                  className="rounded-full border border-line-strong px-2.5 py-1 font-mono text-muted hover:text-fg"
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-2">
              {"{a|b|c}"} picks one option at random for each person
              {wa ? " — strongly recommended on WhatsApp so messages aren't identical" : ""}.
            </p>
          </div>

          {!wa && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-ink-alt p-3">
              <input
                type="checkbox"
                name="cleanNames"
                checked={cleanNames}
                onChange={(e) => setCleanNames(e.target.checked)}
                className="mt-0.5 accent-[#3b6bff]"
              />
              <span className="text-sm">
                Remove Bangla & emoji from names
                <span className="mt-0.5 block text-xs text-muted">
                  “Smart Shop 🛍️” → “Smart Shop”, a fully Bangla name → “Sir/Madam”. Keeps every SMS in cheap English parts.
                </span>
              </span>
            </label>
          )}

          <label className="block">
            <Label hint="where the tracking link sends people">Link destination</Label>
            <input name="destinationUrl" required defaultValue="https://scaleupweb.xyz/free-audit" className={inputClass} />
          </label>
        </Card>

        <Card className="space-y-4 p-5">
          <div className="text-sm font-medium">Delivery</div>

          {wa ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <Label>Gap between messages</Label>
                <select value={gap} onChange={(e) => setGap(e.target.value as typeof gap)} className={inputClass}>
                  {GAPS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label hint="all WhatsApp campaigns together">Max per day</Label>
                <select name="dailyLimit" value={daily} onChange={(e) => setDaily(Number(e.target.value))} className={inputClass}>
                  {[20, 30, 50, 100, 150, 250].map((n) => (
                    <option key={n} value={n}>
                      {n} messages / day{n <= 30 ? " (new number)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <label className="block">
              <Label hint={`≈ ${nf.format(minutes)} min for everyone`}>Sending speed</Label>
              <select name="ratePerMinute" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className={inputClass}>
                {[10, 30, 60, 120].map((n) => (
                  <option key={n} value={n}>
                    {n} SMS per minute
                  </option>
                ))}
              </select>
            </label>
          )}
        </Card>
      </div>

      <div className="space-y-3 lg:col-span-2">
        <StepHead n={4} title="Review" />
        <div className="space-y-4 lg:sticky lg:top-6">
          <Card className="p-5">
            <div className="text-xs text-muted">Preview — {sample.name} (one random variation)</div>
            <div
              className={cn(
                "mt-3 whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm p-3.5 text-sm leading-relaxed",
                wa ? "bg-[#005c4b] text-white" : "bg-surface-2"
              )}
            >
              {preview}
            </div>
          </Card>

          {wa ? (
            <Card className="space-y-2 p-5 text-sm">
              <Row k="Recipients" v={nf.format(audienceSize)} />
              <Row k="Cost" v="Free (WhatsApp)" />
              <Row k="Per day" v={`${daily} messages, 9am–9pm`} />
              <div className="border-t border-line pt-2">
                <Row k="Takes about" v={`${nf.format(days)} day${days > 1 ? "s" : ""}`} strong />
              </div>
              <p className="text-xs text-muted-2">Numbers that aren&apos;t on WhatsApp are skipped automatically.</p>
              {!waConnected && <p className="text-xs text-warning">WhatsApp isn&apos;t connected — link it in Channels before pressing Start.</p>}
            </Card>
          ) : (
            <Card className="space-y-2 p-5 text-sm">
              <Row k="Recipients" v={nf.format(audienceSize)} />
              {est.byParts.map(([p, people]) => (
                <Row key={p} k={`${p} part${p > 1 ? "s" : ""} (৳${(p * rate).toFixed(2)} each)`} v={`${nf.format(people)} people`} />
              ))}
              <Row k="Total SMS parts" v={nf.format(est.totalParts)} />
              <Row k="Rate" v={`৳${rate} / part`} />
              <div className="border-t border-line pt-2">
                <Row k="Estimated cost" v={`৳${nf.format(Math.round(cost * 100) / 100)}`} strong />
              </div>
              <Row k="Your balance" v={balance == null ? "unavailable" : `৳${balance.toFixed(2)}`} warn={notEnough} />
              {est.unicodePeople > 0 && (
                <p className="text-xs text-warning">
                  {nf.format(est.unicodePeople)} message
                  {est.unicodePeople > 1 ? "s" : ""} use Bangla/emoji (70 chars per part)
                  {cleanNames ? " — from the message text itself" : " — tick “Remove Bangla & emoji from names” to make them cheaper"}.
                </p>
              )}
              {notEnough && (
                <p className="text-xs text-warning">
                  Balance is lower than the cost. Sending will pause automatically when it runs out — recharge BulkSMSBD first.
                </p>
              )}
            </Card>
          )}

          {state?.error && <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{state.error}</p>}
          <Button type="submit" disabled={pending || audienceSize === 0} className="w-full">
            {pending ? "Preparing links…" : `Create ${wa ? "WhatsApp" : "SMS"} campaign (${nf.format(audienceSize)} people)`}
          </Button>
          <p className="text-center text-xs text-muted-2">Nothing is sent yet — you can send yourself a test and start it on the next page.</p>
        </div>
      </div>
    </form>
  );
}

function Row({ k, v, strong, warn }: { k: string; v: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{k}</span>
      <span className={cn("text-right", strong && "text-base font-semibold", warn && "text-warning")}>{v}</span>
    </div>
  );
}
