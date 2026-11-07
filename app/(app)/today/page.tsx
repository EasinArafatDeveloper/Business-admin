import Link from "next/link";
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { CalendarCheck, Inbox, Workflow, Zap } from "lucide-react";
import { db, schema } from "@/db";
import { requireAccess } from "@/lib/auth";
import { endOfToday } from "@/lib/today";
import { dhakaNow } from "@/lib/campaigns";
import { Card } from "@/components/ui";
import { TaskCard, type TaskView } from "@/components/today/task-card";
import { nf } from "@/lib/utils";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const user = await requireAccess("campaigns");
  const ws = user.workspaceId;
  const T = schema.tasks;
  const L = schema.leads;
  const M = schema.inboundMessages;
  const R = schema.campaignRecipients;
  const C = schema.campaigns;
  const E = schema.enrollments;
  const { startOfDay } = dhakaNow();
  const end = endOfToday();

  const [tasks, [unread], [queued], [doneToday], [running], [upcoming]] = await Promise.all([
    db
      .select({ t: T, name: L.pageName, status: L.status })
      .from(T)
      .innerJoin(L, eq(L.id, T.leadId))
      .where(and(eq(T.workspaceId, ws), eq(T.state, "open"), lte(T.dueAt, end)))
      .orderBy(asc(T.dueAt), asc(T.id))
      .limit(300),
    db
      .select({ n: sql<number>`count(distinct ${M.sender})::int` })
      .from(M)
      .where(and(eq(M.workspaceId, ws), eq(M.direction, "in"), isNull(M.readAt))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(R)
      .innerJoin(C, eq(C.id, R.campaignId))
      .where(and(eq(R.workspaceId, ws), isNotNull(C.sequenceId), inArray(R.status, ["queued", "sending"]))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(T)
      .where(and(eq(T.workspaceId, ws), eq(T.state, "done"), gte(T.doneAt, startOfDay))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(E)
      .where(and(eq(E.workspaceId, ws), eq(E.state, "active"))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(T)
      .where(and(eq(T.workspaceId, ws), eq(T.state, "open"), gt(T.dueAt, end)))
  ]);

  const view: TaskView[] = tasks.map(({ t, name, status }) => ({
    id: t.id,
    channel: t.channel,
    title: t.title,
    subject: t.subject,
    body: t.body,
    contact: t.contact,
    dueAt: t.dueAt.toISOString(),
    overdue: t.dueAt < startOfDay,
    lead: { id: t.leadId, name, status }
  }));
  const groups = [
    { key: "whatsapp", label: "WhatsApp to send" },
    { key: "call", label: "Calls" },
    { key: "sms", label: "SMS to send" },
    { key: "email", label: "Emails to send" }
  ].map((g) => ({ ...g, items: view.filter((v) => v.channel === g.key) }));
  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dhaka" });

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="mt-1 text-sm text-muted">{date}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile icon={CalendarCheck} n={view.length} label="to do today" sub={`${nf.format(doneToday?.n ?? 0)} done`} />
        <Tile icon={Inbox} n={unread?.n ?? 0} label="replies waiting" href="/inbox" tone={unread?.n ? "text-success" : undefined} />
        <Tile icon={Zap} n={queued?.n ?? 0} label="auto messages queued" sub="sent 9am–9pm" />
        <Tile icon={Workflow} n={running?.n ?? 0} label="leads in sequences" href="/sequences" />
      </div>

      {view.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted">
          <CalendarCheck className="h-8 w-8 text-success" />
          Nothing to do by hand right now.
          {upcoming?.n ? ` ${nf.format(upcoming.n)} tasks are coming up on later days.` : ""}
          <span className="text-xs">
            Steps set to “By hand” in a <Link href="/sequences" className="underline">sequence</Link> show up here on their day.
          </span>
        </Card>
      ) : (
        groups
          .filter((g) => g.items.length)
          .map((g) => (
            <section key={g.key} className="space-y-2">
              <h2 className="text-sm font-medium text-muted">
                {g.label} · {g.items.length}
              </h2>
              {g.items.map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </section>
          ))
      )}
    </div>
  );
}

function Tile({ icon: Icon, n, label, sub, href, tone }: { icon: typeof Inbox; n: number; label: string; sub?: string; href?: string; tone?: string }) {
  const inner = (
    <Card className="h-full p-4 hover:border-line-strong">
      <Icon className="h-4 w-4 text-muted" />
      <div className={`mt-2 text-2xl font-semibold ${tone ?? ""}`}>{nf.format(n)}</div>
      <div className="text-xs text-muted">{label}</div>
      {sub && <div className="text-[11px] text-muted-2">{sub}</div>}
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
