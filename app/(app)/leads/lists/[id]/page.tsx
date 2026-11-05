import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, Bot, Filter, Mail, MessageCircle, MessageSquareText } from "lucide-react";
import { db, schema } from "@/db";
import { requireAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { nf, timeAgo } from "@/lib/utils";
import { Card, PriorityText, StatusBadge } from "@/components/ui";
import { DeleteList, ItemMessage, RemoveItem, RenameList } from "@/components/lists/list-forms";

export async function generateMetadata({ params }: PageProps<"/leads/lists/[id]">) {
  return { title: `List #${(await params).id}` };
}

export default async function ListPage({ params, searchParams }: PageProps<"/leads/lists/[id]">) {
  const user = await requireAccess("leads");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const sp = await searchParams;
  const LL = schema.leadLists;
  const LI = schema.leadListItems;
  const L = schema.leads;
  const [list] = await db
    .select()
    .from(LL)
    .where(and(eq(LL.id, id), eq(LL.workspaceId, user.workspaceId)))
    .limit(1);
  if (!list) notFound();
  const items = await db
    .select({
      item: LI,
      lead: { id: L.id, name: L.pageName, status: L.status, priority: L.priority, industry: L.industry, phone: L.phone, whatsapp: L.whatsapp, email: L.email }
    })
    .from(LI)
    .innerJoin(L, eq(L.id, LI.leadId))
    .where(eq(LI.listId, id))
    .orderBy(asc(LI.position), asc(LI.id));

  const personal = items.filter((i) => i.item.message?.trim()).length;
  const campaigns = can(user, "campaigns");
  const added = typeof sp.added === "string" ? Number(sp.added) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/leads/lists" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Saved lists
      </Link>

      {added !== null && (
        <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success">
          Saved {nf.format(added)} new leads to this list.
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{list.name}</h1>
            {list.source === "ai" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent-soft">
                <Bot className="h-3 w-3" /> made by AI
              </span>
            )}
          </div>
          {list.description && <p className="mt-1 max-w-3xl text-sm text-muted">{list.description}</p>}
          <p className="mt-1 text-xs text-muted-2">
            {nf.format(items.length)} leads · {nf.format(personal)} with their own message · updated {timeAgo(list.updatedAt)}
          </p>
        </div>
        <Link
          href={`/leads?list=${id}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-sm hover:border-accent/60"
        >
          <Filter className="h-4 w-4" /> Open in Leads
        </Link>
      </div>

      {campaigns && items.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="text-sm">
            <b>Send to this list</b>
            <span className="text-muted">
              {personal > 0 ? ` — ${nf.format(personal)} people get their own message, the rest get yours.` : " — everyone gets the message you write."}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ["sms", "SMS", MessageSquareText],
              ["whatsapp", "WhatsApp", MessageCircle],
              ["email", "Email", Mail]
            ].map(([ch, label, Icon]) => {
              const I = Icon as typeof Mail;
              return (
                <Link
                  key={ch as string}
                  href={`/campaigns/new?list=${id}${ch === "sms" ? "" : `&channel=${ch}`}`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-sm font-medium text-white hover:bg-[#5a83ff]"
                >
                  <I className="h-4 w-4" /> {label as string}
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="divide-y divide-line">
          {items.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted">No leads in this list.</p>}
          {items.map(({ item, lead }, i) => (
            <div key={item.id} className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_32px]">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-2">{i + 1}.</span>
                  <Link href={`/leads/${lead.id}`} className="truncate font-medium hover:text-accent-soft">
                    {lead.name ?? "Lead"}
                  </Link>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <StatusBadge status={lead.status} />
                  <PriorityText priority={lead.priority} />
                  {lead.industry && <span className="text-muted-2">{lead.industry}</span>}
                </div>
                <div className="mt-1 truncate text-xs text-muted-2">
                  {[lead.whatsapp || lead.phone, lead.email].filter(Boolean).join(" · ") || "No contact"}
                </div>
                {item.reason && <p className="mt-2 text-xs text-muted">{item.reason}</p>}
              </div>
              <ItemMessage id={item.id} message={item.message} subject={item.subject} ai={list.source === "ai"} />
              <RemoveItem id={item.id} />
            </div>
          ))}
        </Card>

        <div className="space-y-4 lg:sticky lg:top-6 lg:h-fit">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-medium">List details</h2>
            <RenameList id={id} name={list.name} description={list.description} />
          </Card>
          <DeleteList id={id} name={list.name} />
        </div>
      </div>
    </div>
  );
}
