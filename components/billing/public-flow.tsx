"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Copy, Download, Gift, ImagePlus, Loader2, Pencil, Share2 } from "lucide-react";
import { taka } from "@/lib/money";
import { cn } from "@/lib/utils";

/* Fixed light look: this page is for clients, whatever theme the admin uses. */
const input =
  "h-11 w-full rounded-xl border border-[#d6dbe6] bg-white px-3 text-[15px] text-[#0f172a] outline-none placeholder:text-[#9ca3af] focus:border-[#3b6bff] focus:ring-2 focus:ring-[#3b6bff]/15";
const card = "rounded-2xl bg-white p-5 shadow-sm print:hidden";
const primary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#3b6bff] px-5 text-[15px] font-semibold text-white hover:bg-[#2f5cf0] disabled:opacity-50";

function StepTitle({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
          done ? "bg-[#12875f] text-white" : "bg-[#e8eeff] text-[#2a52d4]"
        )}
      >
        {done ? <Check className="h-4 w-4" /> : n}
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex justify-between text-sm font-medium text-[#374151]">
        {label}
        {hint && <span className="font-normal text-[#9ca3af]">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function CopyText({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#f3f5fa] px-2.5 text-xs font-medium text-[#374151] hover:bg-[#e8eeff]"
    >
      {done ? <Check className="h-3.5 w-3.5 text-[#12875f]" /> : <Copy className="h-3.5 w-3.5" />} {done ? "Copied" : (label ?? "Copy")}
    </button>
  );
}

/* ---------------------------------------------------------------- step 1: details */

type Details = { businessName: string; name: string; email: string; phone: string };

export function DetailsStep({ token, done, initial }: { token: string; done: boolean; initial: Details }) {
  const router = useRouter();
  const [open, setOpen] = useState(!done);
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open)
    return (
      <section className={card}>
        <div className="flex items-start justify-between gap-3">
          <StepTitle n={1} title="Your details" done />
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-sm text-[#2a52d4] hover:underline">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        </div>
        <p className="mt-2 pl-10 text-sm text-[#6b7280]">
          {v.businessName} · {v.name} · {v.email} · {v.phone}
        </p>
      </section>
    );

  return (
    <section className={card}>
      <StepTitle n={1} title="Your details" />
      <p className="mt-1 pl-10 text-sm text-[#6b7280]">Check these so your invoice and receipt are correct.</p>
      <form
        className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const r = await fetch(`/api/public/invoice/${token}/details`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(v)
          });
          setBusy(false);
          if (!r.ok) return setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save");
          setOpen(false);
          router.refresh();
        }}
      >
        <Field label="Business name">
          <input required className={input} value={v.businessName} onChange={(e) => setV({ ...v, businessName: e.target.value })} />
        </Field>
        <Field label="Your name">
          <input required className={input} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoComplete="name" />
        </Field>
        <Field label="Email" hint="your invoice is sent here">
          <input required type="email" className={input} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} autoComplete="email" />
        </Field>
        <Field label="Phone">
          <input required className={input} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} inputMode="tel" autoComplete="tel" />
        </Field>
        {error && <p className="text-sm text-[#d23645] sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className={primary}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save and continue
          </button>
        </div>
      </form>
    </section>
  );
}

/* ---------------------------------------------------------------- step 2: pay */

type Methods = { bkash: { number: string; type: string } | null; nagad: string | null; bank: string | null };

export function PayStep({
  token,
  due,
  enabled,
  defaultEmail,
  defaultPhone,
  pending,
  methods
}: {
  token: string;
  due: number;
  enabled: boolean;
  defaultEmail: string;
  defaultPhone: string;
  pending: { amount: number; reference: string } | null;
  methods: Methods;
}) {
  const router = useRouter();
  const available = (["bkash", "nagad", "bank"] as const).filter((m) => methods[m]);
  const [method, setMethod] = useState<(typeof available)[number] | undefined>(available[0]);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (pending || sent)
    return (
      <section className={card}>
        <StepTitle n={2} title="Payment" done />
        <div className="mt-3 flex items-start gap-3 rounded-xl bg-[#fff8e8] p-4 text-sm text-[#7a4f0e]">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#a86a12]" />
          <div>
            <div className="font-semibold">We got your payment details{pending?.amount ? ` (${taka(pending.amount)})` : ""}.</div>
            <div className="mt-0.5">
              {pending?.reference && <>TrxID {pending.reference}. </>}We&apos;re checking it now — this page and your email will show “Paid” once it&apos;s
              confirmed.
            </div>
          </div>
        </div>
      </section>
    );

  if (available.length === 0)
    return (
      <section className={card}>
        <StepTitle n={2} title="Payment" />
        <p className="mt-2 pl-10 text-sm text-[#6b7280]">Payment details are on the invoice below.</p>
      </section>
    );

  const bk = methods.bkash;
  return (
    <section className={cn(card, !enabled && "opacity-60")}>
      <StepTitle n={2} title={`Pay ${taka(due)}`} />
      {!enabled && <p className="mt-1 pl-10 text-sm text-[#a86a12]">Fill in your details above first.</p>}

      <fieldset disabled={!enabled} className="mt-4 space-y-4">
        {available.length > 1 && (
          <div className="flex gap-2">
            {available.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={cn(
                  "h-10 flex-1 rounded-xl border text-sm font-semibold",
                  method === m ? "border-[#e2136e] bg-[#fdf0f6] text-[#c40f5f]" : "border-[#d6dbe6] text-[#374151]",
                  m !== "bkash" && method === m && "border-[#3b6bff] bg-[#e8eeff] text-[#2a52d4]"
                )}
              >
                {m === "bkash" ? "bKash" : m === "nagad" ? "Nagad" : "Bank"}
              </button>
            ))}
          </div>
        )}

        {method === "bkash" && bk && (
          <div className="rounded-2xl border border-[#f6c3da] bg-gradient-to-br from-[#fdf0f6] to-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-[#c40f5f]">
                  bKash · {bk.type === "merchant" ? "Merchant (Payment)" : bk.type === "agent" ? "Agent (Cash out)" : "Personal (Send Money)"}
                </div>
                <div className="mt-1 font-mono text-2xl font-bold tracking-wide">{bk.number}</div>
              </div>
              <CopyText text={bk.number} label="Copy number" />
            </div>
            <ol className="mt-3 space-y-1.5 text-sm text-[#374151]">
              <li>
                1. Open bKash → <b>{bk.type === "merchant" ? "Payment" : bk.type === "agent" ? "Cash Out" : "Send Money"}</b>
              </li>
              <li>
                2. Enter <b className="font-mono">{bk.number}</b>
              </li>
              <li className="flex flex-wrap items-center gap-2">
                3. Amount <b>{taka(due)}</b> <CopyText text={String(due / 100)} label="Copy amount" />
              </li>
              <li>4. Note the Transaction ID (TrxID) from the bKash SMS and take a screenshot</li>
            </ol>
          </div>
        )}
        {method === "nagad" && methods.nagad && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#fbd2b7] bg-[#fff5ee] p-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-[#d0560f]">Nagad · Send Money</div>
              <div className="mt-1 font-mono text-2xl font-bold">{methods.nagad}</div>
            </div>
            <CopyText text={methods.nagad} label="Copy number" />
          </div>
        )}
        {method === "bank" && methods.bank && (
          <div className="whitespace-pre-line rounded-2xl border border-[#d6dbe6] bg-[#f8fafc] p-4 text-sm">{methods.bank}</div>
        )}

        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const fd = new FormData(e.currentTarget);
            fd.set("method", method ?? "bkash");
            const r = await fetch(`/api/public/invoice/${token}/pay`, { method: "POST", body: fd });
            setBusy(false);
            if (!r.ok) return setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Could not send — try again");
            setSent(true);
            router.refresh();
          }}
        >
          <Field label="Amount sent (৳)">
            <input name="amount" required inputMode="decimal" defaultValue={String(due / 100)} className={input} />
          </Field>
          <Field label="Transaction ID">
            <input name="reference" required placeholder="e.g. BKJ7XQ2M4P" className={cn(input, "font-mono uppercase")} autoComplete="off" />
          </Field>
          <Field label="Email" hint="receipt goes here">
            <input name="email" type="email" required defaultValue={defaultEmail} className={input} />
          </Field>
          <Field label="Phone you paid from">
            <input name="phone" defaultValue={defaultPhone} inputMode="tel" className={input} />
          </Field>
          <div className="sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-[#374151]">Payment screenshot</span>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-[#d6dbe6] p-3 text-left text-sm text-[#6b7280] hover:border-[#3b6bff]"
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Payment screenshot" className="h-16 w-16 rounded-lg object-cover" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-[#f3f5fa]">
                  <ImagePlus className="h-6 w-6 text-[#9ca3af]" />
                </span>
              )}
              <span>{preview ? "Tap to change the screenshot" : "Tap to add the bKash screenshot (PNG/JPG, up to 5 MB)"}</span>
            </button>
            <input
              ref={fileRef}
              name="screenshot"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </div>
          {error && <p className="text-sm text-[#d23645] sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy || !enabled} className={cn(primary, "w-full sm:w-auto")}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} I&apos;ve paid — send details
            </button>
          </div>
        </form>
      </fieldset>
    </section>
  );
}

/* ---------------------------------------------------------------- download */

export function PrintInvoice() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0f172a] px-3.5 text-sm font-medium text-white hover:bg-[#1e293b]"
    >
      <Download className="h-4 w-4" /> Download PDF
    </button>
  );
}

/* ---------------------------------------------------------------- share offer */

export function ShareOffer({ token, percent, sent }: { token: string; percent: number; sent: { status: string; url: string } | null }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(Boolean(sent));
  const img = `/i/${token}/share-image`;

  return (
    <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#0e1a3a] to-[#1d3a9e] text-white shadow-sm print:hidden">
      <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-[200px_minmax(0,1fr)] sm:p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt="Your website announcement picture" width={200} height={200} className="w-full rounded-xl shadow-lg sm:w-[200px]" />
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">
            <Gift className="h-3.5 w-3.5" /> Get {percent}% off
          </div>
          <h2 className="mt-2 text-xl font-bold">Share your new website, save {percent}%</h2>
          <p className="mt-1 text-sm text-[#c9d3ea]">
            Post this picture on your Facebook page with a line about your new website and mention ScaleUp Web. Send us the post link and we&apos;ll take{" "}
            {percent}% off your bill.
          </p>

          {done ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-white/10 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#6fd6a8]" />
              {sent?.status === "approved"
                ? `Thank you for sharing! Your ${percent}% discount is applied.`
                : "Thanks for sharing! We'll check your post and apply the discount soon."}
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={`${img}?download=1`} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-white px-3.5 text-sm font-semibold text-[#0f172a]">
                  <Download className="h-4 w-4" /> Download picture
                </a>
                <a
                  href="https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fscaleupweb.xyz"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#1877f2] px-3.5 text-sm font-semibold text-white"
                >
                  <Share2 className="h-4 w-4" /> Share on Facebook
                </a>
              </div>
              <form
                className="mt-4 flex flex-col gap-2 sm:flex-row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  const r = await fetch(`/api/public/invoice/${token}/share`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url })
                  });
                  setBusy(false);
                  if (!r.ok) return setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Could not send");
                  setDone(true);
                  router.refresh();
                }}
              >
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  placeholder="Paste your post link (https://facebook.com/…)"
                  className="h-10 min-w-0 flex-1 rounded-xl border border-white/20 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-white/50 focus:border-white/60"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#6fd6a8] px-4 text-sm font-semibold text-[#06281b] disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Claim {percent}% off
                </button>
              </form>
              {error && <p className="mt-2 text-sm text-[#ffb4bb]">{error}</p>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
