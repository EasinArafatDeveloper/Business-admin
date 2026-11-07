"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Phone, SkipForward, Undo2, X } from "lucide-react";
import { approvePlan, savePlanCell } from "@/app/actions/plans";
import { Button, Card, inputClass } from "@/components/ui";
import { CHANNELS } from "@/components/campaigns/channel";
import { MessageEditor } from "@/components/messages/message-editor";
import { cn } from "@/lib/utils";

type Cell = { stepId: number; personal: boolean; subject: string | null; body: string; status: string; at: string; problem: string | null };
type Row = { lead: { id: number; name: string | null; status: string }; enrollment: { id: number; state: string; note: string | null }; cells: Cell[] };
type Step = { id: number; day: number; sendTime: string | null; channel: string; mode: string };

const STATUS: Record<string, [string, string]> = {
  draft: ["Draft", "bg-muted/15 text-muted"],
  approved: ["Approved", "bg-accent/15 text-accent-soft"],
  planned: ["Planned", "bg-accent/10 text-accent-soft"],
  queued: ["Sending", "bg-warning/15 text-warning"],
  task: ["On Today", "bg-warning/15 text-warning"],
  sent: ["Sent", "bg-success/15 text-success"],
  failed: ["Failed", "bg-danger/15 text-danger"],
  skipped: ["Skipped", "bg-muted/15 text-muted-2"],
  cancelled: ["Cancelled", "bg-muted/15 text-muted-2"]
};
const EDITABLE = ["draft", "approved", "planned", "skipped"];
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" });

export function PlanGrid({ sequenceId, status, steps, rows }: { sequenceId: number; status: string; steps: Step[]; rows: Row[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<{ leadId: number; stepId: number } | null>(null);
  const [draft, setDraft] = useState({ body: "", subject: "" });
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const waiting = rows.filter((r) => r.enrollment.state === "waiting").length;

  const selRow = sel && rows.find((r) => r.lead.id === sel.leadId);
  const selIdx = sel ? steps.findIndex((s) => s.id === sel.stepId) : -1;
  const selCell = selRow && selIdx >= 0 ? selRow.cells[selIdx] : null;
  const selStep = selIdx >= 0 ? steps[selIdx] : null;

  const open = (leadId: number, stepId: number, c: Cell) => {
    setSel({ leadId, stepId });
    setDraft({ body: c.body, subject: c.subject ?? "" });
    setMsg(null);
  };
  const save = (change: { body?: string; subject?: string | null; skip?: boolean }) =>
    start(async () => {
      if (!sel) return;
      const r = await savePlanCell(sequenceId, sel.leadId, sel.stepId, change);
      if ("error" in r && r.error) return setMsg({ text: r.error, error: true });
      setMsg({ text: change.skip ? "Skipped" : change.skip === false ? "Back in the plan" : "Saved" });
      router.refresh();
    });

  if (!rows.length) return <Card className="p-8 text-center text-sm text-muted">No leads in this plan yet. Add a saved list, or select leads on the Leads page → Sequence.</Card>;

  return (
    <div className="space-y-4">
      {(waiting > 0 || status !== "active") && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-warning/40 p-4">
          <div className="text-sm">
            <b>{waiting ? `${waiting} leads are waiting for your OK.` : "This plan is off."}</b>
            <span className="text-muted"> Check the messages below, then approve. Nothing is sent before that.</span>
          </div>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await approvePlan(sequenceId);
                setMsg(r.error ? { text: r.error, error: true } : { text: `Approved — ${r.started} started. Due messages go out within a minute.` });
                router.refresh();
              })
            }
          >
            <Check className="h-4 w-4" /> Approve &amp; start
          </Button>
        </Card>
      )}
      {msg && !sel && <p className={cn("text-sm", msg.error ? "text-danger" : "text-success")}>{msg.text}</p>}

      <Card className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted-2">
              <th className="sticky left-0 z-10 bg-surface px-3 py-2.5 font-medium">Lead</th>
              {steps.map((s) => {
                const ch = s.channel === "call" ? null : CHANNELS[s.channel as keyof typeof CHANNELS];
                const Icon = ch?.icon ?? Phone;
                return (
                  <th key={s.id} className="px-2 py-2.5 font-medium">
                    <div className="flex items-center gap-1 normal-case tracking-normal">
                      <Icon className={cn("h-3.5 w-3.5", ch?.text ?? "text-accent-soft")} />
                      <span className="text-fg">Day {s.day}</span>
                      {s.sendTime && <span>{s.sendTime}</span>}
                    </div>
                    <div className="normal-case tracking-normal">{s.mode === "auto" ? "automatic" : "by hand"}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.lead.id} className="border-b border-line align-top last:border-0">
                <td className="sticky left-0 z-10 max-w-[180px] bg-surface px-3 py-2">
                  <Link href={`/leads/${r.lead.id}`} className="block truncate font-medium hover:text-accent-soft">
                    {r.lead.name ?? `Lead #${r.lead.id}`}
                  </Link>
                  <div className="text-[11px] text-muted-2">
                    {r.enrollment.state === "waiting" ? "waiting for OK" : r.enrollment.state === "active" ? "running" : r.enrollment.state}
                  </div>
                </td>
                {r.cells.map((c) => {
                  const [label, cls] = STATUS[c.status] ?? [c.status, "bg-muted/15 text-muted"];
                  const active = sel?.leadId === r.lead.id && sel.stepId === c.stepId;
                  return (
                    <td key={c.stepId} className="px-1.5 py-1.5">
                      <button
                        type="button"
                        onClick={() => open(r.lead.id, c.stepId, c)}
                        className={cn(
                          "block w-full min-w-[150px] rounded-lg border p-2 text-left hover:border-accent/60",
                          active ? "border-accent bg-accent/5" : "border-line",
                          ["skipped", "cancelled"].includes(c.status) && "opacity-60"
                        )}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", cls)}>{label}</span>
                          <span className="text-[10px] text-muted-2">{fmt(c.at)}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted">
                          {c.personal && <span className="text-accent-soft">● </span>}
                          {c.body || <i>no message</i>}
                        </p>
                        {c.problem && <p className="mt-1 text-[10px] text-warning">{c.problem}</p>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-[11px] text-muted-2">
        <span className="text-accent-soft">●</span> = this person&apos;s own message. Others use the step&apos;s message with their data filled in. Anyone who replies has the
        rest cancelled automatically.
      </p>

      {selRow && selCell && selStep && (
        <Card className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium">
                {selRow.lead.name} · Day {selStep.day} {selStep.channel === "call" ? "call" : CHANNELS[selStep.channel as keyof typeof CHANNELS]?.label}
              </div>
              <div className="text-xs text-muted">
                {STATUS[selCell.status]?.[0]} · {fmt(selCell.at)}
                {selCell.problem && <span className="text-warning"> · {selCell.problem}</span>}
              </div>
            </div>
            <button type="button" aria-label="Close" onClick={() => setSel(null)} className="text-muted hover:text-fg">
              <X className="h-4 w-4" />
            </button>
          </div>
          {EDITABLE.includes(selCell.status) ? (
            <>
              {selStep.channel === "email" && (
                <input value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} placeholder="Subject" className={inputClass} />
              )}
              <MessageEditor value={draft.body} onChange={(v) => setDraft((d) => ({ ...d, body: v }))} channel={selStep.channel} rows={selStep.channel === "email" ? 8 : 4} />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={pending} onClick={() => save({ body: draft.body, subject: draft.subject || null })}>
                  <Check className="h-3.5 w-3.5" /> Save for {selRow.lead.name ?? "this lead"}
                </Button>
                {selCell.status === "skipped" ? (
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => save({ skip: false })}>
                    <Undo2 className="h-3.5 w-3.5" /> Put back
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => save({ skip: true })}>
                    <SkipForward className="h-3.5 w-3.5" /> Skip this one
                  </Button>
                )}
                {msg && <span className={cn("text-xs", msg.error ? "text-danger" : "text-success")}>{msg.text}</span>}
              </div>
            </>
          ) : (
            <>
              {selCell.subject && <div className="text-sm font-medium">{selCell.subject}</div>}
              <p className="whitespace-pre-wrap rounded-xl bg-ink-alt p-3 text-sm">{selCell.body || "—"}</p>
              <p className="text-xs text-muted">
                {selCell.status === "task" ? (
                  <>
                    It&apos;s on <Link href="/today" className="underline">Today</Link> — send it from there.
                  </>
                ) : (
                  "This one can't be changed any more."
                )}
              </p>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
