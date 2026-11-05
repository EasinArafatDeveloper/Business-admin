import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, gt } from "drizzle-orm";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { smsParts } from "@/lib/sms-text";
import { smsRate } from "@/lib/sms";
import { cn, nf, timeAgo } from "@/lib/utils";
import { Card } from "@/components/ui";
import { CampaignStatus } from "@/components/campaigns/campaign-status";
import { CampaignControls, TestSmsForm } from "@/components/campaigns/campaign-controls";

export async function generateMetadata({ params }: PageProps<"/campaigns/[id]">) {
  return { title: `Campaign #${(await params).id}` };
}

const TABS = [
  ["all", "Everyone"],
  ["clicked", "Clicked"],
  ["failed", "Failed"]
] as const;

export default async function CampaignPage({ params, searchParams }: PageProps<"/campaigns/[id]">) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const tab = String((await searchParams).tab ?? "all");

  const C = schema.campaigns;
  const R = schema.campaignRecipients;
  const [c] = await db.select().from(C).where(and(eq(C.id, id), eq(C.workspaceId, user.workspaceId))).limit(1);
  if (!c) notFound();

  const where =
    tab === "clicked" ? and(eq(R.campaignId, id), gt(R.clickCount, 0)) : tab === "failed" ? and(eq(R.campaignId, id), eq(R.status, "failed")) : eq(R.campaignId, id);
  const [recipients, [sample]] = await Promise.all([
    db
      .select({
        id: R.id,
        phone: R.phone,
        status: R.status,
        error: R.error,
        sentAt: R.sentAt,
        clickCount: R.clickCount,
        botClickCount: R.botClickCount,
        firstClickedAt: R.firstClickedAt,
        leadId: R.leadId,
        name: schema.leads.pageName
      })
      .from(R)
      .leftJoin(schema.leads, eq(schema.leads.id, R.leadId))
      .where(where)
      .orderBy(tab === "clicked" ? desc(R.clickCount) : R.id)
      .limit(200),
    db.select({ message: R.message }).from(R).where(eq(R.campaignId, id)).limit(1)
  ]);

  const parts = sample ? smsParts(sample.message).parts : 1;
  const cost = `৳${nf.format(Math.round(c.totalRecipients * parts * smsRate() * 100) / 100)}`;
  const progress = c.totalRecipients ? ((c.sentCount + c.failedCount) / c.totalRecipients) * 100 : 0;
  const ctr = c.sentCount ? (c.uniqueClickers / c.sentCount) * 100 : 0;

  const stats = [
    ["Sent", `${nf.format(c.sentCount)} / ${nf.format(c.totalRecipients)}`],
    ["Failed", nf.format(c.failedCount)],
    ["Real clicks", nf.format(c.humanClicks)],
    ["People clicked", nf.format(c.uniqueClickers)],
    ["Click rate", c.sentCount ? `${ctr.toFixed(1)}%` : "—"],
    ["Bot hits filtered", nf.format(c.botClicks)]
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Campaigns
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
            <CampaignStatus status={c.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {c.ratePerMinute} SMS/min · {parts} part{parts > 1 ? "s" : ""} each · est. {cost} · created {timeAgo(c.createdAt)}
          </p>
        </div>
        <CampaignControls id={c.id} status={c.status} total={c.totalRecipients} cost={cost} />
      </div>

      {c.lastError && c.status === "paused" && (
        <div className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            Paused automatically: <b>{c.lastError}</b>. Fix it (e.g. recharge BulkSMSBD), then press Resume.
          </span>
        </div>
      )}

      <div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map(([k, v]) => (
            <Card key={k} className="p-4">
              <div className="text-xs text-muted">{k}</div>
              <div className="mt-1 text-xl font-semibold">{v}</div>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="text-xs text-muted">Message (as sent to the first person)</div>
          <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-ink-alt p-3.5 text-sm">{sample?.message}</p>
          <p className="mt-2 truncate text-xs text-muted-2">Link goes to {c.destinationUrl}</p>
        </Card>
        <Card className="p-5">
          <TestSmsForm id={c.id} />
        </Card>
      </div>

      <div className="rounded-2xl border border-line bg-surface">
        <div className="flex gap-1 border-b border-line p-2">
          {TABS.map(([key, label]) => (
            <Link
              key={key}
              href={`/campaigns/${c.id}${key === "all" ? "" : `?tab=${key}`}`}
              className={cn("rounded-lg px-3 py-1.5 text-sm", tab === key ? "bg-accent/15 text-fg" : "text-muted hover:text-fg")}
            >
              {label}
            </Link>
          ))}
        </div>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted-2">
                <th className="px-4 py-2.5 font-medium">Business</th>
                <th className="px-3 py-2.5 font-medium">Phone</th>
                <th className="px-3 py-2.5 font-medium">SMS</th>
                <th className="px-3 py-2.5 font-medium">Real clicks</th>
                <th className="px-3 py-2.5 font-medium">First click</th>
                <th className="px-3 py-2.5 font-medium">Bot hits</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="max-w-[260px] truncate px-4 py-2.5">
                    {r.leadId ? (
                      <Link href={`/leads/${r.leadId}`} className="hover:text-accent-soft">
                        {r.name ?? "Lead"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted">{r.phone}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "text-xs",
                        r.status === "sent" ? "text-success" : r.status === "failed" ? "text-danger" : "text-muted"
                      )}
                      title={r.error ?? undefined}
                    >
                      {r.status === "sent" && r.sentAt ? `sent ${timeAgo(r.sentAt)}` : r.status === "failed" ? `failed · ${r.error ?? ""}` : r.status}
                    </span>
                  </td>
                  <td className={cn("px-3 py-2.5", r.clickCount > 0 && "font-semibold text-success")}>{r.clickCount}</td>
                  <td className="px-3 py-2.5 text-muted">{r.firstClickedAt ? timeAgo(r.firstClickedAt) : "—"}</td>
                  <td className="px-3 py-2.5 text-muted-2">{r.botClickCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recipients.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">Nobody here yet.</p>}
          {recipients.length === 200 && <p className="px-4 py-3 text-xs text-muted-2">Showing the first 200.</p>}
        </div>
      </div>
    </div>
  );
}
