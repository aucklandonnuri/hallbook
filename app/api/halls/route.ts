// app/api/halls/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";          // Node 런타임 강제 (service_role 사용 안전)
export const dynamic = "force-dynamic";   // 캐시 없이 항상 최신

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.warn("[/api/halls] Missing env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(url ?? "", serviceKey ?? "", {
  auth: { persistSession: false },
});

export async function GET() {
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Server env not set" }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from("halls")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const rows = (data ?? []).map((h: any) => ({
    id: String(h.id),
    name: h.name ?? "",
  }));

  // 캐시 방지 헤더
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
