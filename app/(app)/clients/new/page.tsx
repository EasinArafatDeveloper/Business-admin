import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAccess } from "@/lib/auth";
import { Card } from "@/components/ui";
import { ClientForm } from "@/components/billing/forms";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  await requireAccess("clients");
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/clients" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Clients
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New client</h1>
      <Card className="p-5">
        <ClientForm id={null} />
      </Card>
    </div>
  );
}
