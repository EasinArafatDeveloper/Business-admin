import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAccess } from "@/lib/auth";
import { TemplateLibrary } from "@/components/messages/template-form";

export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const user = await requireAccess("campaigns");
  const TT = schema.messageTemplates;
  const templates = await db
    .select({ id: TT.id, channel: TT.channel, name: TT.name, subject: TT.subject, body: TT.body })
    .from(TT)
    .where(eq(TT.workspaceId, user.workspaceId))
    .orderBy(desc(TT.updatedAt));
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
        <p className="mt-1 text-sm text-muted">Messages you reuse in sequences. Placeholders like {"{name}"} and {"{ads}"} are filled in for each lead.</p>
      </div>
      <TemplateLibrary templates={templates} />
    </div>
  );
}
