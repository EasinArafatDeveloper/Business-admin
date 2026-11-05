import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { buildAudience } from "@/lib/campaigns";
import { filtersToQuery, parseFilters } from "@/lib/leads-query";
import { getBalance, smsRate } from "@/lib/sms";
import { linkBase } from "@/lib/tracking";
import { nf } from "@/lib/utils";
import { groupAudience } from "@/lib/sms-text";
import { Card } from "@/components/ui";
import { CampaignForm } from "@/components/campaigns/campaign-form";

export const metadata = { title: "New campaign" };

export default async function NewCampaignPage({ searchParams }: PageProps<"/campaigns/new">) {
  const user = await requireUser();
  const sp = await searchParams;
  const channel = sp.channel === "whatsapp" ? "whatsapp" : "sms";
  const filters = parseFilters(sp);
  const query = filtersToQuery({ ...filters, page: 1 }).replace(/^\?/, "");
  const [{ audience, matched, noNumber, duplicate }, balance] = await Promise.all([
    buildAudience(user.workspaceId, filters, channel),
    channel === "sms" ? getBalance() : Promise.resolve(null)
  ]);
  const tabHref = (c: string) => {
    const p = new URLSearchParams(query);
    if (c === "whatsapp") p.set("channel", "whatsapp");
    return `/campaigns/new${p.toString() ? `?${p}` : ""}`;
  };
  const sample = audience[0];

  const described = Object.entries(filters)
    .filter(([k, v]) => !["page", "sort"].includes(k) && v !== undefined && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href={`/leads${query ? `?${query}` : ""}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">New campaign</h1>
        <div className="inline-flex rounded-xl border border-line-strong p-1 text-sm">
          {[
            ["sms", "SMS"],
            ["whatsapp", "WhatsApp"]
          ].map(([c, label]) => (
            <Link key={c} href={tabHref(c)} className={`rounded-lg px-4 py-1.5 ${channel === c ? "bg-accent text-white" : "text-muted hover:text-fg"}`}>
              {label}
            </Link>
          ))}
        </div>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs text-muted">Audience (from your Leads filters)</div>
            <div className="mt-1 text-3xl font-semibold">{nf.format(audience.length)} people</div>
            <div className="mt-1 text-xs text-muted-2">
              {nf.format(matched)} leads matched · {nf.format(noNumber)} without a valid BD {channel === "whatsapp" ? "WhatsApp/mobile" : "mobile"} · {nf.format(duplicate)} duplicate numbers removed · opted-out leads excluded
            </div>
          </div>
          <div className="max-w-md text-right text-xs text-muted">
            {described.length ? described.join(" · ") : "No filters — all leads"}
            <div className="mt-2">
              <Link href={`/leads${query ? `?${query}` : ""}`} className="text-accent-soft hover:underline">
                Change filters
              </Link>
            </div>
          </div>
        </div>
      </Card>

      <CampaignForm
        key={channel}
        channel={channel}
        audienceQuery={query}
        audienceSize={audience.length}
        groups={groupAudience(audience)}
        sample={{ name: sample?.name ?? "Sign of Modesty", service: sample?.service ?? "E-commerce Website" }}
        linkBase={linkBase()}
        rate={smsRate()}
        balance={balance}
      />
    </div>
  );
}
