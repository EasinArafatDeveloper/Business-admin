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
    "{Assalamu Alaikum|Assalamualaikum|Salam} {name} 👋\n\n{Apnar page er ad gula dekhlam|Apnar Facebook page dekhlam} — {onek sundor products|business ta khub valo cholche}! Apnar jonno ekta fast website + 24/7 auto order system banale Messenger e order miss hobe na.\n\nFree audit (kono charge nai): {link}\n\n— Easin, ScaleUp Web\n(Ar message na chaile STOP likhun)",
  email:
    "Assalamu Alaikum,\n\nI came across {name} on Facebook — {your products look great|your ads are running well}. Most shops like yours lose orders in Messenger when nobody replies at night.\n\nWe build fast websites with 24/7 automatic ordering, so every order gets taken even while you sleep.\n\nWant a free audit of your page? {link}\n\nBest regards,\nEasin Arafat\nScaleUp Web"
};
const DEFAULT_SUBJECT = "{Quick idea|A quick question} for {name}";

const GAPS: Record<"whatsapp" | "email", [string, string][]> = {
  whatsapp: [
    ["20-45", "20–45 s (faster)"],
    ["30-90", "30–90 s (recommended)"],
    ["60-180", "1–3 min (safest)"]
  ],
  email: [
    ["20-60", "20–60 s (faster)"],
    ["60-180", "1–3 min (recommended)"],
    ["180-420", "3–7 min (safest)"]
  ]
};

type Channel = "sms" | "whatsapp" | "email";
export type SenderOption = { id: number; fromName: string; fromEmail: string; dailyLimit: number; sentToday: number };

export function CampaignForm({
  channel,
  audienceQuery,
  audienceSize,
  groups,
  sample,
  linkBase,
  rate,
  balance,
  waConnected = true,
  senders = [],
  personal,
  pasted
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
  senders?: SenderOption[];
  /** From a saved list where some leads have their own message. */
  personal?: { count: number; sample: { name: string; message: string; subject: string | null } };
  /** Pasted numbers/emails (the server reads the text again); exclude = numbers without WhatsApp. */
  pasted?: { text: string; exclude: string[]; saveAsLeads: boolean };
}) {
  const [usePersonal, setUsePersonal] = useState(Boolean(personal));
  const wa = channel === "whatsapp";
  const em = channel === "email";
  const paced = wa || em;
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [senderId, setSenderId] = useState(senders[0]?.id ?? 0);
  const sender = senders.find((x) => x.id === senderId);
  const [state, action, pending] = useActionState(createCampaign, undefined);
  const [message, setMessage] = useState(DEFAULT_MESSAGE[channel]);
  const [speed, setSpeed] = useState(30);
  const [cleanNames, setCleanNames] = useState(channel === "sms");
  const [gap, setGap] = useState(em ? "60-180" : "30-90");
  const [daily, setDaily] = useState(30);
  const ta = useRef<HTMLTextAreaElement>(null);

  const link = sampleLink(linkBase);
  // Same variation on server and browser; "Shuffle" shows another one.
  const [variant, setVariant] = useState(0);
  const pick = (n: number) => variant % n;
  // With personal messages on, preview one of them (link added at the end if it was left out, like when sending).
  const own = usePersonal && personal ? personal.sample : null;
  const ownTemplate = own ? (/\{link\}/i.test(own.message) ? own.message : `${own.message.trim()}${channel === "sms" ? " " : "\n\n"}{link}`) : null;
  const previewName = own ? { ...sample, name: own.name || sample.name } : sample;
  const preview = renderTemplate(ownTemplate ?? message, { ...previewName, link }, { cleanNames, pick });
  const { parts, chars, unicode } = smsParts(preview);
  const est = estimateParts(message, groups, link.length, { cleanNames });
  const cost = est.totalParts * rate;
  const minutes = Math.ceil(audienceSize / speed);
  const notEnough = channel === "sms" && balance != null && cost > balance;
  const [minGap, maxGap] = gap.split("-").map(Number);
  const perDay = em ? (sender?.dailyLimit ?? 100) : daily;
  const days = Math.ceil(audienceSize / perDay);
  const previewSubject = renderTemplate(own?.subject || subject, { ...previewName, link }, { pick });
  const label = em ? "email" : wa ? "WhatsApp" : "SMS";

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
      {pasted && (
        <>
          <input type="hidden" name="pastedText" value={pasted.text} />
          <input type="hidden" name="exclude" value={JSON.stringify(pasted.exclude)} />
          {pasted.saveAsLeads && <input type="hidden" name="saveAsLeads" value="on" />}
        </>
      )}
      {usePersonal && personal && <input type="hidden" name="usePersonal" value="on" />}
      {em && <input type="hidden" name="dailyLimit" value={perDay} />}
      {paced && (
        <>
          <input type="hidden" name="minDelaySec" value={minGap} />
          <input type="hidden" name="maxDelaySec" value={maxGap} />
          <input type="hidden" name="ratePerMinute" value={30} />
        </>
      )}

      <div className="space-y-3 lg:col-span-3">
        <StepHead n={3} title="Message" />
        {personal && (
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-4">
            <input type="checkbox" checked={usePersonal} onChange={(e) => setUsePersonal(e.target.checked)} className="mt-0.5 accent-[#3b6bff]" />
            <span className="text-sm">
              <b>Send each person their own message</b> — {nf.format(personal.count)} of {nf.format(audienceSize)} people in this list have one.
              <span className="mt-0.5 block text-xs text-muted">
                {personal.count < audienceSize
                  ? `The other ${nf.format(audienceSize - personal.count)} get the message below.`
                  : "Everyone has their own; the message below is only a backup."}{" "}
                Their tracking link is added automatically if it&apos;s missing.
              </span>
            </span>
          </label>
        )}
        <Card className="space-y-4 p-5">
          <label className="block">
            <Label>Campaign name</Label>
            <input
              name="name"
              required
              placeholder={em ? "e.g. Fashion Hot — email intro" : wa ? "e.g. Fashion Hot — WhatsApp intro" : "e.g. Fashion Hot leads — e-commerce offer"}
              className={inputClass}
            />
          </label>

          {em && (
            <>
              <label className="block">
                <Label hint={senders.length ? "address the email comes from" : undefined}>From</Label>
                {senders.length ? (
                  <select name="senderId" value={senderId} onChange={(e) => setSenderId(Number(e.target.value))} className={inputClass}>
                    {senders.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.fromName} &lt;{x.fromEmail}&gt; · {x.sentToday}/{x.dailyLimit} today
                      </option>
                    ))}
                  </select>
                ) : (
                  <a href="/channels?tab=email" className="block rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning">
                    No sender yet — connect hello@yourdomain in Channels first →
                  </a>
                )}
              </label>
              <label className="block">
                <Label hint={`${previewSubject.length} chars · {a|b} works here too`}>Subject</Label>
                <input name="subject" required value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
              </label>
            </>
          )}

          <div>
            <Label
              hint={
                paced
                  ? `${[...preview].length} chars · ${em ? "an unsubscribe link is added at the bottom" : "WhatsApp is free per message"}`
                  : `preview: ${chars} chars · ${parts} part${parts > 1 ? "s" : ""}${unicode ? " · Bangla/emoji → 70 per part" : " · English → 160 per part"}`
              }
            >
              Message
            </Label>
            <textarea
              ref={ta}
              name="message"
              required
              rows={paced ? 11 : 6}
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
              {paced ? " — recommended so messages aren't identical" : ""}.
            </p>
          </div>

          {channel === "sms" && (
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

          {paced ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <Label>Gap between {em ? "emails" : "messages"}</Label>
                <select value={gap} onChange={(e) => setGap(e.target.value)} className={inputClass}>
                  {GAPS[em ? "email" : "whatsapp"].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              {em ? (
                <div>
                  <Label hint="set per sender in Channels">Max per day</Label>
                  <div className={cn(inputClass, "flex items-center text-muted")}>{perDay} emails / day</div>
                </div>
              ) : (
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
              )}
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
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Preview — {sample.name}</span>
              <button type="button" onClick={() => setVariant((v) => v + 1)} className="rounded-lg px-2 py-0.5 hover:bg-surface-2 hover:text-fg">
                Shuffle variation
              </button>
            </div>
            {em ? (
              <div className="mt-3 overflow-hidden rounded-xl border border-line bg-white text-[#1f2937]">
                <div className="border-b border-black/10 px-3.5 py-2.5 text-xs">
                  <div className="font-semibold">{previewSubject || "(no subject)"}</div>
                  <div className="text-[#6b7280]">{sender ? `${sender.fromName} <${sender.fromEmail}>` : "No sender"}</div>
                </div>
                <div className="whitespace-pre-wrap break-words px-3.5 py-3 text-sm leading-relaxed">
                  {preview}
                  <span className="text-[#6b7280]">{"\n\n--\nDon't want these emails? Unsubscribe: …"}</span>
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  "mt-3 whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm p-3.5 text-sm leading-relaxed",
                  wa ? "bg-[#005c4b] text-white" : "bg-surface-2"
                )}
              >
                {preview}
              </div>
            )}
          </Card>

          {paced ? (
            <Card className="space-y-2 p-5 text-sm">
              <Row k="Recipients" v={nf.format(audienceSize)} />
              <Row k="Cost" v={em ? "Free (your mailbox)" : "Free (WhatsApp)"} />
              <Row k="Per day" v={em ? `${perDay} emails` : `${daily} messages, 9am–9pm`} />
              <div className="border-t border-line pt-2">
                <Row k="Takes about" v={`${nf.format(days)} day${days > 1 ? "s" : ""}`} strong />
              </div>
              {em ? (
                <p className="text-xs text-muted-2">Every email gets its own tracking link and a one-click unsubscribe. Replies go to your inbox.</p>
              ) : (
                <p className="text-xs text-muted-2">Numbers that aren&apos;t on WhatsApp are skipped automatically.</p>
              )}
              {wa && !waConnected && <p className="text-xs text-warning">WhatsApp isn&apos;t connected — link it in Channels before pressing Start.</p>}
            </Card>
          ) : (
            <Card className="space-y-2 p-5 text-sm">
              <Row k="Recipients" v={nf.format(audienceSize)} />
              {est.byParts.map(([p, people]) => (
                <Row key={p} k={`${p} part${p > 1 ? "s" : ""} (৳${(p * rate).toFixed(2)} each)`} v={`${nf.format(people)} people`} />
              ))}
              <Row k="Total SMS parts" v={nf.format(est.totalParts)} />
              <Row k="Rate" v={`৳${rate} / part`} />
              {usePersonal && personal && (
                <p className="text-xs text-warning">Personal messages have their own length — the exact cost is shown on the next page before you start.</p>
              )}
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
          <Button type="submit" disabled={pending || audienceSize === 0 || (em && !sender)} className="w-full">
            {pending ? "Preparing links…" : `Create ${label} campaign (${nf.format(audienceSize)} people)`}
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
