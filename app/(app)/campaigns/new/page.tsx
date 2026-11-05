import Link from "next/link";
import { ArrowLeft, Check, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { buildAudience } from "@/lib/campaigns";
import { getChannelHealth } from "@/lib/channels";
import { filtersToQuery, parseFilters } from "@/lib/leads-query";
import { linkBase } from "@/lib/tracking";
import { cn, nf } from "@/lib/utils";
import { groupAudience } from "@/lib/sms-text";
import { Card } from "@/components/ui";
import { CampaignForm } from "@/components/campaigns/campaign-form";
import { CHANNELS, ChannelIcon } from "@/components/campaigns/channel";
import { StepHead } from "@/components/campaigns/step-head";

export const metadata = { title: "New campaign" };

const FILTER_LABELS: Record<string, string> = {
  q: "Search",
  status: "Status",
  priority: "Priority",
  industry: "Industry",
  service: "Service",
  size: "Size",
  webType: "Website",
  platform: "Platform",
  orders: "Orders",
  source: "Source",
  bd: "Bangladesh",
  has: "Has",
  minScore: "Score ≥",
  minAds: "Ads ≥"
};

const PRESETS: [string, string, Record<string, string>][] = [
  ["Hot leads", "Best-fit businesses", { priority: "A - Hot" }],
  ["Warm leads", "Good fit, less urgent", { priority: "B - Warm" }],
  ["Website enquiries", "Filled your contact form", { source: "website-contact" }],
  ["Just me (test)", "Your manual test lead", { source: "manual" }]
];

export default async function NewCampaignPage({ searchParams }: PageProps<"/campaigns/new">) {
  const user = await requireUser();
  const sp = await searchParams;
  const channel = sp.channel === "whatsapp" || sp.channel === "email" ? sp.channel : "sms";
  const filters = parseFilters(sp);
  const query = filtersToQuery({ ...filters, page: 1 }).replace(/^\?/, "");
  const [{ audience, matched, noNumber, duplicate }, health] = await Promise.all([
    buildAudience(user.workspaceId, filters, channel),
    getChannelHealth(user.workspaceId)
  ]);
  const withChannel = (c: string, q = query) => {
    const p = new URLSearchParams(q);
    if (c !== "sms") p.set("channel", c);
    return `/campaigns/new${p.size ? `?${p}` : ""}`;
  };
  const sample = audience[0];

  const chips = Object.entries(filters)
    .filter(([k, v]) => !["page", "sort"].includes(k) && v !== undefined && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => [FILTER_LABELS[k] ?? k, Array.isArray(v) ? v.join(", ") : String(v)] as const);
  const noFilters = chips.length === 0;

  const waReady = health.whatsapp.status.state === "open";
  const options = [
    {
      key: "sms" as const,
      facts: [`৳${health.sms.rate} per SMS part`, "Delivered in minutes", "Works on every phone"],
      status: health.sms.balance == null ? "Balance unavailable" : `৳${health.sms.balance.toFixed(2)} balance`,
      warn: health.sms.low || health.sms.balance == null
    },
    {
      key: "whatsapp" as const,
      facts: ["Free per message", `${health.whatsapp.dailyLimit}/day, ${health.whatsapp.window}`, "People can reply"],
      status: waReady ? `Connected · +${health.whatsapp.status.me?.id}` : "Not connected",
      warn: !waReady
    },
    {
      key: "email" as const,
      facts: ["Free from your own address", "Subject + longer message", "One-click unsubscribe"],
      status: health.email.senders.length
        ? `${health.email.senders[0].fromEmail}${health.email.senders.length > 1 ? ` +${health.email.senders.length - 1}` : ""}`
        : "No sender yet",
      warn: health.email.senders.length === 0
    }
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Campaigns
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New campaign</h1>

      {/* 1 · Channel */}
      <section className="space-y-3">
        <StepHead n={1} title="Channel" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {options.map((o) => {
            const ch = CHANNELS[o.key];
            const active = channel === o.key;
            return (
              <Link
                key={o.key}
                href={withChannel(o.key)}
                className={cn(
                  "relative rounded-2xl border bg-surface p-4 transition-colors",
                  active ? "border-accent ring-1 ring-accent" : "border-line hover:border-line-strong"
                )}
              >
                {active && (
                  <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
                    <Check className="h-3 w-3" />
                  </span>
                )}
                <div className="flex items-center gap-3">
                  <ChannelIcon channel={o.key} />
                  <span className="font-medium">{ch.label}</span>
                </div>
                <ul className="mt-3 space-y-1 text-xs text-muted">
                  {o.facts.map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
                <div className={cn("mt-3 text-xs", o.warn ? "text-warning" : "text-success")}>{o.status}</div>
              </Link>
            );
          })}
        </div>
        {channel === "email" && health.email.senders.length === 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              Connect the address you send from first —{" "}
              <Link href="/channels#email" className="font-medium underline">
                add a sender
              </Link>{" "}
              (e.g. hello@scaleupweb.xyz through Gmail).
            </span>
          </div>
        )}
        {channel === "whatsapp" && !waReady && (
          <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              WhatsApp isn&apos;t connected. You can still prepare the campaign, but{" "}
              <Link href="/channels#whatsapp" className="font-medium underline">
                link your number
              </Link>{" "}
              before you start it.
            </span>
          </div>
        )}
      </section>

      {/* 2 · Audience */}
      <section className="space-y-3">
        <StepHead n={2} title="Audience" />
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <div className="text-3xl font-semibold tracking-tight">{nf.format(audience.length)}</div>
              <div className="text-sm text-muted">people will get this {CHANNELS[channel].label}</div>
              <div className="mt-2 text-xs text-muted-2">
                {nf.format(matched)} leads matched · {nf.format(noNumber)} without a valid{" "}
                {channel === "email" ? "email address" : channel === "whatsapp" ? "WhatsApp/mobile" : "mobile"} · {nf.format(duplicate)} duplicates removed ·
                opted-out excluded
              </div>
            </div>
            <Link
              href={`/leads${query ? `?${query}` : ""}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-sm hover:border-accent/60"
            >
              <SlidersHorizontal className="h-4 w-4" /> {noFilters ? "Choose in Leads" : "Change filters"}
            </Link>
          </div>

          {noFilters ? (
            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-2 text-xs text-warning">No filters yet — this would go to all leads. Pick a quick audience:</div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {PRESETS.map(([label, desc, p]) => (
                  <Link
                    key={label}
                    href={withChannel(channel, new URLSearchParams(p).toString())}
                    className="rounded-xl border border-line bg-ink-alt p-3 transition-colors hover:border-accent/60"
                  >
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-[11px] text-muted-2">{desc}</div>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {chips.map(([k, v]) => (
                <span key={k} className="rounded-full border border-line bg-ink-alt px-2.5 py-1 text-xs">
                  <span className="text-muted-2">{k}:</span> {v}
                </span>
              ))}
              <Link href={withChannel(channel, "")} className="rounded-full px-2.5 py-1 text-xs text-muted hover:text-fg">
                Clear
              </Link>
            </div>
          )}
        </Card>
      </section>

      {/* 3 · Message  ·  4 · Review */}
      <CampaignForm
        key={channel}
        channel={channel}
        audienceQuery={query}
        audienceSize={audience.length}
        groups={groupAudience(audience)}
        sample={{ name: sample?.name ?? "Sign of Modesty", service: sample?.service ?? "E-commerce Website" }}
        linkBase={linkBase()}
        rate={health.sms.rate}
        balance={health.sms.balance}
        waConnected={waReady}
        senders={health.email.senders}
      />
    </div>
  );
}
