import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { Bookmark, Bot, MessageSquareText, Sparkles } from "lucide-react";
import { db, schema } from "@/db";
import { requireAccess } from "@/lib/auth";
import { nf, timeAgo } from "@/lib/utils";
import { Card } from "@/components/ui";

export const metadata = { title: "Saved lists" };

export default async function ListsPage() {
  const user = await requireAccess("leads");
  const LL = schema.leadLists;
  const LI = schema.leadListItems;
  const lists = await db
    .select({
      l: LL,
      who: schema.users.name,
      count: sql<number>`count(${LI.id})::int`,
      personal: sql<number>`count(${LI.id}) filter (where ${LI.message} is not null and ${LI.message} <> '')::int`
    })
    .from(LL)
    .leftJoin(LI, eq(LI.listId, LL.id))
    .leftJoin(schema.users, eq(schema.users.id, LL.createdBy))
    .where(eq(LL.workspaceId, user.workspaceId))
    .groupBy(LL.id, schema.users.name)
    .orderBy(desc(LL.updatedAt));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Saved lists</h1>
        <p className="mt-1 text-sm text-muted">
          Hand-picked groups of leads — by you from Leads filters, or by an AI that analysed them. Send a campaign to just one list.
        </p>
      </div>

      {lists.length === 0 ? (
        <Card className="px-6 py-14 text-center">
          <Bookmark className="mx-auto h-9 w-9 text-accent" />
          <p className="mt-4 font-medium">No saved lists yet</p>
          <div className="mx-auto mt-3 max-w-lg space-y-2 text-left text-sm text-muted">
            <p>
              <b className="text-fg">From Leads:</b> filter the leads you want, then press <b className="text-fg">Save to list</b>.
            </p>
            <p>
              <b className="text-fg">With AI:</b> ask Claude/ChatGPT (connected in Settings → AI access), e.g. “Analyse the Hot fashion leads, pick the best 50
              for an e-commerce website, write each one a short WhatsApp message, and save them as a list.”
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {lists.map(({ l, who, count, personal }) => (
            <Link key={l.id} href={`/leads/lists/${l.id}`}>
              <Card className="h-full p-5 transition-colors hover:border-line-strong">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{l.name}</div>
                    {l.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{l.description}</p>}
                  </div>
                  {l.source === "ai" ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent-soft">
                      <Bot className="h-3 w-3" /> AI
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">Manual</span>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="font-semibold text-fg">{nf.format(count)} leads</span>
                  {personal > 0 && (
                    <span className="inline-flex items-center gap-1 text-success">
                      <MessageSquareText className="h-3.5 w-3.5" /> {nf.format(personal)} own messages
                    </span>
                  )}
                  <span>
                    {who ? `${who} · ` : ""}updated {timeAgo(l.updatedAt)}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-2">
        <Sparkles className="h-3.5 w-3.5" /> Lists made by AI keep its reason for each lead, and can include a personal message for each person.
      </p>
    </div>
  );
}
