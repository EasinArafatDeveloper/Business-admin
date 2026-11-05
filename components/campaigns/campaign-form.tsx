"use client";

import { useActionState, useRef, useState } from "react";
import { createCampaign } from "@/app/actions/campaigns";
import { renderTemplate, sampleLink, smsParts } from "@/lib/sms-text";
import { Button, Card, Label, inputClass } from "@/components/ui";
import { cn, nf } from "@/lib/utils";

const DEFAULT_MESSAGE =
  "Assalamu Alaikum {name}! Apnar business er jonno ekta fast website + auto order system banale order 24/7 ashbe. Free audit nite: {link} - ScaleUp Web";

export function CampaignForm({
  audienceQuery,
  audienceSize,
  sample,
  linkBase,
  rate,
  balance
}: {
  audienceQuery: string;
  audienceSize: number;
  sample: { name: string; service: string };
  linkBase: string;
  rate: number;
  balance: number | null;
}) {
  const [state, action, pending] = useActionState(createCampaign, undefined);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [speed, setSpeed] = useState(30);
  const ta = useRef<HTMLTextAreaElement>(null);

  const preview = renderTemplate(message, { ...sample, link: sampleLink(linkBase) });
  const { parts, chars, unicode } = smsParts(preview);
  const cost = audienceSize * parts * rate;
  const minutes = Math.ceil(audienceSize / speed);
  const notEnough = balance != null && cost > balance;

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
      <Card className="space-y-4 p-5 lg:col-span-3">
        <label className="block">
          <Label>Campaign name</Label>
          <input name="name" required placeholder="e.g. Fashion Hot leads — e-commerce offer" className={inputClass} />
        </label>

        <div>
          <Label hint={`${chars} chars · ${parts} SMS part${parts > 1 ? "s" : ""}${unicode ? " · Bangla/emoji = 70 per part" : ""}`}>Message</Label>
          <textarea
            ref={ta}
            name="message"
            required
            rows={6}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-xl border border-line-strong bg-ink-alt p-3 text-sm outline-none focus:border-accent"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-2">Insert:</span>
            {[
              ["{name}", "business name"],
              ["{service}", "best-fit service"],
              ["{link}", "tracking link (required)"]
            ].map(([t, hint]) => (
              <button type="button" key={t} onClick={() => insert(t)} title={hint} className="rounded-full border border-line-strong px-2.5 py-1 font-mono text-muted hover:text-fg">
                {t}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <Label hint="where the tracking link sends people">Link destination</Label>
          <input name="destinationUrl" required defaultValue="https://scaleupweb.xyz/free-audit" className={inputClass} />
        </label>

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
      </Card>

      <div className="space-y-5 lg:col-span-2">
        <Card className="p-5">
          <div className="text-xs text-muted">Preview — {sample.name}</div>
          <div className="mt-3 rounded-2xl rounded-tl-sm bg-surface-2 p-3.5 text-sm leading-relaxed whitespace-pre-wrap break-words">{preview}</div>
        </Card>

        <Card className="space-y-2 p-5 text-sm">
          <Row k="Recipients" v={nf.format(audienceSize)} />
          <Row k="SMS parts each" v={String(parts)} />
          <Row k={`Rate`} v={`৳${rate} / part`} />
          <div className="border-t border-line pt-2">
            <Row k="Estimated cost" v={`৳${nf.format(Math.round(cost * 100) / 100)}`} strong />
          </div>
          <Row k="Your balance" v={balance == null ? "unavailable" : `৳${balance.toFixed(2)}`} warn={notEnough} />
          {notEnough && <p className="text-xs text-warning">Balance is lower than the cost. Sending will pause automatically when it runs out — recharge BulkSMSBD first.</p>}
        </Card>

        {state?.error && <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{state.error}</p>}
        <Button type="submit" disabled={pending || audienceSize === 0} className="w-full">
          {pending ? "Preparing links…" : `Create campaign (${nf.format(audienceSize)} people)`}
        </Button>
        <p className="text-center text-xs text-muted-2">Nothing is sent yet — you can send yourself a test and start it on the next page.</p>
      </div>
    </form>
  );
}

function Row({ k, v, strong, warn }: { k: string; v: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{k}</span>
      <span className={cn(strong && "text-base font-semibold", warn && "text-warning")}>{v}</span>
    </div>
  );
}
