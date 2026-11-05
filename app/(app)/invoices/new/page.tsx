import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getBilling } from "@/lib/billing";
import { Card } from "@/components/ui";
import { InvoiceEditor } from "@/components/billing/forms";

export const metadata = { title: "New invoice" };

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default async function NewInvoicePage({ searchParams }: PageProps<"/invoices/new">) {
  const user = await requireUser();
  const sp = await searchParams;
  const K = schema.clients;
  const [clients, { billing }] = await Promise.all([
    db.select({ id: K.id, name: K.name }).from(K).where(eq(K.workspaceId, user.workspaceId)).orderBy(asc(K.name)),
    getBilling(user.workspaceId)
  ]);
  const preset = Number(sp.client);
  const now = new Date();

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/invoices" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Invoices
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New invoice</h1>
      {clients.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">
          Add a client first —{" "}
          <Link href="/clients/new" className="text-accent-soft hover:underline">
            new client
          </Link>{" "}
          or convert a lead from its lead page.
        </Card>
      ) : (
        <InvoiceEditor
          id={null}
          clients={clients}
          initial={{
            clientId: clients.some((c) => c.id === preset) ? preset : undefined,
            issueDate: ymd(now),
            dueDate: ymd(new Date(now.getTime() + (billing.dueDays ?? 7) * 86_400_000)),
            discount: "",
            notes: "",
            terms: billing.defaultTerms ?? "",
            items: []
          }}
        />
      )}
    </div>
  );
}
