import Link from "next/link";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { Plus, Workflow } from "lucide-react";
import { db, schema } from "@/db";
import { requireAccess } from "@/lib/auth";
import { CHANNEL_LABEL, enrollmentCounts } from "@/lib/sequences";
import { createSequence } from "@/app/actions/sequences";
import { Button, Card, inputClass } from "@/components/ui";
import { SequenceStatus } from "@/components/sequences/sequence-status";
import { nf } from "@/lib/utils";

export const metadata = { title: "Sequences" };

export default async function SequencesPage() {
  const user = await requireAccess("campaigns");
  const S = schema.sequences;
  const ST = schema.sequenceSteps;
  const seqs = await db.select().from(S).where(eq(S.workspaceId, user.workspaceId)).orderBy(desc(S.updatedAt));
  const steps = seqs.length
    ? await db
        .select({ sequenceId: ST.sequenceId, day: ST.day, channel: ST.channel, mode: ST.mode })
        .from(ST)
        .where(
          inArray(
            ST.sequenceId,
            seqs.map((s) => s.id)
          )
        )
        .orderBy(asc(ST.position))
    : [];
  const counts = await enrollmentCounts(user.workspaceId);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sequences</h1>
          <p className="mt-1 text-sm text-muted">Follow-up plans: e.g. Day 1 email → Day 2 SMS → Day 4 WhatsApp. Anyone who replies is taken out automatically.</p>
        </div>
        <form action={createSequence} className="flex gap-2">
          <input name="name" placeholder="Name, e.g. Clinics — free audit" className={`${inputClass} h-9 w-60`} />
          <Button size="md" className="h-9">
            <Plus className="h-4 w-4" /> New sequence
          </Button>
        </form>
      </div>

      {seqs.length === 0 && (
        <Card className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted">
          <Workflow className="h-8 w-8 text-accent" />
          No sequences yet. Make one, add leads from the Leads page or a saved list, and it runs every day by itself.
        </Card>
      )}

      <div className="space-y-3">
        {seqs.map((s) => {
          const c = counts.get(s.id) ?? {};
          const mine = steps.filter((x) => x.sequenceId === s.id);
          return (
            <Link key={s.id} href={`/sequences/${s.id}`} className="block">
              <Card className="flex flex-wrap items-center gap-4 p-4 hover:border-line-strong">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{s.name}</span>
                    <SequenceStatus status={s.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted">
                    {mine.map((x, i) => (
                      <span key={i} className="rounded-full border border-line px-2 py-0.5">
                        Day {x.day} · {CHANNEL_LABEL[x.channel]}
                        {x.mode === "manual" && x.channel !== "call" ? " (by hand)" : ""}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-5 text-center text-xs text-muted">
                  <Stat n={c.active ?? 0} label="running" />
                  <Stat n={c.waiting ?? 0} label="waiting" />
                  <Stat n={c.replied ?? 0} label="replied" tone="text-success" />
                  <Stat n={c.done ?? 0} label="finished" />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <div>
      <div className={`text-base font-semibold ${n ? (tone ?? "text-fg") : "text-muted-2"}`}>{nf.format(n)}</div>
      {label}
    </div>
  );
}
