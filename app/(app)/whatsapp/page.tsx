import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { WA_HOURS } from "@/lib/campaigns";
import { timeAgo } from "@/lib/utils";
import { Card } from "@/components/ui";
import { WaConnect } from "@/components/whatsapp/wa-connect";

export const metadata = { title: "WhatsApp" };

export default async function WhatsappPage() {
  const user = await requireUser();
  const M = schema.inboundMessages;
  const replies = await db
    .select({ id: M.id, sender: M.sender, senderName: M.senderName, body: M.body, leadId: M.leadId, optOut: M.optOut, createdAt: M.createdAt, lead: schema.leads.pageName })
    .from(M)
    .leftJoin(schema.leads, eq(schema.leads.id, M.leadId))
    .where(and(eq(M.workspaceId, user.workspaceId), eq(M.channel, "whatsapp")))
    .orderBy(desc(M.createdAt))
    .limit(50);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp</h1>
        <p className="mt-1 text-sm text-muted">Link a WhatsApp number once; campaigns then send from it and replies show up here.</p>
      </div>

      <WaConnect />

      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-success" /> Built-in protection against bans
        </h2>
        <ul className="mt-3 grid grid-cols-1 gap-2 text-sm text-muted sm:grid-cols-2">
          <li>• One message at a time, random 30–90 s gap (you can change it per campaign)</li>
          <li>• Daily limit per number (default 150) across all campaigns</li>
          <li>
            • Sends only {WA_HOURS.from}am–{WA_HOURS.to - 12}pm Dhaka time
          </li>
          <li>• Shows “typing…” before each message, like a person</li>
          <li>• {"{Hi|Hello|Assalamu Alaikum}"} gives everyone a slightly different text</li>
          <li>• Numbers not on WhatsApp are skipped; “STOP” replies are opted out automatically</li>
        </ul>
        <p className="mt-3 text-xs text-warning">
          New numbers: start with 20–30 a day for the first week, then raise it slowly. Unofficial automation can still get a number banned — never use your main business number.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-medium">Latest replies</h2>
        {replies.length === 0 ? (
          <p className="mt-3 text-sm text-muted-2">No replies yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {replies.map((r) => (
              <li key={r.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {r.leadId ? (
                      <Link href={`/leads/${r.leadId}`} className="hover:text-accent-soft">
                        {r.lead ?? r.senderName ?? `+${r.sender}`}
                      </Link>
                    ) : (
                      (r.senderName ?? `+${r.sender}`)
                    )}
                    {r.optOut && <span className="ml-2 rounded-full bg-danger/15 px-2 py-0.5 text-[11px] text-danger">opted out</span>}
                  </span>
                  <span className="text-xs text-muted-2">
                    +{r.sender} · {timeAgo(r.createdAt)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-muted">{r.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
