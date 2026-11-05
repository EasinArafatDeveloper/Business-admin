import { ImageResponse } from "next/og";
import { loadPublicInvoice } from "@/lib/public-invoice";

/**
 * 1080×1080 "our new website is live" card with ScaleUp Web branding, for the client to post.
 * Only Latin letters are drawn (the image font has no Bangla), so names fall back to "Our business".
 */
export async function GET(req: Request, ctx: RouteContext<"/i/[token]/share-image">) {
  const { token } = await ctx.params;
  const data = await loadPublicInvoice(token);
  if (!data) return new Response("Not found", { status: 404 });
  const latin = data.client.name
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const name = latin.length >= 2 ? latin.slice(0, 40) : "Our business";
  const download = new URL(req.url).searchParams.has("download");

  const img = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: "linear-gradient(145deg, #060a14 0%, #0e1a3a 55%, #1d3a9e 100%)",
        color: "#e8ecf4",
        fontFamily: "sans-serif"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: "#3b6bff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, background: "#fff" }} />
        </div>
        <div style={{ fontSize: 34, fontWeight: 700 }}>ScaleUp Web</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        <div style={{ display: "flex", fontSize: 30, color: "#afc3ff", letterSpacing: 6, textTransform: "uppercase" }}>Now live</div>
        <div style={{ display: "flex", fontSize: name.length > 22 ? 76 : 96, fontWeight: 800, lineHeight: 1.05 }}>{name}</div>
        <div style={{ display: "flex", fontSize: 40, color: "#c9d3ea", lineHeight: 1.35, maxWidth: 840 }}>Our new website is here — order any time, 24/7.</div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "2px solid rgba(200,214,255,0.18)", paddingTop: 36 }}>
        <div style={{ display: "flex", fontSize: 30, color: "#c9d3ea" }}>Built with ScaleUp Web</div>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#ffffff" }}>scaleupweb.xyz</div>
      </div>
    </div>,
    { width: 1080, height: 1080 }
  );
  if (download)
    img.headers.set("Content-Disposition", `attachment; filename="${name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase() || "website"}-scaleupweb.png"`);
  img.headers.set("Cache-Control", "private, max-age=300");
  return img;
}
