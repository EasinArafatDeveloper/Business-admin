import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db, schema } from "@/db";
import { requireAccess } from "@/lib/auth";
import { CHANNEL_LABEL } from "@/lib/sequences";
import { Card } from "@/components/ui";
import { SequenceBuilder } from "@/components/sequences/sequence-builder";
import { SequenceStatus } from "@/components/sequences/sequence-status";
import { ApproveWaiting, EnrollList, StopButton } from "@/components/sequences/enroll-controls";
import { cn, nf, timeAgo } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/sequences/[id]">) {
  return { title: `Sequence #${(await params).id}` };
}

const STATE: Record<string, [string, string]> = {
  waiting: ["Waiting for your OK", "text-warning"],
  active: ["Running", "text-accent-soft"],
  replied: ["Replied", "text-success"],
  stopped: ["Stopped", "text-muted"],
  done: ["Finished", "text-muted"]
};

export default async function SequencePage({ params }: PageProps<"/sequences/[id]">) {
  const user = await requireAccess("campaigns");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const S = schema.sequences;
  const [seq] = await db
    .select()
    .from(S)
    .where(and(eq(S.id, id), eq(S.workspaceId, user.workspaceId)))
    .limit(1);
  if (!seq) notFound();

  const ST = schema.sequenceSteps;
  const E = schema.enrollments;
  const LL = schema.leadLists;
  const TT = schema.messageTemplates;
  const [steps, senders, templates, lists, enrolled] = await Promise.all([
    db.select().from(ST).where(eq(ST.sequenceId, id)).orderBy(asc(ST.position)),
    db
      .select({ id: schema.emailSenders.id, name: schema.emailSenders.fromName, email: schema.emailSenders.fromEmail })
      .from(schema.emailSenders)
      .where(eq(schema.emailSenders.workspaceId, user.workspaceId)),
    db.select({ id: TT.id, channel: TT.channel, name: TT.name, subject: TT.subject, body: TT.body }).from(TT).where(eq(TT.workspaceId, user.workspaceId)),
    db
      .select({ id: LL.id, name: LL.name, n: sql<number>`(select count(*)::int from lead_list_items li where li.list_id = ${LL.id})` })
      .from(LL)
      .where(eq(LL.workspaceId, user.workspaceId))
      .orderBy(desc(LL.updatedAt))
      .limit(100),
    db
      .select({ e: E, name: schema.leads.pageName })
      .from(E)
      .innerJoin(schema.leads, eq(schema.leads.id, E.leadId))
      .where(eq(E.sequenceId, id))
      .orderBy(sql`case ${E.state} when 'waiting' then 0 when 'active' then 1 when 'replied' then 2 else 3 end`, asc(E.nextDueAt), desc(E.id))
      .limit(500)
  ]);
  const waiting = enrolled.filter((r) => r.e.state === "waiting").length;
  const counts = enrolled.reduce<Record<string, number>>((m, r) => ({ ...m, [r.e.state]: (m[r.e.state] ?? 0) + 1 }), {});

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href="/sequences" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Sequences
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{seq.name}</h1>
        <SequenceStatus status={seq.status} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <SequenceBuilder
          key={steps.map((s) => s.id).join(",")}
          id={seq.id}
          status={seq.status}
          initial={{
            name: seq.name,
            destinationUrl: seq.destinationUrl ?? "",
            emailSenderId: seq.emailSenderId,
            steps: steps.map((s) => ({ id: s.id, day: s.day, channel: s.channel as "sms", mode: s.mode as "auto", subject: s.subject, body: s.body }))
          }}
          senders={senders.map((s) => ({ id: s.id, label: `${s.name} <${s.email}>` }))}
          templates={templates}
        />

        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-medium">Leads in this sequence</h2>
            <div className="grid grid-cols-4 gap-1 text-center text-[11px] text-muted">
              {(["active", "waiting", "replied", "done"] as const).map((k) => (
                <div key={k} className="rounded-lg bg-ink-alt py-1.5">
                  <div className={cn("text-base font-semibold", counts[k] ? STATE[k][1] : "text-muted-2")}>{nf.format(counts[k] ?? 0)}</div>
                  {k === "done" ? "finished" : k === "active" ? "running" : k}
                </div>
              ))}
            </div>
            {waiting > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
                <span>{waiting} added by AI, waiting for your OK.</span>
                <ApproveWaiting sequenceId={seq.id} n={waiting} />
              </div>
            )}
            <div className="space-y-1.5">
              <div className="text-xs text-muted">Add a saved list</div>
              <EnrollList sequenceId={seq.id} lists={lists} />
              <p className="text-[11px] text-muted-2">
                Or on <Link href="/leads" className="underline">Leads</Link>, select leads → Sequence. Won, lost and skipped leads are never added.
              </p>
            </div>
            {seq.status !== "active" && <p className="rounded-lg bg-ink-alt px-3 py-2 text-xs text-muted">Nothing is sent until you turn the sequence on.</p>}
          </Card>

          <Card className="divide-y divide-line">
            {enrolled.length === 0 && <p className="p-4 text-sm text-muted-2">No one yet.</p>}
            {enrolled.map(({ e, name }) => {
              const step = steps[e.currentStep];
              const [label, tone] = STATE[e.state] ?? [e.state, "text-muted"];
              return (
                <div key={e.id} className="flex items-start gap-2 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link href={`/leads/${e.leadId}`} className="block truncate font-medium hover:text-accent-soft">
                      {name ?? `Lead #${e.leadId}`}
                    </Link>
                    <div className="text-[11px] text-muted-2">
                      <span className={tone}>{label}</span>
                      {e.state === "active" && step && (
                        <>
                          {" "}
                          · next: step {e.currentStep + 1} {CHANNEL_LABEL[step.channel]}
                          {e.nextDueAt && e.nextDueAt > new Date() ? ` on ${e.nextDueAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : " now"}
                        </>
                      )}
                      {e.state !== "active" && e.endedAt && ` · ${timeAgo(e.endedAt)}`}
                      {e.note && ` · ${e.note}`}
                    </div>
                  </div>
                  {(e.state === "active" || e.state === "waiting") && <StopButton sequenceId={seq.id} enrollmentId={e.id} />}
                </div>
              );
            })}
          </Card>
        </div>
      </div>
    </div>
  );
}
