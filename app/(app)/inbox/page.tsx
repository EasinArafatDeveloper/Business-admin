import Link from "next/link";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ArrowLeft, Inbox as InboxIcon } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { cn, timeAgo } from "@/lib/utils";
import { Card, StatusBadge } from "@/components/ui";
import { ChannelIcon } from "@/components/campaigns/channel";
import { ReplyBox } from "@/components/inbox/reply-box";
import { RefreshOnce } from "@/components/inbox/refresh-once";

export const metadata = { title: "Inbox" };

const M = schema.inboundMessages;
const FILTERS = [
  ["all", "All"],
  ["unread", "Unread"],
  ["optout", "Opted out"]
] as const;

type Thread = {
  sender: string;
  channel: string;
  name: string | null;
  leadId: number | null;
  lastAt: Date;
  lastBody: string;
  lastDir: string;
  unread: number;
  optOut: boolean;
};

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter = FILTERS.find(([k]) => k === sp.filter)?.[0] ?? "all";
  const open = typeof sp.c === "string" ? sp.c.replace(/\D/g, "") : "";

  // Opening a thread marks its messages as read.
  let markedRead = 0;
  if (open) {
    markedRead = (
      await db
        .update(M)
        .set({ readAt: new Date() })
        .where(and(eq(M.workspaceId, user.workspaceId), eq(M.sender, open), eq(M.direction, "in"), isNull(M.readAt)))
        .returning({ id: M.id })
    ).length;
  }

  const having =
    filter === "unread"
      ? sql`having count(*) filter (where ${M.direction} = 'in' and ${M.readAt} is null) > 0`
      : filter === "optout"
        ? sql`having bool_or(${M.optOut})`
        : sql``;
  const threads = (
    await db.execute(sql`
      select ${M.sender} as sender,
             max(${M.channel}) as channel,
             max(${M.senderName}) filter (where ${M.direction} = 'in') as name,
             max(${M.leadId}) as "leadId",
             max(${M.createdAt}) as "lastAt",
             (array_agg(${M.body} order by ${M.createdAt} desc))[1] as "lastBody",
             (array_agg(${M.direction} order by ${M.createdAt} desc))[1] as "lastDir",
             (count(*) filter (where ${M.direction} = 'in' and ${M.readAt} is null))::int as unread,
             bool_or(${M.optOut}) as "optOut"
      from ${M}
      where ${M.workspaceId} = ${user.workspaceId}
      group by ${M.sender}
      ${having}
      order by max(${M.createdAt}) desc
      limit 200`)
  ).map((r) => ({ ...(r as unknown as Thread), lastAt: new Date((r as { lastAt: string }).lastAt) }));

  const leadIds = [...new Set(threads.map((t) => t.leadId).filter((x): x is number => x != null))];
  const leads = leadIds.length
    ? await db
        .select({ id: schema.leads.id, name: schema.leads.pageName, status: schema.leads.status })
        .from(schema.leads)
        .where(and(eq(schema.leads.workspaceId, user.workspaceId), inArray(schema.leads.id, leadIds)))
    : [];
  const leadById = new Map(leads.map((l) => [l.id, l]));

  const current = open ? threads.find((t) => t.sender === open) : undefined;
  const messages = open
    ? await db
        .select()
        .from(M)
        .where(and(eq(M.workspaceId, user.workspaceId), eq(M.sender, open)))
        .orderBy(asc(M.createdAt))
        .limit(300)
    : [];
  const title = (t: Thread) => (t.leadId ? leadById.get(t.leadId)?.name : null) ?? t.name ?? `+${t.sender}`;
  const href = (o: { c?: string | null; filter?: string }) => {
    const p = new URLSearchParams();
    const f = o.filter ?? filter;
    if (f !== "all") p.set("filter", f);
    const c = o.c === undefined ? open : o.c;
    if (c) p.set("c", c);
    return `/inbox${p.size ? `?${p}` : ""}`;
  };
  const currentLead = current?.leadId ? leadById.get(current.leadId) : undefined;
  const threadName = current ? title(current) : messages[0] ? `+${open}` : "";

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {markedRead > 0 && <RefreshOnce key={open} />}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-1 text-sm text-muted">Replies to your campaigns. Anyone who replies becomes “Interested”; “STOP” opts them out.</p>
      </div>

      <Card className="grid min-h-[560px] grid-cols-1 overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Conversations */}
        <div className={cn("flex min-h-0 flex-col border-line lg:border-r", open && "hidden lg:flex")}>
          <div className="flex gap-1 border-b border-line p-2">
            {FILTERS.map(([k, l]) => (
              <Link
                key={k}
                href={href({ filter: k, c: null })}
                className={cn("rounded-lg px-3 py-1.5 text-sm", filter === k ? "bg-accent/15 text-fg" : "text-muted hover:text-fg")}
              >
                {l}
              </Link>
            ))}
          </div>
          {threads.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
              <InboxIcon className="h-8 w-8 text-muted-2" />
              <p className="mt-3 text-sm text-muted">
                {filter === "all" ? "No replies yet. They show up here as soon as someone answers a campaign." : "Nothing here."}
              </p>
            </div>
          ) : (
            <ul className="scroll-thin max-h-[640px] flex-1 divide-y divide-line overflow-y-auto">
              {threads.map((t) => (
                <li key={t.sender}>
                  <Link
                    href={href({ c: t.sender })}
                    className={cn("flex gap-3 px-3 py-3 transition-colors hover:bg-ink-alt/60", t.sender === open && "bg-accent/10")}
                  >
                    <ChannelIcon channel={t.channel} size="sm" className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={cn("truncate text-sm", t.unread > 0 && "font-semibold")}>{title(t)}</span>
                        <span className="shrink-0 text-[11px] text-muted-2">{timeAgo(t.lastAt)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className={cn("truncate text-xs", t.unread > 0 ? "text-fg" : "text-muted")}>
                          {t.lastDir === "out" && "You: "}
                          {t.lastBody}
                        </span>
                        {t.unread > 0 && (
                          <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">{t.unread}</span>
                        )}
                        {t.optOut && <span className="ml-auto shrink-0 rounded-full bg-danger/15 px-1.5 text-[10px] text-danger">STOP</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Thread */}
        <div className={cn("flex min-h-0 flex-col", !open && "hidden lg:flex")}>
          {!open || messages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-2">Pick a conversation.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                <Link href={href({ c: null })} className="rounded-lg p-1 text-muted hover:text-fg lg:hidden" aria-label="Back to conversations">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{threadName}</div>
                  <div className="text-xs text-muted-2">+{open}</div>
                </div>
                {currentLead && (
                  <>
                    <StatusBadge status={currentLead.status} />
                    <Link href={`/leads/${currentLead.id}`} className="text-xs text-accent-soft hover:underline">
                      Open lead
                    </Link>
                  </>
                )}
              </div>
              <div className="scroll-thin flex max-h-[520px] flex-1 flex-col gap-2 overflow-y-auto bg-ink-alt/40 p-4">
                {messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                        m.direction === "out" ? "rounded-br-sm bg-accent text-white" : "rounded-bl-sm border border-line bg-surface"
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={cn("mt-1 text-right text-[10px]", m.direction === "out" ? "text-white/70" : "text-muted-2")}>
                        {m.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        {m.optOut && " · opted out"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <ReplyBox
                sender={open}
                disabledReason={
                  current?.optOut
                    ? "This person replied STOP, so replies are turned off to respect that."
                    : current && current.channel !== "whatsapp"
                      ? "Replies for this channel are coming soon."
                      : undefined
                }
              />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
