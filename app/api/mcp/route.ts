import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate } from "@/lib/mcp/keys";
import { buildServer } from "@/lib/mcp/server";
import { allow } from "@/lib/public-invoice";

/**
 * MCP endpoint for AI assistants: POST JSON-RPC with "Authorization: Bearer su_…".
 * Stateless — every request gets its own server with the tools that key may use.
 */
const unauthorized = () =>
  Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message: "Missing or invalid API key — create one in Settings → AI access" }, id: null },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="scaleup-admin"' } }
  );

async function handle(req: Request) {
  const ctx = await authenticate(req);
  if (!ctx) return unauthorized();
  if (!allow(`mcp:${ctx.key.id}`, 120, 60_000)) {
    return Response.json({ jsonrpc: "2.0", error: { code: -32029, message: "Too many requests — slow down" }, id: null }, { status: 429 });
  }
  const server = buildServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Close after the response is produced; JSON mode resolves with the full body.
    queueMicrotask(() => void server.close().catch(() => {}));
  }
}

export const POST = handle;

/** No server-initiated streams or sessions in stateless mode. */
export async function GET() {
  return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, { status: 405, headers: { Allow: "POST" } });
}
export const DELETE = GET;
