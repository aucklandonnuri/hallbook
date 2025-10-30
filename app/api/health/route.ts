import { NextResponse } from "next/server";

/** Run this API on Node runtime to avoid Edge/Node mismatch */
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString() });
}
