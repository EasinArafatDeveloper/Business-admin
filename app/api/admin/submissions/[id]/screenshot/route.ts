import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

/** The client's payment screenshot — signed-in admins of the same workspace only. */
export async function GET(_: Request, ctx: RouteContext<"/api/admin/submissions/[id]/screenshot">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const id = Number((await ctx.params).id);
  const S = schema.invoiceSubmissions;
  const [row] = await db
    .select({ data: S.screenshot, type: S.screenshotType })
    .from(S)
    .where(and(eq(S.id, id), eq(S.workspaceId, user.workspaceId)))
    .limit(1);
  if (!row?.data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: { "Content-Type": row.type ?? "image/png", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" }
  });
}
