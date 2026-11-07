"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, Hand, Pause, Phone, Play, Plus, Trash2, Zap } from "lucide-react";
import { type SequenceInput, deleteSequence, saveSequence, setSequenceStatus } from "@/app/actions/sequences";
import { Button, Card, Label, inputClass } from "@/components/ui";
import { CHANNELS } from "@/components/campaigns/channel";
import { MessageEditor, type TemplateOption } from "@/components/messages/message-editor";
import { cn } from "@/lib/utils";

type Step = SequenceInput["steps"][number] & { key: string };

const CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "call", label: "Call" }
] as const;

export function SequenceBuilder({
  id,
  status,
  initial,
  senders,
  templates
}: {
  id: number;
  status: string;
  initial: Omit<SequenceInput, "steps"> & { steps: SequenceInput["steps"] };
  senders: { id: number; label: string }[];
  templates: TemplateOption[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [url, setUrl] = useState(initial.destinationUrl);
  const [senderId, setSenderId] = useState<number | null>(initial.emailSenderId);
  const [steps, setSteps] = useState<Step[]>(initial.steps.map((s, i) => ({ ...s, key: `s${s.id ?? i}` })));
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();

  const update = (key: string, patch: Partial<Step>) => {
    setSteps((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    setDirty(true);
  };
  const add = () => {
    const last = steps[steps.length - 1];
    setSteps((list) => [...list, { key: `n${Date.now()}`, day: (last?.day ?? 0) + 2, channel: "whatsapp", mode: "manual", subject: null, body: "" }]);
    setDirty(true);
  };

  const payload = (): SequenceInput => ({
    name,
    destinationUrl: url,
    emailSenderId: senderId,
    steps: steps.map((s) => ({ id: s.id, day: s.day, channel: s.channel, mode: s.mode, subject: s.subject, body: s.body }))
  });

  const save = () =>
    start(async () => {
      const r = await saveSequence(id, payload());
      setMsg(r.error ? { text: r.error, error: true } : { text: "Saved" });
      if (!r.error) {
        setDirty(false);
        router.refresh();
      }
    });
  const turn = (to: "active" | "paused") =>
    start(async () => {
      if (dirty) {
        const r = await saveSequence(id, payload());
        if (r.error) return setMsg({ text: r.error, error: true });
        setDirty(false);
      }
      const r = await setSequenceStatus(id, to);
      setMsg(
        r.error ? { text: r.error, error: true } : { text: to === "active" ? "Running — due steps go out within a minute (auto messages 9am–9pm)" : "Paused" }
      );
      router.refresh();
    });

  const sorted = [...steps].sort((a, b) => a.day - b.day);

  return (
    <div className="space-y-4">
      <Card className="grid gap-3 p-5 md:grid-cols-3">
        <label className="block">
          <Label>Name</Label>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            className={inputClass}
          />
        </label>
        <label className="block">
          <Label hint="tracked per person">Where {"{link}"} goes</Label>
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setDirty(true);
            }}
            placeholder="https://scaleupweb.xyz/free-audit"
            className={inputClass}
          />
        </label>
        <label className="block">
          <Label>Email sender</Label>
          <select
            value={senderId ?? ""}
            onChange={(e) => {
              setSenderId(e.target.value ? Number(e.target.value) : null);
              setDirty(true);
            }}
            className={inputClass}
          >
            <option value="">{senders.length ? "None" : "Connect one in Channels"}</option>
            {senders.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </Card>

      <ol className="relative space-y-3 border-l-2 border-dashed border-line pl-5">
        {sorted.map((s, i) => (
          <li key={s.key} className="relative">
            <span className="absolute -left-[33px] top-4 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-[11px] font-semibold">
              {i + 1}
            </span>
            <Card className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-sm">
                  Day
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={s.day}
                    onChange={(e) => update(s.key, { day: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })}
                    className="h-8 w-16 rounded-lg border border-line-strong bg-ink-alt px-2 text-sm outline-none focus:border-accent"
                  />
                </label>
                <div className="flex rounded-lg border border-line-strong p-0.5">
                  {CHANNEL_OPTIONS.map((c) => {
                    const Icon = c.value === "call" ? Phone : CHANNELS[c.value].icon;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => update(s.key, { channel: c.value, ...(c.value === "call" ? { mode: "manual" } : {}) })}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                          s.channel === c.value ? "bg-accent/15 text-fg" : "text-muted hover:text-fg"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {c.label}
                      </button>
                    );
                  })}
                </div>
                {s.channel !== "call" && (
                  <div className="flex rounded-lg border border-line-strong p-0.5">
                    <button
                      type="button"
                      onClick={() => update(s.key, { mode: "auto" })}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                        s.mode === "auto" ? "bg-accent/15 text-fg" : "text-muted hover:text-fg"
                      )}
                      title="The app sends it by itself"
                    >
                      <Zap className="h-3 w-3" /> Automatic
                    </button>
                    <button
                      type="button"
                      onClick={() => update(s.key, { mode: "manual" })}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                        s.mode === "manual" ? "bg-accent/15 text-fg" : "text-muted hover:text-fg"
                      )}
                      title="Shows on Today; you send it from your phone"
                    >
                      <Hand className="h-3 w-3" /> By hand (Today)
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  aria-label="Remove step"
                  onClick={() => {
                    setSteps((list) => list.filter((x) => x.key !== s.key));
                    setDirty(true);
                  }}
                  className="ml-auto text-muted hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {s.channel === "whatsapp" && s.mode === "auto" && (
                <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Automatic WhatsApp to people who never messaged you can get your number banned. For cold leads keep it “By hand”.
                </p>
              )}
              {s.channel === "email" && (
                <input
                  value={s.subject ?? ""}
                  onChange={(e) => update(s.key, { subject: e.target.value })}
                  placeholder="Subject, e.g. {name} — quick idea for more orders"
                  className={inputClass}
                />
              )}
              <MessageEditor
                value={s.body}
                onChange={(v) => update(s.key, { body: v })}
                channel={s.channel}
                rows={s.channel === "email" ? 7 : 3}
                templates={templates}
                onTemplate={(t) => t.subject && update(s.key, { subject: t.subject })}
                placeholder={s.channel === "call" ? "Call notes / what to say (optional)" : "Message…"}
              />
            </Card>
          </li>
        ))}
      </ol>
      <Button type="button" variant="secondary" onClick={add} disabled={steps.length >= 15}>
        <Plus className="h-4 w-4" /> Add step
      </Button>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
        <Button onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </Button>
        {status === "active" ? (
          <Button variant="secondary" onClick={() => turn("paused")} disabled={pending}>
            <Pause className="h-4 w-4" /> Pause
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => turn("active")} disabled={pending}>
            <Play className="h-4 w-4" /> {status === "draft" ? "Turn on" : "Resume"}
          </Button>
        )}
        {msg && <span className={cn("text-sm", msg.error ? "text-danger" : "text-success")}>{msg.text}</span>}
        <Button
          variant="ghost"
          className="ml-auto"
          disabled={pending}
          onClick={() => confirm("Delete this sequence? Everyone in it is stopped.") && start(() => deleteSequence(id))}
        >
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
      </div>
    </div>
  );
}
