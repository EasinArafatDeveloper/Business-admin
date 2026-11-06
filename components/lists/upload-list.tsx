"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Loader2, Mail, MessageCircle, Phone, Upload } from "lucide-react";
import { normalizeBdMobile, sampleLink, smsParts } from "@/lib/sms-text";
import { prettyBd } from "@/lib/paste-audience";
import { offerGroup } from "@/lib/offer";
import { cn, nf } from "@/lib/utils";
import { Button, Card, Label, inputClass } from "@/components/ui";

const FIELDS = {
  name: "Business / name",
  phone: "Mobile / WhatsApp",
  email: "Email",
  message: "Their SMS / WhatsApp message",
  subject: "Their email subject",
  emailBody: "Their email body",
  reason: "Why this lead (note)",
  offer: "What you'll offer",
  industry: "Industry",
  address: "Address",
  page: "Facebook page"
} as const;
type Field = keyof typeof FIELDS;
type Preview = { sheetName: string; headers: string[]; total: number; mapping: Partial<Record<Field, number>>; rows: string[][] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** Upload an Excel/CSV → check columns → see exactly what each person gets → save as a list. */
export function UploadList({
  rate,
  linkBase,
  then,
  channel,
  intoList
}: {
  rate: number;
  linkBase: string;
  then?: "campaign";
  channel?: string;
  /** Update this existing list from the file instead of creating a new one. */
  intoList?: { id: number; name: string };
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<Field, number>>>({});
  const [listName, setListName] = useState("");
  const [busy, setBusy] = useState<"" | "reading" | "importing">("");
  const [error, setError] = useState("");

  async function read(f: File) {
    setFile(f);
    setError("");
    setBusy("reading");
    const fd = new FormData();
    fd.set("file", f);
    fd.set("step", "preview");
    const r = await fetch("/api/lists/upload", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok) return setError(j.error ?? "Couldn't read the file");
    setPreview(j);
    setMapping(j.mapping);
    setListName(f.name.replace(/\.(xlsx|csv)$/i, ""));
  }

  async function doImport() {
    if (!file) return;
    setBusy("importing");
    setError("");
    const fd = new FormData();
    fd.set("file", file);
    fd.set("step", "import");
    fd.set("mapping", JSON.stringify(mapping));
    fd.set("listName", listName);
    if (intoList) fd.set("listId", String(intoList.id));
    const r = await fetch("/api/lists/upload", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setBusy("");
      return setError(j.error ?? "Import failed");
    }
    router.push(
      then === "campaign"
        ? `/campaigns/new?list=${j.listId}${channel && channel !== "sms" ? `&channel=${channel}` : ""}`
        : intoList
          ? `/leads/lists/${j.listId}?updated=${j.updated ?? 0}&added=${j.added}`
          : `/leads/lists/${j.listId}?added=${j.added}`
    );
  }

  const link = sampleLink(linkBase);
  const people = useMemo(() => {
    if (!preview) return [];
    const get = (r: string[], k: Field) => (mapping[k] === undefined ? "" : (r[mapping[k]!] ?? "").trim());
    return preview.rows.map((r) => {
      const phone = normalizeBdMobile(get(r, "phone"));
      const email = EMAIL_RE.test(get(r, "email")) ? get(r, "email").toLowerCase() : null;
      const message = get(r, "message");
      // As sent: the tracking link is added at the end when the message doesn't have {link}.
      const sms = message ? smsParts(/\{link\}/i.test(message) ? message.replace(/\{link\}/gi, link) : `${message} ${link}`) : null;
      return {
        name: get(r, "name"),
        phone,
        email,
        message,
        reason: get(r, "reason"),
        sms,
        subject: get(r, "subject"),
        emailBody: get(r, "emailBody"),
        offer: get(r, "offer")
      };
    });
  }, [preview, mapping, link]);
  const usable = people.filter((p) => p.phone || p.email);
  const withMsg = usable.filter((p) => p.message);
  const parts = withMsg.reduce((a, p) => a + (p.phone ? (p.sms?.parts ?? 0) : 0), 0);

  if (!preview)
    return (
      <Card className="p-8">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) read(f);
          }}
          className="flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-line-strong p-10 text-center hover:border-accent/60"
        >
          {busy ? <Loader2 className="h-9 w-9 animate-spin text-accent" /> : <Upload className="h-9 w-9 text-accent" />}
          <span className="font-medium">{busy ? "Reading the file…" : "Drop your Excel / CSV here, or tap to choose"}</span>
          <span className="max-w-md text-sm text-muted">
            One row per person: their mobile or email, and (optional) their own message. Business name, notes and anything else are kept too.
          </span>
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        {error && <p className="mt-3 text-center text-sm text-danger">{error}</p>}
      </Card>
    );

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <Card className="space-y-4 p-5">
          <div className="flex items-center gap-2 text-sm">
            <FileSpreadsheet className="h-4 w-4 text-success" />
            <b>{file?.name}</b>
            <span className="text-muted">
              · sheet “{preview.sheetName}” · {nf.format(preview.total)} rows
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(Object.keys(FIELDS) as Field[]).map((k) => (
              <label key={k} className="block">
                <Label>{FIELDS[k]}</Label>
                <select
                  value={mapping[k] ?? ""}
                  onChange={(e) => setMapping((m) => ({ ...m, [k]: e.target.value === "" ? undefined : Number(e.target.value) }))}
                  className={cn(inputClass, "h-9", mapping[k] !== undefined && "border-accent/50")}
                >
                  <option value="">— not in this file —</option>
                  {preview.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </Card>

        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">What each person gets</h2>
          <span className="text-xs text-muted-2">
            {preview.total > preview.rows.length ? `showing first ${preview.rows.length} of ${nf.format(preview.total)}` : `${nf.format(people.length)} rows`}
          </span>
        </div>
        <div className="space-y-2">
          {people.map((p, i) => (
            <Card key={i} className={cn("p-4", !p.phone && !p.email && "opacity-50")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">
                    <span className="mr-1.5 text-xs text-muted-2">{i + 1}.</span>
                    {p.name || "No name"}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                    {p.phone ? (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {prettyBd(p.phone)}
                      </span>
                    ) : (
                      <span className="text-warning">no valid mobile</span>
                    )}
                    {p.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" /> {p.email}
                      </span>
                    )}
                  </div>
                </div>
                {p.sms && p.phone && (
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px]", p.sms.parts > 2 ? "bg-warning/15 text-warning" : "bg-surface-2 text-muted")}>
                    SMS: {p.sms.parts} part{p.sms.parts > 1 ? "s" : ""} · ৳{(p.sms.parts * rate).toFixed(2)}
                    {p.sms.unicode && " · Bangla/symbol"}
                  </span>
                )}
              </div>
              {p.offer && (
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="rounded-full bg-violet/15 px-2 py-0.5 text-[11px] font-medium text-violet">{offerGroup(p.offer)}</span>
                  <span className="truncate text-[11px] text-muted-2">{p.offer}</span>
                </div>
              )}
              {p.reason && <p className="mt-2 text-xs text-muted-2">{p.reason}</p>}
              {p.message ? (
                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-ink-alt p-3 text-sm leading-relaxed">
                  {p.message}
                  {!/\{link\}/i.test(p.message) && <span className="text-accent-soft"> {link}</span>}
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-2">No SMS/WhatsApp message in the file — gets the message you write in the campaign.</p>
              )}
              {p.email && (p.subject || p.emailBody) && (
                <details className="mt-2 rounded-xl border border-line">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-muted">
                    <Mail className="mr-1 inline h-3 w-3" /> Email: <b className="text-fg">{p.subject || "(campaign subject)"}</b>
                  </summary>
                  <p className="whitespace-pre-wrap border-t border-line px-3 py-2.5 text-sm leading-relaxed">{p.emailBody || p.message}</p>
                </details>
              )}
            </Card>
          ))}
        </div>
      </div>

      <div className="space-y-3 lg:sticky lg:top-6 lg:h-fit">
        <Card className="space-y-3 p-5 text-sm">
          {intoList ? (
            <div className="rounded-xl bg-accent/10 px-3 py-2 text-xs">
              Updating <b>{intoList.name}</b>: people already in it get the offer, group and messages from this file; new people are added.
            </div>
          ) : (
            <label className="block">
              <Label>List name</Label>
              <input value={listName} onChange={(e) => setListName(e.target.value)} className={inputClass} />
            </label>
          )}
          <Row k="People" v={nf.format(usable.length)} />
          <Row k="With their own SMS/WhatsApp text" v={nf.format(withMsg.length)} />
          <Row k="With their own email" v={nf.format(usable.filter((p) => p.email && p.emailBody).length)} />
          {usable.length < people.length && <Row k="Skipped (no mobile/email)" v={nf.format(people.length - usable.length)} warn />}
          <div className="border-t border-line pt-3">
            <Row k="If sent by SMS" v={`${nf.format(parts)} parts ≈ ৳${(parts * rate).toFixed(2)}`} />
            <p className="mt-1 text-[11px] text-muted-2">WhatsApp and email are free. Long or Bangla/“—” messages cost more by SMS.</p>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button onClick={doImport} disabled={busy !== "" || usable.length === 0} className="w-full">
            {busy === "importing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            {intoList ? `Update “${intoList.name}”` : then === "campaign" ? "Save list and write campaign" : `Save ${nf.format(usable.length)} as a list`}
          </Button>
          <button type="button" onClick={() => setPreview(null)} className="w-full text-xs text-muted hover:text-fg">
            Choose another file
          </button>
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{k}</span>
      <span className={cn("text-right font-medium", warn && "text-warning")}>{v}</span>
    </div>
  );
}
