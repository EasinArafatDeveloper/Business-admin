"use client";

import { useActionState, useState, useTransition } from "react";
import { BookmarkPlus, Trash2, X } from "lucide-react";
import { deleteList, removeItem, renameList, saveFilterToList, saveItemMessage } from "@/app/actions/lists";
import { cn, nf } from "@/lib/utils";
import { Button, Label, inputClass } from "@/components/ui";

const textareaClass = "w-full rounded-xl border border-line-strong bg-ink-alt p-3 text-sm outline-none focus:border-accent";

/** On the Leads page: save every lead matching the current filters into a new or existing list. */
export function SaveToList({ query, total, lists }: { query: string; total: number; lists: { id: number; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>("new");
  const [state, action, pending] = useActionState(saveFilterToList, undefined);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-sm hover:border-accent/60"
      >
        <BookmarkPlus className="h-4 w-4" /> Save to list
      </button>
      {open && (
        <form action={action} className="absolute right-0 top-11 z-20 w-80 space-y-3 rounded-2xl border border-line-strong bg-surface p-4 shadow-xl">
          <input type="hidden" name="query" value={query} />
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Save {nf.format(Math.min(total, 1000))} leads</span>
            <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-fg" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          {lists.length > 0 && (
            <select name="listId" value={target === "new" ? "" : target} onChange={(e) => setTarget(e.target.value || "new")} className={inputClass}>
              <option value="">New list…</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  Add to: {l.name}
                </option>
              ))}
            </select>
          )}
          {target === "new" && <input name="name" required placeholder="List name, e.g. Fashion — Hot, has WhatsApp" className={inputClass} />}
          {total > 1000 && <p className="text-xs text-warning">Only the top 1,000 by score are saved. Narrow the filters for a tighter list.</p>}
          {state?.error && <p className="text-xs text-danger">{state.error}</p>}
          <Button type="submit" size="sm" disabled={pending || total === 0} className="w-full">
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      )}
    </div>
  );
}

export function RenameList({ id, name, description }: { id: number; name: string; description: string | null }) {
  const [state, action, pending] = useActionState(renameList.bind(null, id), undefined);
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <Label>Name</Label>
        <input name="name" required defaultValue={name} className={inputClass} />
      </label>
      <label className="block">
        <Label hint="optional">What it&apos;s for</Label>
        <textarea name="description" rows={2} defaultValue={description ?? ""} className={textareaClass} />
      </label>
      {state?.error && <p className="text-xs text-danger">{state.error}</p>}
      {state?.ok && <p className="text-xs text-success">{state.ok}</p>}
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
    </form>
  );
}

export function DeleteList({ id, name }: { id: number; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="danger"
      disabled={pending}
      onClick={() => confirm(`Delete the list “${name}”? The leads themselves stay.`) && start(() => deleteList(id))}
    >
      <Trash2 className="h-3.5 w-3.5" /> Delete list
    </Button>
  );
}

/** One person's own message (shown in the list; campaigns from the list can send it). */
export function ItemMessage({
  id,
  message,
  subject,
  emailBody,
  ai
}: {
  id: number;
  message: string | null;
  subject: string | null;
  emailBody?: string | null;
  ai: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveItemMessage.bind(null, id), undefined);
  if (!open)
    return message || emailBody ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full space-y-2 rounded-xl bg-ink-alt p-2.5 text-left text-xs hover:ring-1 hover:ring-line-strong"
      >
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-2">
          Their own message {ai && <span className="rounded bg-accent/15 px-1 text-accent-soft">AI</span>} · tap to edit
        </span>
        {message && (
          <span className="block">
            <span className="text-[10px] font-semibold text-muted-2">SMS / WhatsApp</span>
            <span className="line-clamp-3 whitespace-pre-wrap text-muted">{message}</span>
          </span>
        )}
        {(subject || emailBody) && (
          <span className="block border-t border-line pt-2">
            <span className="text-[10px] font-semibold text-muted-2">Email</span>
            {subject && <span className="block font-medium text-fg">{subject}</span>}
            {emailBody && <span className="line-clamp-2 whitespace-pre-wrap text-muted">{emailBody}</span>}
          </span>
        )}
      </button>
    ) : (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-accent-soft hover:underline">
        + Write their own message
      </button>
    );
  return (
    <form action={action} className="space-y-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-2">SMS / WhatsApp</span>
      <textarea
        name="message"
        rows={4}
        defaultValue={message ?? ""}
        placeholder="Their own SMS/WhatsApp text. Use {link} for the tracking link (added at the end if left out)."
        className={textareaClass}
      />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-2">Email</span>
      <input name="subject" defaultValue={subject ?? ""} placeholder="Email subject (optional)" className={cn(inputClass, "h-8 text-xs")} />
      <textarea name="emailBody" rows={5} defaultValue={emailBody ?? ""} placeholder="Their own email body (optional)" className={textareaClass} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
        {state?.ok && <span className="text-xs text-success">{state.ok}</span>}
        {state?.error && <span className="text-xs text-danger">{state.error}</span>}
      </div>
    </form>
  );
}

export function RemoveItem({ id }: { id: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => removeItem(id))}
      className="rounded-lg p-1.5 text-muted-2 hover:bg-danger/10 hover:text-danger"
      aria-label="Remove from list"
      title="Remove from list"
    >
      <X className="h-4 w-4" />
    </button>
  );
}
