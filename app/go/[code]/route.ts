import { NextResponse } from "next/server";
import { handleHit } from "@/lib/tracking";

const NO_CACHE = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0", "X-Robots-Tag": "noindex" };

/** Public tracking link from an SMS: /go/<code>. */
export async function GET(request: Request, { params }: RouteContext<"/go/[code]">) {
  const { code } = await params;
  const h = request.headers;
  const hit = await handleHit(code, {
    ip: h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim(),
    userAgent: h.get("user-agent"),
    purpose: h.get("purpose"),
    secPurpose: h.get("sec-purpose") ?? h.get("x-purpose"),
    secFetchDest: h.get("sec-fetch-dest"),
    secFetchMode: h.get("sec-fetch-mode")
  }).catch((e) => {
    console.error("[go] tracking error", e);
    return null;
  });

  if (!hit) return NextResponse.redirect(process.env.LINK_FALLBACK_URL ?? "https://scaleupweb.xyz", { status: 302, headers: NO_CACHE });
  if (hit.html) return new NextResponse(hit.html, { status: 200, headers: { ...NO_CACHE, "Content-Type": "text/html; charset=utf-8" } });
  return NextResponse.redirect(hit.destination, { status: 302, headers: NO_CACHE });
}
