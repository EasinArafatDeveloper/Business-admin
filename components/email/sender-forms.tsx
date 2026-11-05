"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import { addSender, removeSender, testSender } from "@/app/actions/email";
import { Button, Card, Label, inputClass } from "@/components/ui";

type Preset = { key: string; label: string; host: string; port: number; limit: number; hint: string };

export function AddSenderForm({ presets, suggestedFrom, startOpen }: { presets: Preset[]; suggestedFrom?: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(startOpen));
  const [preset, setPreset] = useState(presets[0].key);
  const [state, action, pending] = useActionState(addSender, undefined);
  const p = presets.find((x) => x.key === preset) ?? presets[0];
  const gmail = preset === "gmail";

  if (!open)
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Add a sender
      </Button>
    );

  return (
    <Card className="p-5">
      <form action={action} className="space-y-4" key={state?.ok}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Add a sender</h3>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-fg">
            Close
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <Label>Provider</Label>
            <select name="preset" value={preset} onChange={(e) => setPreset(e.target.value)} className={inputClass}>
              {presets.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <Label hint="what people see">From name</Label>
            <input name="fromName" required placeholder="Easin from ScaleUp Web" className={inputClass} />
          </label>
          <label className="block">
            <Label hint="your domain address">From address</Label>
            <input name="fromEmail" type="email" required defaultValue={suggestedFrom} placeholder="hello@yourdomain.com" className={inputClass} />
          </label>
          <label className="block">
            <Label hint={gmail ? "the Gmail you log in with" : "usually the same address"}>Login (username)</Label>
            <input name="smtpUser" placeholder={gmail ? "you@gmail.com" : "leave empty = from address"} className={inputClass} />
          </label>
          <label className="block">
            <Label hint="stored encrypted">{gmail ? "App Password" : "Password / SMTP key"}</Label>
            <input
              name="smtpPass"
              type="password"
              required
              autoComplete="new-password"
              placeholder={gmail ? "16 letters, spaces are fine" : ""}
              className={inputClass}
            />
          </label>
          <label className="block">
            <Label hint="across all campaigns">Max emails per day</Label>
            <input name="dailyLimit" type="number" min={10} max={2000} defaultValue={p.limit} key={p.key} className={inputClass} />
          </label>
          {preset === "custom" && (
            <>
              <label className="block">
                <Label>SMTP server</Label>
                <input name="smtpHost" placeholder="smtp.example.com" className={inputClass} />
              </label>
              <label className="block">
                <Label hint="465 = SSL, 587 = STARTTLS">Port</Label>
                <input name="smtpPort" type="number" defaultValue={465} className={inputClass} />
              </label>
            </>
          )}
          <label className="block sm:col-span-2">
            <Label hint="optional — where replies go">Reply-to</Label>
            <input name="replyTo" type="email" placeholder="same as from address" className={inputClass} />
          </label>
        </div>
        <p className="text-xs text-muted-2">{p.hint}</p>
        {gmail && (
          <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
            Gmail only keeps your domain address as the sender if it&apos;s added in Gmail → Settings → Accounts → <b>Send mail as</b>. Without it, emails show
            your @gmail.com address.
          </p>
        )}
        {state?.error && <p className="text-sm text-danger">{state.error}</p>}
        {state?.ok && <p className="text-sm text-success">{state.ok}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "Checking login…" : "Connect sender"}
        </Button>
      </form>
    </Card>
  );
}

export function TestSenderForm({ id, defaultTo }: { id: number; defaultTo?: string }) {
  const [state, action, pending] = useActionState(testSender.bind(null, id), undefined);
  return (
    <form action={action} className="space-y-1.5">
      <div className="flex gap-2">
        <input name="to" type="email" required defaultValue={defaultTo} placeholder="send a test to…" className={inputClass + " h-9"} />
        <Button type="submit" size="sm" variant="secondary" disabled={pending} className="h-9 shrink-0">
          <Send className="h-3.5 w-3.5" /> {pending ? "Sending…" : "Test"}
        </Button>
      </div>
      {state?.error && <p className="text-xs text-danger">{state.error}</p>}
      {state?.ok && <p className="text-xs text-success">{state.ok}</p>}
    </form>
  );
}

export function RemoveSenderButton({ id, email }: { id: number; email: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => confirm(`Remove ${email}? Campaigns using it will pause.`) && start(() => removeSender(id))}
      className="rounded-lg p-1.5 text-muted-2 hover:bg-danger/10 hover:text-danger"
      aria-label={`Remove ${email}`}
      title="Remove sender"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
