import { CORS, protectedResourceMetadata } from "@/lib/oauth";

/** Served at /.well-known/oauth-protected-resource[/api/mcp] (see next.config.ts rewrites). */
export function GET() {
  return Response.json(protectedResourceMetadata(), { headers: { ...CORS, "Cache-Control": "public, max-age=3600" } });
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
