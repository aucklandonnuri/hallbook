// app/api/bookings/series/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { RRule } from "rrule";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// 1) 먼저 들어오는 body의 다양한 키/타입을 통일
function normalizeBody(raw: any) {
  const pick = (a: any, ...keys: string[]) =>
    keys.find(k => a?.[k] !== undefined) as string | undefined;

  const hallKey = pick(raw, "hall_id", "hallId");
  const sdKey   = pick(raw, "start_date", "startDate");
  const edKey   = pick(raw, "end_date", "endDate");
  const stKey   = pick(raw, "start_time", "startTime");
  const etKey   = pick(raw, "end_time", "endTime");
  const intKey  = pick(raw, "interval", "intervalWeeks", "interval_weeks");
  const daysKey = pick(raw, "byweekday", "weekdays", "days", "dayOfWeek");

  // 문자열이면 트림
  const trim = (v: any) => (typeof v === "string" ? v.trim() : v);

  // 요일: 숫자/문자 섞여도 배열로 강제
  let byweekday = raw?.[daysKey ?? ""] ?? [];
  if (!Array.isArray(byweekday)) byweekday = [];

  byweekday = byweekday
    .map((v: any) => Number(v))
    .filter((n: number) => !Number.isNaN(n))
    .map((n: number) => (n === 7 ? 0 : n)) // 7→0(일)
    .filter((n: number) => n >= 0 && n <= 6);

  // 시간: "HH:mm"만 와도 OK
  const normTime = (t: any) => {
    const s = String(t ?? "").trim();
    const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(s);
    if (!m) return s; // 스키마에서 재검증
    return m[3] ? s : `${m[1]}:${m[2]}`; // 여기선 HH:mm 유지
  };

  return {
    hall_id: trim(raw?.[hallKey ?? ""]),
    start_date: trim(raw?.[sdKey ?? ""]),
    end_date: trim(raw?.[edKey ?? ""]),
    start_time: normTime(raw?.[stKey ?? ""]),
    end_time: normTime(raw?.[etKey ?? ""]),
    interval: raw?.[intKey ?? ""] ?? 1,
    byweekday,
    requester_name: trim(raw?.requester_name ?? raw?.requesterName ?? ""),
    phone: trim(raw?.phone ?? ""),
    group_name: trim(raw?.group_name ?? raw?.groupName ?? ""),
    description: trim(raw?.description ?? "")
  };
}

// 2) 스키마는 coerce로 문자열 숫자를 허용
const sSchema = z.object({
  hall_id: z.union([z.coerce.number(), z.string()]), // 숫자 변환 허용
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  interval: z.coerce.number().int().min(1).max(8).default(1),
  byweekday: z.array(z.coerce.number().int().min(0).max(6)).nonempty(),
  requester_name: z.string().min(1),
  phone: z.string().optional().default(""),
  group_name: z.string().min(1),
  description: z.string().optional().default("")
});

// 유틸
const fmtDateLocal = (d: Date) => {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
};
const toHHmm = (t: string) => t.length === 5 ? t : t.slice(0,5); // "HH:mm:ss" -> "HH:mm"

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json();
    const body = normalizeBody(raw);

    const parsed = sSchema.safeParse(body);
    if (!parsed.success) {
      // 어떤 필드에서 막혔는지 첫 에러를 그대로 돌려 디버깅 용이
      const first = parsed.error.issues[0];
      return new NextResponse(
        `입력 형식이 올바르지 않습니다: ${first.path.join(".")} ${first.message}`,
        { status: 400 }
      );
    }

    let {
      hall_id, start_date, end_date, start_time, end_time,
      interval, byweekday, requester_name, phone, group_name, description
    } = parsed.data;

    const hallIdNum = Number(hall_id);
    if (Number.isNaN(hallIdNum)) {
      return new NextResponse("hall_id 형식이 올바르지 않습니다", { status: 400 });
    }

    // "HH:mm:ss"가 왔어도 DB 컬럼이 time without time zone(HH:mm:ss)이면 OK지만
    // 단일 예약과 동일하게 "HH:mm" 기준이면 아래로 통일
    start_time = toHHmm(start_time);
    end_time   = toHHmm(end_time);

    if (end_time <= start_time) {
      return new NextResponse("종료시간은 시작시간보다 늦어야 합니다", { status: 400 });
    }
    if (end_date < start_date) {
      return new NextResponse("종료일이 시작일보다 빠릅니다", { status: 400 });
    }

    // RRule 생성 (로컬 00:00~23:59:59)
    const dtStart = new Date(`${start_date}T00:00:00`);
    const dtUntil = new Date(`${end_date}T23:59:59`);
    const RR = [RRule.SU, RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA];

    const rrule = new RRule({
      freq: RRule.WEEKLY,
      interval,
      byweekday: byweekday.map(d => RR[d]),
      dtstart: dtStart,
      until: dtUntil
    });

    const dates = rrule.all();
    if (dates.length === 0) {
      return new NextResponse("선택한 기간/요일에 생성할 예약이 없습니다", { status: 400 });
    }

    // 충돌 검사: (start_time < new_end) AND (end_time > new_start)
    for (const dt of dates) {
      const day = fmtDateLocal(dt);
      const { data: conflicts, error: cErr } = await supabaseAdmin
        .from("bookings")
        .select("id")
        .eq("hall_id", hallIdNum)
        .eq("date", day)
        .lt("start_time", end_time)
        .gt("end_time", start_time);

      if (cErr) return new NextResponse(`충돌 검사 오류: ${cErr.message}`, { status: 500 });
      if (conflicts && conflicts.length > 0) {
        return new NextResponse(`충돌: ${day}에 기존 예약이 있습니다`, { status: 409 });
      }
    }

    // series 저장 (요일은 0~6로 저장)
    const { data: seriesRow, error: sErr } = await supabaseAdmin
      .from("series")
      .insert({
        hall_id: hallIdNum,
        start_date, end_date,
        start_time, end_time,
        interval,
        byweekday: byweekday,
        requester_name, phone, group_name, description
      })
      .select("id")
      .single();
    if (sErr) return new NextResponse(`반복예약 생성 오류: ${sErr.message}`, { status: 500 });

    const series_id = seriesRow!.id as string;

    // bookings 벌크 인서트
    const rows = dates.map(dt => ({
      hall_id: hallIdNum,
      date: fmtDateLocal(dt),
      start_time,
      end_time,
      requester_name, phone, group_name, description,
      is_series: true, series_id
    }));
    const { error: bErr } = await supabaseAdmin.from("bookings").insert(rows);
    if (bErr) return new NextResponse(`예약 생성 오류: ${bErr.message}`, { status: 500 });

    return new NextResponse(null, { status: 201 });
  } catch (e: any) {
    return new NextResponse(`서버 오류: ${e?.message ?? String(e)}`, { status: 500 });
  }
}
