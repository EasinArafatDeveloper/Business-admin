"use client";

import { useActionState, useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { type TemplateState, deleteTemplate, saveTemplate } from "@/app/actions/templates";
import { Button, Card, Label, inputClass } from "@/components/ui";
import { ChannelBadge } from "@/components/campaigns/channel";
import { MessageEditor, type TemplateOption } from "@/components/messages/message-editor";

const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" }
];

function Editor({ initial, onDone }: { initial?: TemplateOption; onDone: () => void }) {
  const [state, action, pending] = useActionState(async (prev: TemplateState, fd: FormData) => {
    const r = await saveTemplate(prev, fd);
    if (r?.ok) onDone();
    return r;
  }, undefined);
  const [channel, setChannel] = useState(initial?.channel ?? "whatsapp");
  const [body, setBody] = useState(initial?.body ?? "");
  return (
    <Card className="space-y-3 p-5">
      <form action={action} className="space-y-3">
        {initial && <input type="hidden" name="id" value={initial.id} />}
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <label>
            <Label>Channel</Label>
            <select name="channel" value={channel} onChange={(e) => setChannel(e.target.value)} className={inputClass}>
              {CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <Label>Name</Label>
            <input name="name" defaultValue={initial?.name} placeholder="e.g. Free audit offer — first message" className={inputClass} />
          </label>
        </div>
        {channel === "email" && (
          <label className="block">
            <Label>Subject</Label>
            <input name="subject" defaultValue={initial?.subject ?? ""} placeholder="e.g. {name} — quick idea for more orders" className={inputClass} />
          </label>
        )}
        <div>
          <Label hint="{link} becomes each person's tracked link">Message</Label>
          <MessageEditor name="body" value={body} onChange={setBody} channel={channel} rows={channel === "email" ? 9 : 5} />
        </div>
        {state?.error && <p className="text-sm text-danger">{state.error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : initial ? "Save changes" : "Save template"}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function TemplateLibrary({ templates }: { templates: TemplateOption[] }) {
  const [editing, setEditing] = useState<number | "new" | null>(templates.length ? null : "new");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      {editing === "new" ? (
        <Editor onDone={() => setEditing(null)} />
      ) : (
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> New template
        </Button>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((t) =>
          editing === t.id ? (
            <div key={t.id} className="md:col-span-2">
              <Editor initial={t} onDone={() => setEditing(null)} />
            </div>
          ) : (
            <Card key={t.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{t.name}</div>
                  {t.subject && <div className="truncate text-xs text-muted">Subject: {t.subject}</div>}
                </div>
                <ChannelBadge channel={t.channel} />
              </div>
              <p className="line-clamp-4 whitespace-pre-wrap text-sm text-muted">{t.body}</p>
              <div className="mt-auto flex gap-1 pt-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(t.id)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => confirm(`Delete “${t.name}”?`) && start(() => deleteTemplate(t.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </Card>
          )
        )}
      </div>
    </div>
  );
}
