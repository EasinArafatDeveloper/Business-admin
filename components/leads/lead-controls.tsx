"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/constants";
import { addLeadNote, setLeadStatus, setLeadsTags, setSmsOptOut } from "@/app/actions/leads";
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

const LOG_TYPES = [
  { value: "note", label: "Note" },
  { value: "wa_sent", label: "WhatsApp sent (from my phone)" },
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "sms_sent", label: "SMS sent" },
  { value: "email_sent", label: "Email sent" },
  { value: "wa_reply", label: "They replied on WhatsApp" },
  { value: "email_reply", label: "They replied by email" },
  { value: "sms_reply", label: "They replied by SMS" }
];

export function NoteForm({ leadId }: { leadId: number }) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState("note");
  return (
    <form
      ref={ref}
      action={(fd) =>
        startTransition(async () => {
          await addLeadNote(leadId, fd);
          ref.current?.reset();
          setType("note");
        })
      }
      className="space-y-2"
    >
      <select
        name="type"
        aria-label="What happened"
        value={type}
        onChange={(e) => setType(e.target.value)}
        className="h-9 rounded-xl border border-line-strong bg-ink-alt px-2.5 text-sm outline-none focus:border-accent"
      >
        {LOG_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <textarea
        name="body"
        required={type === "note"}
        rows={3}
        placeholder={type === "note" ? "Add a note — call summary, what they said, next step…" : "What was said (optional)"}
        className="w-full rounded-xl border border-line-strong bg-ink-alt p-3 text-sm outline-none focus:border-accent"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : type === "note" ? "Add note" : "Log it"}
      </Button>
    </form>
  );
}

export function SmsOptOutToggle({ leadId, optOut, channel = "sms" }: { leadId: number; optOut: boolean; channel?: "sms" | "whatsapp" | "email" }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => setSmsOptOut(leadId, !optOut, channel))}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50",
        optOut ? "border-danger/40 bg-danger/10 text-danger" : "border-line-strong text-muted hover:text-fg"
      )}
    >
      {`Don't ${channel === "whatsapp" ? "WhatsApp" : channel === "email" ? "email" : "SMS"}${optOut ? " — on" : ""}`}
    </button>
  );
}

/** The lead's tags: click × to remove, type to add. */
export function TagEditor({ leadId, tags }: { leadId: number; tags: string[] }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState("");
  const save = (add: string[], remove: string[] = []) => startTransition(async () => void (await setLeadsTags([leadId], add, remove)));
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", pending && "opacity-60")}>
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent-soft">
          <a href={`/leads?label=${encodeURIComponent(t)}`} className="hover:underline">
            #{t}
          </a>
          <button type="button" aria-label={`Remove tag ${t}`} onClick={() => save([], [t])} className="text-muted hover:text-danger">
            ×
          </button>
        </span>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          save(value.split(","));
          setValue("");
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="+ tag"
          aria-label="Add tag"
          className="h-6 w-24 rounded-full border border-dashed border-line-strong bg-transparent px-2 text-xs outline-none focus:w-36 focus:border-accent"
        />
      </form>
    </div>
  );
}
