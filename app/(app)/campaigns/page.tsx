import Link from "next/link";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { ArrowUpRight, LayoutGrid, Megaphone, Plus, TriangleAlert } from "lucide-react";
import { db, schema } from "@/db";
import { requireAccess } from "@/lib/auth";
import { getChannelHealth } from "@/lib/channels";
import { cn, nf, timeAgo } from "@/lib/utils";
import { Card } from "@/components/ui";
import { CampaignStatus } from "@/components/campaigns/campaign-status";
import { CHANNELS, ChannelIcon } from "@/components/campaigns/channel";

export const metadata = { title: "Campaigns" };

const CHANNEL_KEYS = ["sms", "whatsapp", "email"] as const;
type ChannelKey = (typeof CHANNEL_KEYS)[number];
const STATUS_TABS = [
  ["all", "Any status", null],
  ["active", "Active", ["sending", "paused"]],
  ["draft", "Drafts", ["draft"]],
  ["done", "Finished", ["done", "cancelled"]]
] as const;
type Tone = "ok" | "warn" | "down" | "off";
const DOT: Record<Tone, string> = { ok: "bg-success", warn: "bg-warning", down: "bg-danger", off: "bg-muted-2" };
const BAR: Record<string, string> = { whatsapp: "bg-[#25d366]", email: "bg-[#f59e0b]", sms: "bg-accent" };

export default async function CampaignsPage({ searchParams }: PageProps<"/campaigns">) {
  const user = await requireAccess("campaigns");
  const sp = await searchParams;
  const channel: ChannelKey | "all" = CHANNEL_KEYS.find((k) => k === sp.channel) ?? "all";
  const status = STATUS_TABS.find(([k]) => k === sp.status) ?? STATUS_TABS[0];
  const C = schema.campaigns;
  const ws = eq(C.workspaceId, user.workspaceId);

  const conds: SQL[] = [ws];
  if (channel !== "all") conds.push(eq(C.channel, channel));
  if (status[2]) conds.push(inArray(C.status, [...status[2]]));

  const [rows, counts, [totals], health] = await Promise.all([
    db
      .select()
      .from(C)
      .where(and(...conds))
      .orderBy(sql`(${C.status} in ('sending','paused')) desc`, desc(C.id))
      .limit(100),
    db
      .select({ channel: C.channel, status: C.status, n: sql<number>`count(*)::int` })
      .from(C)
      .where(ws)
      .groupBy(C.channel, C.status),
    db
      .select({
        sent: sql<number>`coalesce(sum(${C.sentCount}), 0)::int`,
        clicks: sql<number>`coalesce(sum(${C.humanClicks}), 0)::int`,
        people: sql<number>`coalesce(sum(${C.uniqueClickers}), 0)::int`,
        bots: sql<number>`coalesce(sum(${C.botClicks}), 0)::int`
      })
      .from(C)
      .where(channel === "all" ? ws : and(ws, eq(C.channel, channel))),
    getChannelHealth(user.workspaceId)
  ]);

  const count = (ch: string, statuses?: readonly string[] | null) =>
    counts.filter((r) => (ch === "all" || r.channel === ch) && (!statuses || statuses.includes(r.status))).reduce((a, r) => a + r.n, 0);

  const href = (o: { channel?: string; status?: string }) => {
    const p = new URLSearchParams();
    const ch = o.channel ?? channel;
    const st = o.status ?? status[0];
    if (ch !== "all") p.set("channel", ch);
    if (st !== "all") p.set("status", st);
    return `/campaigns${p.size ? `?${p}` : ""}`;
  };

  // One line of health per channel: tone, short text, and what to do when it needs attention.
  const { sms, whatsapp: wa, email } = health;
  const chHealth: Record<ChannelKey, { tone: Tone; text: string; fix?: string }> = {
    sms: !sms.configured
      ? { tone: "off", text: "Not set up", fix: "Add the BulkSMSBD key to start sending SMS." }
      : sms.balance == null
        ? { tone: "warn", text: "Balance unavailable" }
        : sms.low
          ? {
              tone: "warn",
              text: `৳${sms.balance.toFixed(2)} left`,
              fix: `Only ≈${nf.format(sms.smsLeft ?? 0)} SMS left — recharge BulkSMSBD before a big campaign.`
            }
          : { tone: "ok", text: `৳${sms.balance.toFixed(2)} balance` },
    whatsapp:
      wa.status.state !== "open"
        ? { tone: "down", text: "Not connected", fix: "WhatsApp isn't connected — scan the QR code to send." }
        : { tone: wa.windowOpen ? "ok" : "warn", text: `${wa.sentToday}/${wa.dailyLimit} today${wa.windowOpen ? "" : " · night pause"}` },
    email:
      email.senders.length === 0
        ? { tone: "off", text: "No sender", fix: "Connect hello@yourdomain to send email campaigns." }
        : email.senders.some((x) => x.lastError || x.imapError)
          ? { tone: "warn", text: "Check sender", fix: "A sender has an error — open it to see what's wrong." }
          : { tone: "ok", text: `${email.sentToday}/${email.dailyLimit} today` }
  };
  const notice = channel !== "all" ? chHealth[channel].fix : undefined;
  const newHref = `/campaigns/new${channel !== "all" ? `?channel=${channel}` : ""}`;
  const rate = totals.sent ? `${((totals.people / totals.sent) * 100).toFixed(1)}%` : "—";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted">SMS, WhatsApp and email in one place. Only real human clicks are counted.</p>
        </div>
        <Link href={newHref} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-medium text-white hover:bg-[#5a83ff]">
          <Plus className="h-4 w-4" /> New {channel !== "all" ? CHANNELS[channel].label : ""} campaign
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Left menu */}
        <aside className="space-y-5 lg:sticky lg:top-6 lg:h-fit">
          <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-col" aria-label="Channels">
            <MenuItem href={href({ channel: "all" })} active={channel === "all"} count={count("all")}>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-muted">
                <LayoutGrid className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">All campaigns</span>
                <span className="hidden text-xs text-muted-2 lg:block">Every channel</span>
              </span>
            </MenuItem>
            {CHANNEL_KEYS.map((k) => (
              <MenuItem key={k} href={href({ channel: k })} active={channel === k} count={count(k)}>
                <ChannelIcon channel={k} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{CHANNELS[k].label}</span>
                  <span className="hidden items-center gap-1.5 truncate text-xs text-muted-2 lg:flex">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[chHealth[k].tone])} />
                    {chHealth[k].text}
                  </span>
                </span>
              </MenuItem>
            ))}
          </nav>

          <div>
            <div className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-2">Status</div>
            <div className="flex flex-wrap gap-1 lg:flex-col">
              {STATUS_TABS.map(([k, l, st]) => (
                <Link
                  key={k}
                  href={href({ status: k })}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm",
                    status[0] === k ? "bg-accent/15 text-fg" : "text-muted hover:bg-surface hover:text-fg"
                  )}
                >
                  {l}
                  <span className="text-xs text-muted-2">{count(channel, st)}</span>
                </Link>
              ))}
            </div>
          </div>
        </aside>

        {/* Right side */}
        <section className="min-w-0 space-y-4">
          {notice && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
              <span className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> {notice}
              </span>
              <Link href={`/channels?tab=${channel}`} className="inline-flex items-center gap-1 font-medium text-warning hover:underline">
                Open {CHANNELS[channel as ChannelKey].label} settings <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}

          <Card className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
            <Kpi label="Sent" value={nf.format(totals.sent)} />
            <Kpi label="Real clicks" value={nf.format(totals.clicks)} />
            <Kpi label="People clicked" value={nf.format(totals.people)} sub={`${rate} of sent`} accent />
            <Kpi label="Bot hits blocked" value={nf.format(totals.bots)} sub="not counted" />
          </Card>

          {rows.length === 0 ? (
            <Card className="px-6 py-16 text-center">
              <Megaphone className="mx-auto h-9 w-9 text-accent" />
              <p className="mt-4 font-medium">
                {count(channel) === 0 ? `No ${channel === "all" ? "" : `${CHANNELS[channel].label} `}campaigns yet` : "Nothing here"}
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                Pick who gets it (e.g. Hot leads), write the message, send yourself a test, then start.
              </p>
              <Link href={newHref} className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-sm font-medium text-white">
                <Plus className="h-4 w-4" /> New campaign
              </Link>
            </Card>
          ) : (
            <div className="space-y-2">
              {rows.map((c) => {
                const done = c.sentCount + c.failedCount;
                const pct = c.totalRecipients ? (done / c.totalRecipients) * 100 : 0;
                const ctr = c.sentCount ? `${((c.uniqueClickers / c.sentCount) * 100).toFixed(1)}%` : "—";
                return (
                  <Link key={c.id} href={`/campaigns/${c.id}`} className="block">
                    <Card className="p-4 transition-colors hover:border-line-strong">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                        <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
                          <ChannelIcon channel={c.channel} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium">{c.name}</span>
                              {c.sequenceId && <span className="rounded-full bg-violet/15 px-1.5 py-0.5 text-[10px] font-medium text-violet">Sequence</span>}
                              <CampaignStatus status={c.status} />
                            </div>
                            <div className="mt-0.5 text-xs text-muted-2">
                              {CHANNELS[c.channel as ChannelKey]?.label ?? c.channel} · {nf.format(c.totalRecipients)} people · {timeAgo(c.createdAt)}
                            </div>
                          </div>
                        </div>
                        <div className="w-full sm:w-44">
                          <div className="flex justify-between text-[11px] text-muted">
                            <span>
                              {nf.format(c.sentCount)} / {nf.format(c.totalRecipients)} sent
                            </span>
                            <span>{Math.round(pct)}%</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                            <div className={cn("h-full rounded-full", BAR[c.channel] ?? "bg-accent")} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="flex gap-5 text-right">
                          <Mini label="clicks" value={nf.format(c.humanClicks)} />
                          <Mini label="people" value={nf.format(c.uniqueClickers)} />
                          <Mini label="rate" value={ctr} accent />
                        </div>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MenuItem({ href, active, count, children }: { href: string; active: boolean; count: number; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-3 transition-colors",
        active ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface hover:border-line-strong"
      )}
    >
      {children}
      <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{count}</span>
    </Link>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tracking-tight", accent && "text-success")}>{value}</div>
      {sub && <div className="text-[11px] text-muted-2">{sub}</div>}
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className={cn("text-sm font-semibold", accent && "text-success")}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-2">{label}</div>
    </div>
  );
}
