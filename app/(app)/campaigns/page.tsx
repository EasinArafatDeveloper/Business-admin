import Link from "next/link";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { ArrowUpRight, Megaphone, MousePointerClick, Plus, Send, ShieldCheck, Users } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getChannelHealth } from "@/lib/channels";
import { cn, nf, timeAgo } from "@/lib/utils";
import { Card } from "@/components/ui";
import { CampaignStatus } from "@/components/campaigns/campaign-status";
import { ChannelIcon, Health } from "@/components/campaigns/channel";

export const metadata = { title: "Campaigns" };

const CHANNEL_TABS = [
  ["all", "All channels"],
  ["sms", "SMS"],
  ["whatsapp", "WhatsApp"]
] as const;
const STATUS_TABS = [
  ["all", "Any status", null],
  ["active", "Active", ["sending", "paused"]],
  ["draft", "Drafts", ["draft"]],
  ["done", "Finished", ["done", "cancelled"]]
] as const;

export default async function CampaignsPage({ searchParams }: PageProps<"/campaigns">) {
  const user = await requireUser();
  const sp = await searchParams;
  const channel = CHANNEL_TABS.find(([k]) => k === sp.channel)?.[0] ?? "all";
  const status = STATUS_TABS.find(([k]) => k === sp.status) ?? STATUS_TABS[0];
  const C = schema.campaigns;

  const conds: SQL[] = [eq(C.workspaceId, user.workspaceId)];
  if (channel !== "all") conds.push(eq(C.channel, channel));
  if (status[2]) conds.push(inArray(C.status, [...status[2]]));

  const [rows, [totals], [replies], health] = await Promise.all([
    db
      .select()
      .from(C)
      .where(and(...conds))
      .orderBy(sql`(${C.status} in ('sending','paused')) desc`, desc(C.id))
      .limit(100),
    db
      .select({
        campaigns: sql<number>`count(*)::int`,
        sent: sql<number>`coalesce(sum(${C.sentCount}), 0)::int`,
        clicks: sql<number>`coalesce(sum(${C.humanClicks}), 0)::int`,
        people: sql<number>`coalesce(sum(${C.uniqueClickers}), 0)::int`,
        bots: sql<number>`coalesce(sum(${C.botClicks}), 0)::int`
      })
      .from(C)
      .where(eq(C.workspaceId, user.workspaceId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.inboundMessages)
      .where(eq(schema.inboundMessages.workspaceId, user.workspaceId)),
    getChannelHealth(user.workspaceId)
  ]);

  const href = (o: { channel?: string; status?: string }) => {
    const p = new URLSearchParams();
    const ch = o.channel ?? channel;
    const st = o.status ?? status[0];
    if (ch !== "all") p.set("channel", ch);
    if (st !== "all") p.set("status", st);
    return `/campaigns${p.size ? `?${p}` : ""}`;
  };

  const { sms, whatsapp: wa } = health;
  const waOpen = wa.status.state === "open";
  const kpis = [
    { label: "Messages sent", value: nf.format(totals.sent), icon: Send },
    { label: "Real clicks", value: nf.format(totals.clicks), icon: MousePointerClick },
    {
      label: "People clicked",
      value: nf.format(totals.people),
      sub: totals.sent ? `${((totals.people / totals.sent) * 100).toFixed(1)}% of sent` : undefined,
      icon: Users
    },
    { label: "Bot hits filtered", value: nf.format(totals.bots), sub: `${nf.format(replies.n)} replies in Inbox`, icon: ShieldCheck }
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted">Every SMS and WhatsApp campaign in one place. Only real human clicks are counted.</p>
        </div>
        <Link
          href="/campaigns/new"
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-medium text-white hover:bg-[#5a83ff]"
        >
          <Plus className="h-4 w-4" /> New campaign
        </Link>
      </div>

      {/* Channel health */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Link href="/channels#sms">
          <Card className="h-full p-4 transition-colors hover:border-line-strong">
            <div className="flex items-center gap-3">
              <ChannelIcon channel="sms" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">SMS</div>
                {!sms.configured ? (
                  <Health tone="off">Not set up</Health>
                ) : sms.balance == null ? (
                  <Health tone="warn">Balance unavailable</Health>
                ) : (
                  <Health tone={sms.low ? "warn" : "ok"}>{sms.low ? "Low balance — recharge" : "Ready"}</Health>
                )}
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold">{sms.balance == null ? "—" : `৳${sms.balance.toFixed(2)}`}</div>
                <div className="text-[11px] text-muted-2">{sms.smsLeft == null ? "BulkSMSBD" : `≈ ${nf.format(sms.smsLeft)} SMS left`}</div>
              </div>
            </div>
          </Card>
        </Link>
        <Link href="/channels#whatsapp">
          <Card className="h-full p-4 transition-colors hover:border-line-strong">
            <div className="flex items-center gap-3">
              <ChannelIcon channel="whatsapp" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">WhatsApp</div>
                {waOpen ? (
                  <Health tone={wa.windowOpen ? "ok" : "warn"}>
                    +{wa.status.me?.id} · {wa.windowOpen ? "sending hours" : `paused until ${wa.window.split("–")[0]}`}
                  </Health>
                ) : (
                  <Health tone="down">{wa.status.state === "offline" ? "Service offline" : "Not connected — scan QR"}</Health>
                )}
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold">
                  {wa.sentToday}
                  <span className="text-sm font-normal text-muted-2">/{wa.dailyLimit}</span>
                </div>
                <div className="text-[11px] text-muted-2">sent today</div>
              </div>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-[#25d366]" style={{ width: `${Math.min(100, (wa.sentToday / wa.dailyLimit) * 100)}%` }} />
            </div>
          </Card>
        </Link>
        <Link href="/channels#email">
          <Card className="h-full border-dashed p-4 transition-colors hover:border-line-strong">
            <div className="flex items-center gap-3">
              <ChannelIcon channel="email" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Email</div>
                <Health tone="off">Coming next</Health>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-2" />
            </div>
          </Card>
        </Link>
      </div>

      {/* Totals */}
      {totals.campaigns > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((k) => (
            <Card key={k.label} className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <k.icon className="h-3.5 w-3.5" /> {k.label}
              </div>
              <div className="mt-1.5 text-2xl font-semibold tracking-tight">{k.value}</div>
              {k.sub && <div className="mt-0.5 text-[11px] text-muted-2">{k.sub}</div>}
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented items={CHANNEL_TABS.map(([k, l]) => [l, href({ channel: k }), channel === k])} />
        <Segmented items={STATUS_TABS.map(([k, l]) => [l, href({ status: k }), status[0] === k])} />
      </div>

      {rows.length === 0 ? (
        <Card className="px-6 py-16 text-center">
          <Megaphone className="mx-auto h-9 w-9 text-accent" />
          <p className="mt-4 font-medium">{totals.campaigns === 0 ? "No campaigns yet" : "Nothing matches these filters"}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Pick a channel, choose who gets it (e.g. Hot leads with a phone), write the message, send yourself a test, then start.
          </p>
          <Link href="/campaigns/new" className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-sm font-medium text-white">
            <Plus className="h-4 w-4" /> New campaign
          </Link>
        </Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1fr)_100px_170px_70px_70px_70px] gap-4 px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-2 xl:grid">
            <span>Campaign</span>
            <span>Status</span>
            <span>Progress</span>
            <span className="text-right">Clicks</span>
            <span className="text-right">People</span>
            <span className="text-right">Rate</span>
          </div>
          {rows.map((c) => {
            const done = c.sentCount + c.failedCount;
            const pct = c.totalRecipients ? (done / c.totalRecipients) * 100 : 0;
            return (
              <Link
                key={c.id}
                href={`/campaigns/${c.id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-ink-alt/60 lg:grid-cols-[minmax(0,1fr)_100px_200px] xl:grid-cols-[minmax(0,1fr)_100px_170px_70px_70px_70px]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <ChannelIcon channel={c.channel} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="text-[11px] text-muted-2">
                      {nf.format(c.totalRecipients)} people · {timeAgo(c.createdAt)}
                      <span className="xl:hidden">
                        {" "}
                        · {nf.format(c.humanClicks)} clicks · {nf.format(c.uniqueClickers)} people clicked
                      </span>
                    </div>
                  </div>
                </div>
                <div>
                  <CampaignStatus status={c.status} />
                </div>
                <div className="col-span-2 lg:col-span-1">
                  <div className="flex justify-between text-[11px] text-muted">
                    <span>
                      {nf.format(c.sentCount)} / {nf.format(c.totalRecipients)}
                    </span>
                    <span>{Math.round(pct)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className={cn("h-full rounded-full", c.channel === "whatsapp" ? "bg-[#25d366]" : "bg-accent")} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <Metric label="Clicks" value={nf.format(c.humanClicks)} />
                <Metric label="People" value={nf.format(c.uniqueClickers)} />
                <Metric label="Rate" value={c.sentCount ? `${((c.uniqueClickers / c.sentCount) * 100).toFixed(1)}%` : "—"} accent />
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function Segmented({ items }: { items: [string, string, boolean][] }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-surface p-1 text-sm">
      {items.map(([label, href, active]) => (
        <Link key={label} href={href} className={cn("rounded-lg px-3 py-1.5", active ? "bg-accent/15 text-fg" : "text-muted hover:text-fg")}>
          {label}
        </Link>
      ))}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="hidden text-right xl:block">
      <span className={cn("text-sm font-medium", accent && "text-success")}>{value}</span>
      <span className="sr-only"> {label}</span>
    </div>
  );
}
