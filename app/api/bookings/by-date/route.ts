import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    const rawHall = searchParams.get("hall_id");
    if (!date) return NextResponse.json({ error: "Missing date" }, { status: 400 });

    // hall_id 정규화 (int/uuid 동시 대응)
    const hallId = rawHall == null ? null :
      (/^\d+$/.test(String(rawHall)) ? Number(rawHall) : String(rawHall));

    let q = sb.from("bookings")
      .select("id, date, start_time, end_time, title, requester_name, phone, hall_id")
      .eq("date", date)
      .order("start_time", { ascending: true });

    if (hallId !== null) q = q.eq("hall_id", hallId as any);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // ✅ 호환 응답: applicant(신규) + requester_name(레거시) 모두 포함
    const items = (data ?? []).map((r: any) => ({
      id: r.id,
      date: r.date,
      start_time: r.start_time,
      end_time: r.end_time,
      title: r.title,
      applicant: r.requester_name,          // 신규 키
      requester_name: r.requester_name,     // 레거시 키도 유지
      phone: r.phone,
      hall_id: r.hall_id,
    }));

    return NextResponse.json(items, { status: 200 });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
