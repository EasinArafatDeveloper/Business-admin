"use client";

import { useActionState, useState, useTransition } from "react";
import { Ban, Check, Copy, CopyPlus, Plus, RotateCcw, Send, Trash2, UserPlus } from "lucide-react";
import {
  convertLead,
  deleteDraft,
  deletePayment,
  duplicateInvoice,
  recordPayment,
  reviewSubmission,
  saveBilling,
  saveClient,
  saveInvoice,
  sendInvoice,
  setInvoiceStatus
} from "@/app/actions/billing";
import type { BillingProfile } from "@/db/schema";
import { PAYMENT_METHODS, parseTaka, taka, totals } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button, Card, Label, inputClass } from "@/components/ui";

const textareaClass = "w-full rounded-xl border border-line-strong bg-ink-alt p-3 text-sm outline-none focus:border-accent";

function Msg({ state }: { state?: { error?: string; ok?: string } }) {
  if (state?.error) return <p className="text-sm text-danger">{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-success">{state.ok}</p>;
  return null;
}

/* ---------------------------------------------------------------- client */

type ClientValues = {
  name?: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  website?: string | null;
  notes?: string | null;
  status?: string;
};

export function ClientForm({ id, initial = {} }: { id: number | null; initial?: ClientValues }) {
  const [state, action, pending] = useActionState(saveClient.bind(null, id), undefined);
  const v = (k: keyof ClientValues) => initial[k] ?? "";
  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <Label>Business name</Label>
          <input name="name" required defaultValue={v("name")} placeholder="e.g. Sign of Modesty" className={inputClass} />
        </label>
        <label className="block">
          <Label>Contact person</Label>
          <input name="contactName" defaultValue={v("contactName")} placeholder="Owner / manager name" className={inputClass} />
        </label>
        <label className="block">
          <Label>Phone / WhatsApp</Label>
          <input name="phone" defaultValue={v("phone")} placeholder="01XXXXXXXXX" inputMode="tel" className={inputClass} />
        </label>
        <label className="block">
          <Label>Email</Label>
          <input name="email" type="email" defaultValue={v("email")} placeholder="for sending invoices" className={inputClass} />
        </label>
        <label className="block">
          <Label>Website / page</Label>
          <input name="website" defaultValue={v("website")} className={inputClass} />
        </label>
        <label className="block sm:col-span-2">
          <Label>Address</Label>
          <input name="address" defaultValue={v("address")} className={inputClass} />
        </label>
        <label className="block">
          <Label>Status</Label>
          <select name="status" defaultValue={initial.status ?? "active"} className={inputClass}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="past">Past</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <Label hint="only you see this">Notes</Label>
          <textarea name="notes" rows={3} defaultValue={v("notes")} placeholder="What you're building, agreed price, deadlines…" className={textareaClass} />
        </label>
      </div>
      <Msg state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : id ? "Save changes" : "Add client"}
      </Button>
    </form>
  );
}

export function ConvertLeadButton({ leadId, existingClientId }: { leadId: number; existingClientId?: number | null }) {
  const [pending, start] = useTransition();
  if (existingClientId)
    return (
      <a href={`/clients/${existingClientId}`} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-success/40 px-3 text-xs text-success">
        <Check className="h-3.5 w-3.5" /> Client — open
      </a>
    );
  return (
    <Button size="sm" disabled={pending} onClick={() => start(() => convertLead(leadId))}>
      <UserPlus className="h-3.5 w-3.5" /> {pending ? "Converting…" : "Convert to client"}
    </Button>
  );
}

/* ---------------------------------------------------------------- invoice editor */

type Line = { key: number; description: string; quantity: string; unitPrice: string };
const SUGGESTIONS = [
  "E-commerce website",
  "Landing page",
  "Business website",
  "Monthly maintenance",
  "Domain + hosting (1 year)",
  "Pixel & CAPI setup",
  "SEO (monthly)"
];

export function InvoiceEditor({
  id,
  clients,
  initial
}: {
  id: number | null;
  clients: { id: number; name: string }[];
  initial: {
    clientId?: number;
    issueDate: string;
    dueDate: string;
    discount: string;
    notes: string;
    terms: string;
    items: { description: string; quantity: number; unitPrice: string }[];
  };
}) {
  const [state, action, pending] = useActionState(saveInvoice.bind(null, id), undefined);
  const [seq, setSeq] = useState(initial.items.length + 1);
  const [lines, setLines] = useState<Line[]>(
    initial.items.length
      ? initial.items.map((it, i) => ({ key: i, description: it.description, quantity: String(it.quantity), unitPrice: it.unitPrice }))
      : [{ key: 0, description: "", quantity: "1", unitPrice: "" }]
  );
  const [discount, setDiscount] = useState(initial.discount);

  const parsed = lines.map((l) => ({ description: l.description, quantity: Math.max(0, Number(l.quantity) || 0), unitPrice: parseTaka(l.unitPrice) ?? 0 }));
  const t = totals(parsed, parseTaka(discount) ?? 0);
  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = (description = "") => {
    setLines((ls) => [...ls, { key: seq, description, quantity: "1", unitPrice: "" }]);
    setSeq((s) => s + 1);
  };

  return (
    <form action={action} className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(
          lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }))
        )}
      />
      <div className="space-y-5">
        <Card className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <Label>Client</Label>
            <select name="clientId" required defaultValue={initial.clientId ?? ""} className={inputClass}>
              <option value="" disabled>
                Choose a client…
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <Label>Issue date</Label>
            <input name="issueDate" type="date" required defaultValue={initial.issueDate} className={inputClass} />
          </label>
          <label className="block">
            <Label>Due date</Label>
            <input name="dueDate" type="date" defaultValue={initial.dueDate} className={inputClass} />
          </label>
        </Card>

        <Card className="p-5">
          <div className="mb-3 hidden grid-cols-[minmax(0,1fr)_70px_130px_110px_32px] gap-2 text-[11px] uppercase tracking-wider text-muted-2 xl:grid">
            <span>Description</span>
            <span>Qty</span>
            <span>Price (৳)</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div
                key={l.key}
                className="grid grid-cols-[70px_minmax(0,1fr)_minmax(0,1fr)_32px] gap-2 rounded-xl border border-line p-2 xl:grid-cols-[minmax(0,1fr)_70px_130px_110px_32px] xl:border-0 xl:p-0"
              >
                <input
                  value={l.description}
                  onChange={(e) => set(l.key, { description: e.target.value })}
                  placeholder={i === 0 ? "e.g. E-commerce website (design + development)" : "Item"}
                  aria-label="Description"
                  className={cn(inputClass, "col-span-4 xl:col-span-1")}
                />
                <input
                  value={l.quantity}
                  onChange={(e) => set(l.key, { quantity: e.target.value.replace(/\D/g, "") })}
                  inputMode="numeric"
                  aria-label="Quantity"
                  className={inputClass}
                />
                <input
                  value={l.unitPrice}
                  onChange={(e) => set(l.key, { unitPrice: e.target.value })}
                  inputMode="decimal"
                  placeholder="0"
                  aria-label="Price"
                  className={cn(inputClass, l.unitPrice && parseTaka(l.unitPrice) == null && "border-danger")}
                />
                <div className="flex items-center justify-end text-sm font-medium">{taka(parsed[i].quantity * parsed[i].unitPrice)}</div>
                <button
                  type="button"
                  onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
                  className="flex items-center justify-center rounded-lg text-muted-2 hover:bg-danger/10 hover:text-danger"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Button type="button" size="sm" variant="secondary" onClick={() => add()}>
              <Plus className="h-3.5 w-3.5" /> Add line
            </Button>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:text-fg">
                + {s}
              </button>
            ))}
          </div>
        </Card>

        <Card className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <label className="block">
            <Label hint="shown on the invoice">Notes</Label>
            <textarea name="notes" rows={3} defaultValue={initial.notes} placeholder="e.g. 50% advance received, rest on delivery" className={textareaClass} />
          </label>
          <label className="block">
            <Label hint="shown on the invoice">Terms</Label>
            <textarea name="terms" rows={3} defaultValue={initial.terms} className={textareaClass} />
          </label>
        </Card>
      </div>

      <div className="space-y-3 lg:sticky lg:top-6 lg:h-fit">
        <Card className="space-y-2.5 p-5 text-sm">
          <Row k="Subtotal" v={taka(t.subtotal)} />
          <label className="flex items-center justify-between gap-3">
            <span className="text-muted">Discount (৳)</span>
            <input
              name="discount"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              inputMode="decimal"
              className={cn(inputClass, "h-8 w-28 text-right", discount && parseTaka(discount) == null && "border-danger")}
            />
          </label>
          <div className="border-t border-line pt-2.5">
            <Row k="Total" v={taka(t.total)} strong />
          </div>
        </Card>
        <Msg state={state} />
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Saving…" : id ? "Save invoice" : "Create invoice"}
        </Button>
        <p className="text-center text-xs text-muted-2">It stays a draft until you send it or mark it sent.</p>
      </div>
    </form>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{k}</span>
      <span className={cn(strong && "text-lg font-semibold")}>{v}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- invoice page actions */

export function PaymentForm({ invoiceId, due }: { invoiceId: number; due: number }) {
  const [state, action, pending] = useActionState(recordPayment.bind(null, invoiceId), undefined);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={action} className="space-y-3" key={state?.ok}>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <Label>Amount (৳)</Label>
          <input name="amount" required inputMode="decimal" defaultValue={due > 0 ? String(due / 100) : ""} className={inputClass} />
        </label>
        <label className="block">
          <Label>Method</Label>
          <select name="method" defaultValue="bkash" className={inputClass}>
            {Object.entries(PAYMENT_METHODS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <Label>Date</Label>
          <input name="paidAt" type="date" defaultValue={today} className={inputClass} />
        </label>
        <label className="block">
          <Label hint="optional">TrxID / ref</Label>
          <input name="reference" className={inputClass} />
        </label>
      </div>
      <Msg state={state} />
      <Button type="submit" size="sm" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Record payment"}
      </Button>
    </form>
  );
}

export function SendForm({ invoiceId, channel, defaultTo }: { invoiceId: number; channel: "email" | "whatsapp"; defaultTo?: string | null }) {
  const [state, action, pending] = useActionState(sendInvoice.bind(null, invoiceId, channel), undefined);
  return (
    <form action={action} className="space-y-1.5">
      <div className="flex gap-2">
        <input
          name="to"
          required
          defaultValue={defaultTo ?? ""}
          type={channel === "email" ? "email" : "text"}
          placeholder={channel === "email" ? "client@email.com" : "01XXXXXXXXX"}
          className={cn(inputClass, "h-9")}
        />
        <Button type="submit" size="sm" variant="secondary" disabled={pending} className="h-9 shrink-0">
          <Send className="h-3.5 w-3.5" /> {pending ? "…" : channel === "email" ? "Email" : "WhatsApp"}
        </Button>
      </div>
      <Msg state={state} />
    </form>
  );
}

export function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className="w-full"
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {done ? "Copied" : "Copy client link"}
    </Button>
  );
}

export function InvoiceButtons({ id, status, paid }: { id: number; status: string; paid: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(() => setInvoiceStatus(id, "sent"))}>
          <Check className="h-3.5 w-3.5" /> Mark as sent
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => duplicateInvoice(id))}>
        <CopyPlus className="h-3.5 w-3.5" /> Duplicate
      </Button>
      {status === "void" ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => setInvoiceStatus(id, "sent"))}>
          <RotateCcw className="h-3.5 w-3.5" /> Restore
        </Button>
      ) : (
        !paid &&
        status !== "draft" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => confirm("Void this invoice? It stays on record but can't be paid.") && start(() => setInvoiceStatus(id, "void"))}
          >
            <Ban className="h-3.5 w-3.5" /> Void
          </Button>
        )
      )}
      {status === "draft" && (
        <Button size="sm" variant="danger" disabled={pending} onClick={() => confirm("Delete this draft?") && start(() => deleteDraft(id))}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      )}
    </div>
  );
}

export function DeletePaymentButton({ id }: { id: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => confirm("Remove this payment?") && start(() => deletePayment(id))}
      className="rounded p-1 text-muted-2 hover:text-danger"
      aria-label="Remove payment"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

export function PrintButton() {
  return (
    <Button type="button" size="sm" variant="secondary" className="w-full" onClick={() => window.print()}>
      Download PDF / Print
    </Button>
  );
}

/* ---------------------------------------------------------------- business profile */

export function BillingForm({ initial, workspaceName }: { initial: BillingProfile; workspaceName: string }) {
  const [state, action, pending] = useActionState(saveBilling, undefined);
  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <Label hint="shown at the top of invoices">Business name</Label>
          <input name="legalName" defaultValue={initial.legalName ?? workspaceName} className={inputClass} />
        </label>
        <label className="block">
          <Label hint="e.g. SU → SU-2026-0001">Invoice prefix</Label>
          <input name="invoicePrefix" defaultValue={initial.invoicePrefix ?? "SU"} maxLength={12} className={inputClass} />
        </label>
        <label className="block">
          <Label>Phone</Label>
          <input name="phone" defaultValue={initial.phone} className={inputClass} />
        </label>
        <label className="block">
          <Label>Email</Label>
          <input name="email" type="email" defaultValue={initial.email ?? "hello@scaleupweb.xyz"} className={inputClass} />
        </label>
        <label className="block">
          <Label>Website</Label>
          <input name="website" defaultValue={initial.website ?? "scaleupweb.xyz"} className={inputClass} />
        </label>
        <label className="block">
          <Label hint="days after issue">Payment due in</Label>
          <input name="dueDays" type="number" min={0} max={120} defaultValue={initial.dueDays ?? 7} className={inputClass} />
        </label>
        <label className="block sm:col-span-2">
          <Label>Address</Label>
          <input name="address" defaultValue={initial.address ?? "Dhaka, Bangladesh"} className={inputClass} />
        </label>
        <div className="rounded-2xl border border-line p-4 sm:col-span-2">
          <div className="mb-3 text-sm font-medium">Payments on the client link</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <Label>bKash number</Label>
              <input name="bkashNumber" defaultValue={initial.bkashNumber ?? "01570224332"} inputMode="tel" className={inputClass} />
            </label>
            <label className="block">
              <Label>bKash account type</Label>
              <select name="bkashType" defaultValue={initial.bkashType ?? "personal"} className={inputClass}>
                <option value="personal">Personal — client uses Send Money</option>
                <option value="merchant">Merchant — client uses Payment</option>
                <option value="agent">Agent — client uses Cash Out</option>
              </select>
            </label>
            <label className="block">
              <Label hint="optional">Nagad number</Label>
              <input name="nagadNumber" defaultValue={initial.nagadNumber} inputMode="tel" className={inputClass} />
            </label>
            <label className="block">
              <Label hint="0 = off">Share discount %</Label>
              <input name="shareDiscountPercent" type="number" min={0} max={50} defaultValue={initial.shareDiscountPercent ?? 10} className={inputClass} />
            </label>
            <label className="block sm:col-span-2">
              <Label hint="optional">Bank details</Label>
              <textarea
                name="bankDetails"
                rows={3}
                defaultValue={initial.bankDetails}
                placeholder={"Bank name\nAccount name\nAccount no. · Branch · Routing"}
                className={textareaClass}
              />
            </label>
          </div>
        </div>
        <label className="block sm:col-span-2">
          <Label hint="optional extra line on every invoice">Other payment notes</Label>
          <textarea
            name="paymentInfo"
            rows={2}
            defaultValue={initial.paymentInfo}
            placeholder="e.g. Please keep the TrxID after paying"
            className={textareaClass}
          />
        </label>
        <label className="block sm:col-span-2">
          <Label hint="pre-filled on new invoices">Default terms</Label>
          <textarea
            name="defaultTerms"
            rows={3}
            defaultValue={initial.defaultTerms ?? "50% advance to start, 50% before going live. Domain and hosting renew yearly."}
            className={textareaClass}
          />
        </label>
      </div>
      <Msg state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

/* ---------------------------------------------------------------- client submissions */

export function ReviewButtons({ id, approveLabel }: { id: number; approveLabel: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error?: string; ok?: string }>();
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => start(async () => setResult(await reviewSubmission(id, "approve")))}>
          <Check className="h-3.5 w-3.5" /> {approveLabel}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => confirm("Reject this? The client will get an email.") && start(async () => setResult(await reviewSubmission(id, "reject")))}
        >
          Reject
        </Button>
      </div>
      <Msg state={result} />
    </div>
  );
}
