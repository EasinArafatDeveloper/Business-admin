import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  CalendarCheck,
  ExternalLink,
  Globe,
  Mail,
  Megaphone,
  MessageCircle,
  MessageSquareText,
  MousePointerClick,
  PanelsTopLeft,
  Phone,
  StickyNote
} from "lucide-react";
import { db, schema } from "@/db";
import { requireAccess } from "@/lib/auth";
import { cn, digitsOnly, nf, timeAgo } from "@/lib/utils";
import { Card, PriorityText } from "@/components/ui";
import { CopyButton, NoteForm, SmsOptOutToggle, StatusPicker, TagEditor } from "@/components/leads/lead-controls";
import { kindOf } from "@/lib/activity";
import { ConvertLeadButton } from "@/components/billing/forms";
import { can } from "@/lib/permissions";

export async function generateMetadata({ params }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  return { title: `Lead #${id}` };
}

export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  const user = await requireAccess("leads");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const L = schema.leads;
  const [lead] = await db
    .select()
    .from(L)
    .where(and(eq(L.id, id), eq(L.workspaceId, user.workspaceId)))
    .limit(1);
  if (!lead) notFound();

  const A = schema.leadActivities;
  const activity = await db
    .select({ id: A.id, type: A.type, channel: A.channel, body: A.body, meta: A.meta, createdAt: A.createdAt, user: schema.users.name })
    .from(A)
    .leftJoin(schema.users, eq(schema.users.id, A.userId))
    .where(eq(A.leadId, lead.id))
    .orderBy(desc(A.createdAt))
    .limit(200);
  const sentCount = activity.filter((a) => kindOf(a.type).dir === "out" && a.type !== "meeting").length;
  const replyCount = activity.filter((a) => a.type.endsWith("_reply")).length;

  const [client] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(and(eq(schema.clients.workspaceId, user.workspaceId), eq(schema.clients.leadId, lead.id)))
    .limit(1);
  const wa = digitsOnly(lead.whatsapp || lead.phone);
  const waText = lead.pitch ? `Assalamu Alaikum! ${lead.pitch}` : "Assalamu Alaikum!";
  const actions = [
    wa && {
      href: `https://wa.me/${wa}?text=${encodeURIComponent(waText)}`,
      label: "WhatsApp",
      sub: lead.whatsapp || lead.phone,
      icon: MessageCircle,
      tone: "text-success"
    },
    lead.phone && { href: `tel:${lead.phone}`, label: "Call", sub: lead.phone, icon: Phone, tone: "text-accent-soft" },
    lead.email && { href: `mailto:${lead.email.split(",")[0].trim()}`, label: "Email", sub: lead.email, icon: Mail, tone: "text-warning" },
    lead.pageLink && { href: lead.pageLink, label: "Facebook page", sub: "Open page", icon: PanelsTopLeft, tone: "text-accent-soft" },
    lead.adsLibraryLink && { href: lead.adsLibraryLink, label: "Ads Library", sub: `${lead.activeAds ?? 0} active ads`, icon: Megaphone, tone: "text-violet" },
    lead.website && { href: lead.website, label: "Website", sub: lead.websitePlatform ?? lead.websiteType ?? "", icon: Globe, tone: "text-muted" }
  ].filter(Boolean) as { href: string; label: string; sub: string | null; icon: typeof Phone; tone: string }[];

  const facts: [string, string | number | null | undefined][] = [
    ["Industry", lead.industry],
    ["Category", lead.category],
    ["Page size", lead.sizeTier],
    ["Followers", lead.followers != null ? nf.format(lead.followers) : null],
    ["Website type", lead.websiteType],
    ["Platform", lead.websitePlatform],
    ["Orders via", lead.ordersVia],
    ["Active ads", lead.activeAds],
    ["Running days", lead.runningDays],
    ["Offers", lead.offers],
    ["Ad prices", lead.adPriceRange],
    ["Service gaps", lead.serviceGaps],
    ["Address", lead.address],
    ["Bangladesh", lead.inBangladesh == null ? null : lead.inBangladesh ? "Yes" : "No / unclear"],
    ["SMS real clicks", lead.smsClicks || null],
    ["Campaigns clicked", lead.smsCampaignsClicked || null],
    ["Last SMS click", lead.lastClickedAt ? lead.lastClickedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : null],
    ["Source", lead.source],
    ["Added", lead.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })]
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{lead.pageName ?? "Untitled lead"}</h1>
          <p className="mt-1 text-sm text-muted">
            {lead.category}
            {lead.score != null && (
              <>
                {" "}
                · Score <span className="font-medium text-fg">{lead.score}</span> · <PriorityText priority={lead.priority} />
              </>
            )}
          </p>
          <div className="mt-2">
            <TagEditor leadId={lead.id} tags={lead.tags} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {can(user, "clients") && <ConvertLeadButton leadId={lead.id} existingClientId={client?.id} />}
            <StatusPicker key={lead.status} leadId={lead.id} status={lead.status} />
          </div>
          <div className="flex gap-1.5">
            <SmsOptOutToggle leadId={lead.id} optOut={lead.smsOptOut} />
            <SmsOptOutToggle leadId={lead.id} optOut={lead.waOptOut} channel="whatsapp" />
            <SmsOptOutToggle leadId={lead.id} optOut={lead.emailOptOut} channel="email" />
          </div>
        </div>
      </div>

      {actions.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {actions.map((a) => (
            <a
              key={a.label}
              href={a.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl border border-line bg-surface p-3.5 hover:border-line-strong"
            >
              <div className="flex items-center justify-between">
                <a.icon className={`h-4 w-4 ${a.tone}`} />
                <ExternalLink className="h-3.5 w-3.5 text-muted-2 group-hover:text-fg" />
              </div>
              <div className="mt-2 text-sm font-medium">{a.label}</div>
              <div className="truncate text-[11px] text-muted-2">{a.sub}</div>
            </a>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {(lead.primaryService || lead.pitch) && (
            <Card className="p-5">
              <div className="text-xs text-muted">Best-fit service</div>
              <div className="mt-1 text-lg font-semibold">{lead.primaryService ?? "—"}</div>
              {lead.painPoint && <p className="mt-2 text-sm text-muted">{lead.painPoint}</p>}
              {lead.pitch && (
                <div className="mt-4 rounded-xl border border-line bg-ink-alt p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs text-muted">Pitch message</span>
                    <CopyButton text={lead.pitch} />
                  </div>
                  <p className="text-sm leading-relaxed">{lead.pitch}</p>
                </div>
              )}
              {lead.allServices && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {lead.allServices.split(",").map((s) => (
                    <span key={s} className="rounded-full border border-line-strong px-2.5 py-0.5 text-xs text-muted">
                      {s.trim()}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          )}

          {lead.details && Object.keys(lead.details).length > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-medium">Form answers</h2>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {Object.entries(lead.details).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs capitalize text-muted-2">{k.replace(/([A-Z])/g, " $1")}</dt>
                    <dd className="whitespace-pre-wrap break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          <Card className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">Timeline</h2>
              <span className="text-xs text-muted">
                {sentCount} sent · {replyCount} {replyCount === 1 ? "reply" : "replies"}
                {lead.lastContactedAt && <> · last contact {timeAgo(lead.lastContactedAt)}</>}
              </span>
            </div>
            <div className="mt-3">
              <NoteForm leadId={lead.id} />
            </div>
            <ol className="mt-5 space-y-4 border-l border-line pl-5">
              {activity.map((a) => {
                const k = kindOf(a.type);
                const ch = a.channel ?? k.channel;
                const Icon =
                  a.type === "note"
                    ? StickyNote
                    : a.type === "click"
                      ? MousePointerClick
                      : a.type === "meeting"
                        ? CalendarCheck
                        : ch === "whatsapp"
                          ? MessageCircle
                          : ch === "email"
                            ? Mail
                            : ch === "phone"
                              ? Phone
                              : ch === "sms"
                                ? MessageSquareText
                                : null;
                const meta = (a.meta ?? {}) as { campaignId?: number; campaign?: string; via?: string };
                return (
                  <li key={a.id} className="relative">
                    <span
                      className={cn(
                        "absolute -left-[31px] top-0 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface",
                        k.dir === "in" ? "text-success" : k.dir === "out" ? "text-accent-soft" : "text-muted"
                      )}
                    >
                      {Icon ? <Icon className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                    </span>
                    <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-2">
                      <span className={cn("inline-flex items-center gap-0.5 font-medium", k.dir === "in" ? "text-success" : k.dir === "out" ? "text-fg" : "text-muted")}>
                        {k.dir === "in" && <ArrowDownLeft className="h-3 w-3" />}
                        {k.dir === "out" && <ArrowUpRight className="h-3 w-3" />}
                        {k.label}
                      </span>
                      {meta.campaignId && (
                        <Link href={`/campaigns/${meta.campaignId}`} className="hover:text-accent-soft">
                          · {meta.campaign ?? `Campaign #${meta.campaignId}`}
                        </Link>
                      )}
                      {a.user && <span>· {a.user}</span>}
                      {meta.via === "ai" && <span>· by AI</span>}
                      <span title={a.createdAt.toLocaleString("en-GB")}>· {timeAgo(a.createdAt)}</span>
                    </div>
                    {a.body && <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-sm">{a.body}</p>}
                  </li>
                );
              })}
              {activity.length === 0 && <li className="text-sm text-muted-2">Nothing yet.</li>}
            </ol>
          </Card>
        </div>

        <Card className="h-fit p-5">
          <h2 className="text-sm font-medium">Details</h2>
          <dl className="mt-3 space-y-2.5 text-sm">
            {facts
              .filter(([, v]) => v != null && v !== "")
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted-2">{k}</dt>
                  <dd className="text-right break-words">{v}</dd>
                </div>
              ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
