import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { can } from "@/lib/permissions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const M = schema.inboundMessages;
  const S = schema.invoiceSubmissions;
  const [[ws], [unread], [review]] = await Promise.all([
    db.select({ name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.id, user.workspaceId)).limit(1),
    db
      .select({ n: sql<number>`count(distinct ${M.sender})::int` })
      .from(M)
      .where(and(eq(M.workspaceId, user.workspaceId), eq(M.direction, "in"), isNull(M.readAt))),
    db
      .select({ n: sql<number>`count(distinct ${S.invoiceId})::int` })
      .from(S)
      .where(and(eq(S.workspaceId, user.workspaceId), eq(S.status, "pending")))
  ]);

  const allowed = [
    can(user, "leads") && ["/", "/leads", "/leads/import"],
    can(user, "campaigns") && "/campaigns",
    can(user, "inbox") && "/inbox",
    can(user, "channels") && "/channels",
    can(user, "clients") && "/clients",
    can(user, "invoices") && "/invoices",
    "/settings"
  ]
    .flat()
    .filter((x): x is string => typeof x === "string");

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar userName={user.name} workspace={ws?.name ?? "Workspace"} badges={{ "/inbox": unread?.n ?? 0, "/invoices": review?.n ?? 0 }} allowed={allowed} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:p-0">{children}</main>
    </div>
  );
}
