import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Megaphone, Plus, Wallet } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getBalance, smsRate } from "@/lib/sms";
import { nf, timeAgo } from "@/lib/utils";
import { Card } from "@/components/ui";
import { CampaignStatus } from "@/components/campaigns/campaign-status";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const user = await requireUser();
  const C = schema.campaigns;
  const [rows, balance] = await Promise.all([
    db.select().from(C).where(eq(C.workspaceId, user.workspaceId)).orderBy(desc(C.id)).limit(100),
    getBalance()
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted">Every person gets their own link. Only real human clicks are counted — link-preview bots are filtered out.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm">
            <Wallet className="h-4 w-4 text-accent" />
            {balance == null ? "Balance unavailable" : `৳${balance.toFixed(2)} ≈ ${nf.format(Math.floor(balance / smsRate()))} SMS`}
          </span>
          <Link href="/leads" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-sm font-medium text-white">
            <Plus className="h-4 w-4" /> New campaign
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="px-6 py-16 text-center">
          <Megaphone className="mx-auto h-9 w-9 text-accent" />
          <p className="mt-4 font-medium">No campaigns yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Go to Leads, filter the audience you want (e.g. Hot + Fashion + has phone), then press “SMS campaign”.
          </p>
        </Card>
      ) : (
        <div className="scroll-thin overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted-2">
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Sent</th>
                <th className="px-3 py-3 font-medium">Real clicks</th>
                <th className="px-3 py-3 font-medium">People clicked</th>
                <th className="px-3 py-3 font-medium">Click rate</th>
                <th className="px-3 py-3 font-medium">Bot hits</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-ink-alt/60">
                  <td className="px-4 py-3">
                    <Link href={`/campaigns/${c.id}`} className="font-medium hover:text-accent-soft">
                      {c.name}
                    </Link>
                    <div className="text-[11px] text-muted-2">
                      {c.channel === "whatsapp" ? "WhatsApp" : "SMS"} · created {timeAgo(c.createdAt)}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <CampaignStatus status={c.status} />
                  </td>
                  <td className="px-3 py-3 text-muted">
                    {nf.format(c.sentCount)} / {nf.format(c.totalRecipients)}
                  </td>
                  <td className="px-3 py-3 font-medium">{nf.format(c.humanClicks)}</td>
                  <td className="px-3 py-3">{nf.format(c.uniqueClickers)}</td>
                  <td className="px-3 py-3 text-success">{c.sentCount ? `${((c.uniqueClickers / c.sentCount) * 100).toFixed(1)}%` : "—"}</td>
                  <td className="px-3 py-3 text-muted-2">{nf.format(c.botClicks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
