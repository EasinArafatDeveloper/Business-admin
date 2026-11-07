"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, UserPlus } from "lucide-react";
import { approveWaitingLeads, enrollList, stopEnrollment } from "@/app/actions/sequences";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/** "Add a saved list" to the sequence. */
export function EnrollList({ sequenceId, lists }: { sequenceId: number; lists: { id: number; name: string; n: number }[] }) {
  const router = useRouter();
  const [listId, setListId] = useState(lists[0]?.id ?? 0);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();
  if (!lists.length) return <p className="text-xs text-muted">Make a saved list first (Leads → select → Add to list), or add leads from the Leads page.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Saved list"
        value={listId}
        onChange={(e) => setListId(Number(e.target.value))}
        className="h-9 max-w-[260px] rounded-xl border border-line-strong bg-ink-alt px-2.5 text-sm outline-none focus:border-accent"
      >
        {lists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} ({l.n})
          </option>
        ))}
      </select>
      <Button
        size="sm"
        className="h-9"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await enrollList(sequenceId, listId);
            if ("error" in r && r.error) setMsg({ text: r.error, error: true });
            else if ("enrolled" in r) setMsg({ text: `Added ${r.enrolled}${r.skipped ? ` · ${r.skipped} skipped (already in it, or won/lost)` : ""}` });
            router.refresh();
          })
        }
      >
        <UserPlus className="h-4 w-4" /> Add list
      </Button>
      {msg && <span className={cn("text-xs", msg.error ? "text-danger" : "text-success")}>{msg.text}</span>}
    </div>
  );
}

export function ApproveWaiting({ sequenceId, n }: { sequenceId: number; n: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await approveWaitingLeads(sequenceId);
          router.refresh();
        })
      }
    >
      <Check className="h-4 w-4" /> Start {n}
    </Button>
  );
}

export function StopButton({ sequenceId, enrollmentId }: { sequenceId: number; enrollmentId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await stopEnrollment(sequenceId, [enrollmentId]);
          router.refresh();
        })
      }
      className="text-xs text-muted hover:text-danger disabled:opacity-50"
    >
      Stop
    </button>
  );
}
