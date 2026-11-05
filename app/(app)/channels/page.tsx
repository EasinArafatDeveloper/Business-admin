import Link from "next/link";
import { ArrowUpRight, Check, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getChannelHealth } from "@/lib/channels";
import { nf } from "@/lib/utils";
import { Card } from "@/components/ui";
import { ChannelIcon, Health } from "@/components/campaigns/channel";
import { WaConnect } from "@/components/whatsapp/wa-connect";

export const metadata = { title: "Channels" };

export default async function ChannelsPage() {
  const user = await requireUser();
  const { sms, whatsapp: wa } = await getChannelHealth(user.workspaceId);
  const sender = process.env.BULKSMSBD_SENDER_ID;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
        <p className="mt-1 text-sm text-muted">Where campaigns are sent from. Connect a channel once; every campaign then uses it.</p>
      </div>

      {/* WhatsApp */}
      <section id="whatsapp" className="scroll-mt-20 space-y-3">
        <SectionHead channel="whatsapp" title="WhatsApp" desc="Free per message · sends from a linked number like WhatsApp Web">
          {wa.status.state === "open" ? (
            <Health tone="ok">Connected</Health>
          ) : (
            <Health tone="down">{wa.status.state === "offline" ? "Service offline" : "Not connected"}</Health>
          )}
        </SectionHead>
        <WaConnect />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Sent today" value={`${wa.sentToday} / ${wa.dailyLimit}`} bar={wa.sentToday / wa.dailyLimit} />
          <Stat label="Sending hours (Dhaka)" value={wa.window} sub={wa.windowOpen ? "Open now" : "Closed now — queued messages wait"} />
          <Stat label="Daily limit" value={`${wa.dailyLimit} / day`} sub="Set per campaign, shared by all of them" />
        </div>
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-success" /> Protection against bans (always on)
          </h3>
          <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm text-muted sm:grid-cols-2">
            {[
              "One message at a time with a random 30–90 s gap",
              "Daily limit across all WhatsApp campaigns",
              `Sends only ${wa.window}, Dhaka time`,
              "Shows “typing…” before each message",
              "{Hi|Hello|Salam} gives each person different text",
              "Skips numbers that aren’t on WhatsApp",
              "“STOP” replies opt the person out automatically"
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {t}
              </li>
            ))}
          </ul>
          <p className="mt-4 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
            New number: 20–30 a day for the first week, then raise slowly. Never link your main business number.
          </p>
        </Card>
      </section>

      {/* SMS */}
      <section id="sms" className="scroll-mt-20 space-y-3">
        <SectionHead channel="sms" title="SMS" desc="BulkSMSBD · pay per SMS part">
          {!sms.configured ? (
            <Health tone="off">Not set up</Health>
          ) : sms.balance == null ? (
            <Health tone="warn">Balance unavailable</Health>
          ) : (
            <Health tone={sms.low ? "warn" : "ok"}>{sms.low ? "Low balance" : "Ready"}</Health>
          )}
        </SectionHead>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label="Balance"
            value={sms.balance == null ? "—" : `৳${sms.balance.toFixed(2)}`}
            sub={sms.smsLeft == null ? undefined : `≈ ${nf.format(sms.smsLeft)} SMS parts`}
          />
          <Stat label="Price" value={`৳${sms.rate} / part`} sub="English 160 chars · Bangla/emoji 70" />
          <Stat label="Sender" value={sender ? `…${sender.slice(-4)}` : "—"} sub="Non-masking number" />
        </div>
        {!sms.configured ? (
          <p className="text-sm text-muted">
            Add <code className="rounded bg-surface-2 px-1">BULKSMSBD_API_KEY</code> and <code className="rounded bg-surface-2 px-1">BULKSMSBD_SENDER_ID</code>{" "}
            to the server&apos;s .env, then restart the admin.
          </p>
        ) : (
          <a href="https://bulksmsbd.net" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-accent-soft hover:underline">
            Recharge on BulkSMSBD <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        )}
      </section>

      {/* Email */}
      <section id="email" className="scroll-mt-20 space-y-3">
        <SectionHead channel="email" title="Email" desc="Your own domains · inbox + campaigns">
          <Health tone="off">Coming next</Health>
        </SectionHead>
        <Card className="border-dashed p-5 text-sm text-muted">
          Connect any of your domains, create addresses like hello@ or support@, read and reply here, and send email campaigns with open/click tracking and an
          unsubscribe link. Replies will land in the{" "}
          <Link href="/inbox" className="text-accent-soft hover:underline">
            Inbox
          </Link>{" "}
          next to WhatsApp.
        </Card>
      </section>
    </div>
  );
}

function SectionHead({ channel, title, desc, children }: { channel: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <ChannelIcon channel={channel} size="lg" />
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-muted">{desc}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, sub, bar }: { label: string; value: string; sub?: string; bar?: number }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-2">{sub}</div>}
      {bar !== undefined && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-[#25d366]" style={{ width: `${Math.min(100, bar * 100)}%` }} />
        </div>
      )}
    </Card>
  );
}
