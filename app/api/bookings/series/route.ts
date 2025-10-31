// app/api/bookings/series/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Freq = "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";

/** "HH:mm" | "HH:mm:ss" → "HH:mm:ss" */
function normalizeHm(t: string) {
  const s = String(t ?? "").trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{2}:\d{2}$/.test(s)) return `${s}:00`;
  throw new Error(`Invalid time format: ${t}`);
}
/** "HH:mm[:ss]" → 총 분 */
function toMinutes(t: string) {
  const [h, m] = normalizeHm(t).split(":");
  return Number(h) * 60 + Number(m);
}

/** Supabase(admin) */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = createClient(url, key, { auth: { persistSession: false } });

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      hall_id: string | number;
      start_date: string;      // YYYY-MM-DD
      start_time: string;      // HH:mm or HH:mm:ss
      end_time: string;        // HH:mm or HH:mm:ss
      title?: string;          // 폼의 모임명 (bookings.title 에도 넣어줌)
      group_name?: string;     // (레거시/다른 호출자용)
      applicant?: string | null;
      phone?: string | null;
      description?: string | null;
      freq: Freq;
      occurrences?: number | null;
      until?: string | null;   // YYYY-MM-DD
    };

    // ===== 1) 필수값 검증 =====
    const required = ["hall_id", "start_date", "start_time", "end_time", "freq"] as const;
    const miss = required.filter((k) => (body as any)[k] == null || String((body as any)[k]).trim() === "");
    if (miss.length) {
      return NextResponse.json({ error: `Missing: ${miss.join(", ")}` }, { status: 400 });
    }

    // 모임명(= DB의 group_name) 확보: title 또는 group_name 중 하나
    const groupName = (body.title ?? body.group_name ?? "").toString().trim();
    if (!groupName) {
      return NextResponse.json({ error: "Missing group name (title)" }, { status: 400 });
    }

    // 신청자명(= DB의 requester_name) 확보 (NOT NULL 회피: 빈 문자열 허용)
    const requesterName = (body.applicant ?? "").toString().trim();

    // 시간 정규화 + 순서 체크
    const start_time = normalizeHm(body.start_time);
    const end_time = normalizeHm(body.end_time);
    if (toMinutes(end_time) <= toMinutes(start_time)) {
      return NextResponse.json({ error: "end_time must be later than start_time" }, { status: 400 });
    }

    // 날짜 정규/검증
    const startDate = new Date(`${body.start_date}T00:00:00`);
    if (isNaN(startDate.getTime())) return NextResponse.json({ error: "Invalid start_date" }, { status: 400 });
    const untilDate = body.until ? new Date(`${body.until}T00:00:00`) : null;
    if (untilDate && isNaN(untilDate.getTime())) return NextResponse.json({ error: "Invalid until" }, { status: 400 });

    // hall_id 정규화 (uuid 문자열/숫자 모두 허용하되 실제 존재 확인)
    const hallId =
      typeof body.hall_id === "number"
        ? body.hall_id
        : /^\d+$/.test(String(body.hall_id))
        ? Number(body.hall_id)
        : String(body.hall_id);

    // ===== 2) hall 존재 확인 =====
    {
      const { data: hall, error: hallErr } = await sb
        .from("halls")
        .select("id")
        .eq("id", hallId as any)
        .maybeSingle();
      if (hallErr) return NextResponse.json({ error: `Hall lookup failed: ${hallErr.message}` }, { status: 400 });
      if (!hall) return NextResponse.json({ error: "Invalid hall_id (not found)" }, { status: 400 });
    }

    // ===== 3) 반복 발생일 계산 =====
    const addUnit = (d: Date) => {
      const nd = new Date(d);
      if (body.freq === "WEEKLY") nd.setDate(nd.getDate() + 7);
      else if (body.freq === "FORTNIGHTLY") nd.setDate(nd.getDate() + 14);
      else if (body.freq === "MONTHLY") {
        // 같은 '날짜'에 최대한 맞추는 월 증분
        const dom = nd.getDate();
        nd.setMonth(nd.getMonth() + 1);
        while (nd.getDate() < dom) nd.setDate(nd.getDate() - 1);
      }
      return nd;
    };

    const maxOcc =
      body.occurrences && body.occurrences > 0
        ? body.occurrences
        : untilDate
        ? 10000
        : 10; // until 없으면 기본 10회

    const dates: string[] = [];
    let cur = startDate;
    for (let i = 0; i < maxOcc; i++) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, "0");
      const d = String(cur.getDate()).padStart(2, "0");
      dates.push(`${y}-${m}-${d}`);

      const next = addUnit(cur);
      if (untilDate && next > untilDate) break;
      cur = next;

      if (i > 500) break; // 안전 가드
    }
    if (!dates.length) return NextResponse.json({ error: "No occurrences generated" }, { status: 400 });

    // ===== 4) 부모 series 먼저 INSERT =====
    // - end_date: 생성된 날짜 중 마지막
    // - byweekday: 생성된 모든 날짜의 요일(0:일~6:토) 중복 제거 정렬
    const endDate = dates[dates.length - 1];
    const uniqueWeekdays = Array.from(
      new Set(
        dates.map((ds) => {
          // JS getDay(): 0=Sun..6=Sat
          const wd = new Date(`${ds}T00:00:00`).getDay();
          return wd;
        })
      )
    ).sort((a, b) => a - b);

    const interval = body.freq === "FORTNIGHTLY" ? 2 : 1;

    const { data: seriesRow, error: seriesErr } = await sb
      .from("series")
      .insert({
        hall_id: hallId as any,
        start_date: dates[0],
        end_date: endDate,
        start_time,
        end_time,
        interval,
        byweekday: uniqueWeekdays,            // integer[]
        requester_name: requesterName,
        phone: body.phone ?? null,
        group_name: groupName,
        description: body.description ?? null,
      })
      .select("id")
      .single();

    if (seriesErr) {
      return NextResponse.json({ error: `Series insert failed: ${seriesErr.message}` }, { status: 400 });
    }
    const series_id = seriesRow!.id;

    // ===== 5) 자식 bookings INSERT (is_series/freq 포함) =====
    const rows = dates.map((date) => ({
      hall_id: hallId,
      date,
      start_time,
      end_time,
      group_name: groupName,         // NOT NULL
      requester_name: requesterName, // NOT NULL (빈 문자열 허용)
      phone: body.phone ?? null,
      description: body.description ?? null,
      is_series: true,
      series_id,                     // ★ 부모에서 받은 실제 uuid
      title: body.title ?? null,     // bookings.title 컬럼 반영
      applicant: body.applicant ?? null,
      freq: body.freq,               // bookings.freq 체크 제약 통과 (세 값 중 하나)
    }));

    const { data, error } = await sb
      .from("bookings")
      .insert(rows)
      .select("id, date, start_time, end_time, hall_id, group_name, requester_name");

    if (error) {
      return NextResponse.json({ error: `Bookings insert failed: ${error.message}` }, { status: 400 });
    }

    return NextResponse.json(
      { series_id, count: data?.length ?? 0, items: data ?? [] },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("POST /api/bookings/series error:", e);
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}
