import Link from "next/link";
import { ArrowUpRight, Check, ShieldCheck } from "lucide-react";
import { requireAccess } from "@/lib/auth";
import { getChannelHealth } from "@/lib/channels";
import { cn, nf } from "@/lib/utils";
import { Card } from "@/components/ui";
import { CHANNELS, ChannelIcon, Health } from "@/components/campaigns/channel";
import { WaConnect } from "@/components/whatsapp/wa-connect";
import { EmailSection } from "@/components/email/email-section";
import { HashToTab } from "@/components/hash-to-tab";

export const metadata = { title: "Channels" };

const TABS = ["whatsapp", "sms", "email"] as const;
type Tab = (typeof TABS)[number];
type Tone = "ok" | "warn" | "down" | "off";

const DESC: Record<Tab, string> = {
  whatsapp: "Free per message · sends from a linked number",
  sms: "BulkSMSBD · pay per SMS part",
  email: "Your own domains · with unsubscribe"
};

export default async function ChannelsPage({ searchParams }: PageProps<"/channels">) {
  const user = await requireAccess("channels");
  const sp = await searchParams;
  const tab: Tab = TABS.find((t) => t === sp.tab) ?? "whatsapp";
  const { sms, whatsapp: wa, email } = await getChannelHealth(user.workspaceId);
  const sender = process.env.BULKSMSBD_SENDER_ID;

  const status: Record<Tab, [Tone, string]> = {
    whatsapp: wa.status.state === "open" ? ["ok", "Connected"] : ["down", wa.status.state === "offline" ? "Service offline" : "Not connected"],
    sms: !sms.configured ? ["off", "Not set up"] : sms.balance == null ? ["warn", "Balance unavailable"] : sms.low ? ["warn", "Low balance"] : ["ok", "Ready"],
    email:
      email.senders.length === 0
        ? ["off", "No sender yet"]
        : email.senders.some((x) => x.lastError || x.imapError)
          ? ["warn", "Check senders"]
          : ["ok", `${email.senders.length} sender${email.senders.length > 1 ? "s" : ""}`]
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <HashToTab tabs={[...TABS]} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
        <p className="mt-1 text-sm text-muted">Where campaigns are sent from. Connect a channel once; every campaign then uses it.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Channel menu */}
        <nav className="grid grid-cols-3 gap-2 lg:sticky lg:top-6 lg:flex lg:h-fit lg:flex-col" aria-label="Channels">
          {TABS.map((t) => {
            const active = t === tab;
            const [tone, label] = status[t];
            return (
              <Link
                key={t}
                href={`/channels?tab=${t}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-2xl border p-3 text-center transition-colors lg:flex-row lg:items-center lg:gap-3 lg:text-left",
                  active ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface hover:border-line-strong"
                )}
              >
                <ChannelIcon channel={t} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{CHANNELS[t].label}</span>
                  <span className="hidden lg:block">
                    <Health tone={tone}>{label}</Health>
                  </span>
                  <span
                    className={cn(
                      "mx-auto mt-1 block h-1.5 w-1.5 rounded-full lg:hidden",
                      { ok: "bg-success", warn: "bg-warning", down: "bg-danger", off: "bg-muted-2" }[tone]
                    )}
                  />
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Selected channel */}
        <section className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ChannelIcon channel={tab} size="lg" />
              <div>
                <h2 className="text-lg font-semibold">{CHANNELS[tab].label}</h2>
                <p className="text-xs text-muted">{DESC[tab]}</p>
              </div>
            </div>
            <Health tone={status[tab][0]}>{status[tab][1]}</Health>
          </div>

          {tab === "whatsapp" && (
            <>
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
            </>
          )}

          {tab === "sms" && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Stat
                  label="Balance"
                  value={sms.balance == null ? "—" : `৳${sms.balance.toFixed(2)}`}
                  sub={sms.smsLeft == null ? undefined : `≈ ${nf.format(sms.smsLeft)} SMS parts`}
                  warn={sms.low}
                />
                <Stat label="Price" value={`৳${sms.rate} / part`} sub="English 160 chars · Bangla/emoji 70" />
                <Stat label="Sender" value={sender ? `…${sender.slice(-4)}` : "—"} sub="Non-masking number" />
              </div>
              {!sms.configured ? (
                <p className="text-sm text-muted">
                  Add <code className="rounded bg-surface-2 px-1">BULKSMSBD_API_KEY</code> and{" "}
                  <code className="rounded bg-surface-2 px-1">BULKSMSBD_SENDER_ID</code> to the server&apos;s .env, then restart the admin.
                </p>
              ) : (
                <a
                  href="https://bulksmsbd.net"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-sm hover:border-accent/60"
                >
                  Recharge on BulkSMSBD <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              )}
            </>
          )}

          {tab === "email" && <EmailSection email={email} userEmail={user.email} />}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, bar, warn }: { label: string; value: string; sub?: string; bar?: number; warn?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold", warn && "text-warning")}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-2">{sub}</div>}
      {bar !== undefined && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-[#25d366]" style={{ width: `${Math.min(100, bar * 100)}%` }} />
        </div>
      )}
    </Card>
  );
}
