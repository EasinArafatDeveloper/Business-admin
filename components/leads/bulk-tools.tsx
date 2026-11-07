"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bookmark, Check, Hash, Loader2, Workflow, X } from "lucide-react";
import { addLeadsToList, setLeadsTags } from "@/app/actions/leads";
import { enrollInSequence } from "@/app/actions/sequences";
import { cn } from "@/lib/utils";

const field = "h-8 rounded-lg border border-line-strong bg-ink-alt px-2 text-xs text-fg outline-none focus:border-accent";

/** "Add to list", "Tag" and "Sequence" for the selected leads. The selection stays, so you can tag and then add to a list. */
export function BulkTools({
  ids,
  lists,
  sequences = []
}: {
  ids: number[];
  lists: { id: number; name: string }[];
  /** Empty when you can't use sequences. */
  sequences?: { id: number; name: string; status: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"list" | "tag" | "seq" | null>(null);
  const [seqId, setSeqId] = useState(sequences[0]?.id ?? 0);
  const [listId, setListId] = useState<string>(lists[0] ? String(lists[0].id) : "new");
  const [newName, setNewName] = useState("");
  const [tags, setTags] = useState("");
  const [msg, setMsg] = useState<{ text: string; href?: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();

  const toList = () =>
    start(async () => {
      const r = await addLeadsToList(ids, listId === "new" ? null : Number(listId), newName);
      if ("error" in r && r.error) return setMsg({ text: r.error, error: true });
      if (!("listId" in r)) return;
      setMsg({ text: `Added ${r.added}${r.already ? ` (${r.already} were already there)` : ""}`, href: `/leads/lists/${r.listId}` });
      setOpen(null);
      setNewName("");
      router.refresh();
    });

  const tag = (remove: boolean) =>
    start(async () => {
      const list = tags.split(/[,\n]/);
      const r = await setLeadsTags(ids, remove ? [] : list, remove ? list : []);
      setMsg({ text: `${remove ? "Removed tag from" : "Tagged"} ${r.updated} leads` });
      setOpen(null);
      setTags("");
      router.refresh();
    });

  const enroll = () =>
    start(async () => {
      const r = await enrollInSequence(seqId, ids);
      if ("error" in r && r.error) return setMsg({ text: r.error, error: true });
      if (!("enrolled" in r)) return;
      setMsg({ text: `Added ${r.enrolled} to the sequence${r.skipped ? ` · ${r.skipped} skipped (already in it, or won/lost)` : ""}`, href: `/sequences/${seqId}` });
      setOpen(null);
    });

  return (
    <>
      <span className="mx-1 h-5 w-px bg-line-strong" />
      <button
        type="button"
        onClick={() => setOpen(open === "list" ? null : "list")}
        className={cn("inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs", open === "list" ? "border-accent bg-accent/15" : "border-line-strong hover:border-accent/60")}
      >
        <Bookmark className="h-3.5 w-3.5" /> Add to list
      </button>
      <button
        type="button"
        onClick={() => setOpen(open === "tag" ? null : "tag")}
        className={cn("inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs", open === "tag" ? "border-accent bg-accent/15" : "border-line-strong hover:border-accent/60")}
      >
        <Hash className="h-3.5 w-3.5" /> Tag
      </button>
      {sequences.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(open === "seq" ? null : "seq")}
          className={cn("inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs", open === "seq" ? "border-accent bg-accent/15" : "border-line-strong hover:border-accent/60")}
        >
          <Workflow className="h-3.5 w-3.5" /> Sequence
        </button>
      )}
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted" />}

      {open === "list" && (
        <div className="flex w-full flex-wrap items-center gap-2 pt-1">
          <select aria-label="List" value={listId} onChange={(e) => setListId(e.target.value)} className={cn(field, "max-w-[240px]")}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
            <option value="new">+ New list…</option>
          </select>
          {listId === "new" && (
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="List name, e.g. First 30 – Batch 1" className={cn(field, "w-64")} />
          )}
          <button type="button" disabled={pending} onClick={toList} className="inline-flex h-8 items-center gap-1 rounded-lg bg-accent px-3 text-xs font-medium text-white disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> Add {ids.length}
          </button>
        </div>
      )}

      {open === "seq" && (
        <div className="flex w-full flex-wrap items-center gap-2 pt-1">
          <select aria-label="Sequence" value={seqId} onChange={(e) => setSeqId(Number(e.target.value))} className={cn(field, "max-w-[260px]")}>
            {sequences.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.status === "active" ? "" : ` (${s.status === "draft" ? "not on yet" : "paused"})`}
              </option>
            ))}
          </select>
          <button type="button" disabled={pending} onClick={enroll} className="inline-flex h-8 items-center gap-1 rounded-lg bg-accent px-3 text-xs font-medium text-white disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> Add {ids.length}
          </button>
        </div>
      )}

      {open === "tag" && (
        <div className="flex w-full flex-wrap items-center gap-2 pt-1">
          <input
            autoFocus
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tags.trim() && tag(false)}
            placeholder="hot, clinic, batch-1"
            className={cn(field, "w-64")}
          />
          <button
            type="button"
            disabled={pending || !tags.trim()}
            onClick={() => tag(false)}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-accent px-3 text-xs font-medium text-white disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Add tag
          </button>
          <button
            type="button"
            disabled={pending || !tags.trim()}
            onClick={() => tag(true)}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong px-3 text-xs disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> Remove tag
          </button>
        </div>
      )}

      {msg && (
        <span className={cn("w-full text-xs", msg.error ? "text-danger" : "text-success")}>
          {msg.text}
          {msg.href && (
            <Link href={msg.href} className="ml-1 underline">
              Open
            </Link>
          )}
        </span>
      )}
    </>
  );
}
