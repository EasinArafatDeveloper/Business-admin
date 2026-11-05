import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { getWaStatus, waLogout } from "@/lib/wa";

/** Connection state + QR for the WhatsApp page (polled every few seconds). */
export async function GET() {
  if (!(await apiUser("channels"))) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json(await getWaStatus(), { headers: { "Cache-Control": "no-store" } });
}

/** Unlink the WhatsApp number (a fresh QR appears). */
export async function DELETE() {
  if (!(await apiUser("channels"))) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  await waLogout();
  return NextResponse.json({ ok: true });
}
