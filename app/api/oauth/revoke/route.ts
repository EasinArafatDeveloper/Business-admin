import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { CORS, authClient, sha256 } from "@/lib/oauth";

/** RFC 7009: the app signs out — the token stops working. Always answers 200. */
export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text());
  const client = await authClient(req, form);
  const raw = form.get("token");
  if (client && raw) {
    const T = schema.oauthTokens;
    const [row] = await db
      .select()
      .from(T)
      .where(eq(T.tokenHash, sha256(raw)))
      .limit(1);
    if (row && row.clientId === client.id) await db.update(T).set({ revokedAt: new Date() }).where(eq(T.id, row.id));
  }
  return new Response(null, { status: 200, headers: CORS });
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
