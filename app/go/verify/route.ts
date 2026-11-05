import { NextResponse } from "next/server";
import { verifyHuman } from "@/lib/tracking";

/** Beacon from the human-check page. Always answers 204 so it reveals nothing. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { t?: unknown; w?: unknown; h?: unknown; touch?: unknown; ms?: unknown };
    if (typeof body.t === "string") {
      await verifyHuman(body.t, {
        screenWidth: Number(body.w) || 0,
        screenHeight: Number(body.h) || 0,
        hasTouch: Boolean(body.touch),
        renderMs: Number(body.ms) || 0
      });
    }
  } catch (e) {
    console.error("[go/verify]", e);
  }
  return new NextResponse(null, { status: 204 });
}
