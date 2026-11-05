import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const M = schema.inboundMessages;
  const [[ws], [unread]] = await Promise.all([
    db.select({ name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.id, user.workspaceId)).limit(1),
    db
      .select({ n: sql<number>`count(distinct ${M.sender})::int` })
      .from(M)
      .where(and(eq(M.workspaceId, user.workspaceId), eq(M.direction, "in"), isNull(M.readAt)))
  ]);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar userName={user.name} workspace={ws?.name ?? "Workspace"} badges={{ "/inbox": unread?.n ?? 0 }} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
