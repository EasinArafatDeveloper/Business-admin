import { CORS, authServerMetadata } from "@/lib/oauth";

/** Served at /.well-known/oauth-authorization-server and /.well-known/openid-configuration. */
export function GET() {
  return Response.json(authServerMetadata(), { headers: { ...CORS, "Cache-Control": "public, max-age=3600" } });
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
