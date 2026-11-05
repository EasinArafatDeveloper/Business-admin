"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/constants";
import { addLeadNote, setLeadStatus, setSmsOptOut } from "@/app/actions/leads";
import { Button, STATUS_STYLES } from "@/components/ui";
import { cn } from "@/lib/utils";

export function StatusPicker({ leadId, status }: { leadId: number; status: LeadStatus }) {
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(status);
  return (
    <div className={cn("flex flex-wrap gap-1.5", pending && "opacity-60")}>
      {LEAD_STATUSES.map((s) => (
        <button
          key={s}
          disabled={pending}
          onClick={() => {
            setCurrent(s);
            startTransition(() => setLeadStatus(leadId, s));
          }}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            current === s ? cn("border-transparent", STATUS_STYLES[s].className) : "border-line-strong text-muted hover:text-fg"
          )}
        >
          {STATUS_STYLES[s].label}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex items-center gap-1 rounded-lg border border-line-strong px-2 py-1 text-xs text-muted hover:text-fg"
    >
      {done ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : label}
    </button>
  );
}

export function NoteForm({ leadId }: { leadId: number }) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      ref={ref}
      action={(fd) =>
        startTransition(async () => {
          await addLeadNote(leadId, fd);
          ref.current?.reset();
        })
      }
      className="space-y-2"
    >
      <textarea
        name="body"
        required
        rows={3}
        placeholder="Add a note — call summary, what they said, next step…"
        className="w-full rounded-xl border border-line-strong bg-ink-alt p-3 text-sm outline-none focus:border-accent"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Add note"}
      </Button>
    </form>
  );
}

export function SmsOptOutToggle({ leadId, optOut }: { leadId: number; optOut: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => setSmsOptOut(leadId, !optOut))}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50",
        optOut ? "border-danger/40 bg-danger/10 text-danger" : "border-line-strong text-muted hover:text-fg"
      )}
    >
      {optOut ? "Don't SMS — on" : "Don't SMS"}
    </button>
  );
}
