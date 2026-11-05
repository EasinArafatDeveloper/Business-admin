import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db, schema } from "@/db";
import { requireAccess } from "@/lib/auth";
import { InvoiceEditor } from "@/components/billing/forms";

export const metadata = { title: "Edit invoice" };

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const amount = (p: number) => (p === 0 ? "" : String(p / 100));

export default async function EditInvoicePage({ params }: PageProps<"/invoices/[id]/edit">) {
  const user = await requireAccess("invoices");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const I = schema.invoices;
  const [inv] = await db
    .select()
    .from(I)
    .where(and(eq(I.id, id), eq(I.workspaceId, user.workspaceId)))
    .limit(1);
  if (!inv) notFound();
  if (inv.status === "void" || (inv.total > 0 && inv.amountPaid >= inv.total)) redirect(`/invoices/${id}`);

  const [items, clients] = await Promise.all([
    db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, id)).orderBy(asc(schema.invoiceItems.position)),
    db
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(eq(schema.clients.workspaceId, user.workspaceId))
      .orderBy(asc(schema.clients.name))
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href={`/invoices/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> {inv.number}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Edit {inv.number}</h1>
      <InvoiceEditor
        id={id}
        clients={clients}
        initial={{
          clientId: inv.clientId,
          issueDate: ymd(inv.issueDate),
          dueDate: ymd(inv.dueDate),
          discount: amount(inv.discount),
          notes: inv.notes ?? "",
          terms: inv.terms ?? "",
          items: items.map((it) => ({ description: it.description, quantity: it.quantity, unitPrice: String(it.unitPrice / 100) }))
        }}
      />
    </div>
  );
}
