// app/api/bookings/series/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { RRule, Frequency } from "rrule"; // Frequency 추가

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function normalizeHallIdForDb(rawHallId: unknown): number | string {
  const s = String(rawHallId ?? "").trim();
  if (/^\d+$/.test(s)) return Number(s);
  return s;
}

function normalizeBody(raw: any) {
  const pick = (a: any, ...keys: string[]) => keys.find((k) => a?.[k] !== undefined) as string | undefined;

  const freqKey = pick(raw, "freq", "frequency"); // 'weekly' 또는 'monthly'
  const hallKey = pick(raw, "hall_id", "hallId");
  const sdKey = pick(raw, "start_date", "startDate");
  const edKey = pick(raw, "end_date", "endDate");
  const stKey = pick(raw, "start_time", "startTime");
  const etKey = pick(raw, "end_time", "endTime");
  const intKey = pick(raw, "interval", "intervalWeeks");
  const daysKey = pick(raw, "byweekday", "weekdays", "days");

  const trim = (v: any) => (typeof v === "string" ? v.trim() : v);

  let byweekday = raw?.[daysKey ?? ""] ?? [];
  if (!Array.isArray(byweekday)) byweekday = [];
  byweekday = byweekday.map((v: any) => Number(v)).filter((n: number) => n >= 0 && n <= 6);

  const normTime = (t: any) => {
    const s = String(t ?? "").trim();
    return s.length === 5 ? s : s.slice(0, 5); // HH:mm 강제
  };

  return {
    freq: trim(raw?.[freqKey ?? ""]) || "weekly", // 기본값 매주
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
    description: trim(raw?.description ?? ""),
  };
}

const sSchema = z.object({
  freq: z.enum(["weekly", "monthly"]),
  hall_id: z.union([z.coerce.number(), z.string()]),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  interval: z.coerce.number().int().min(1).default(1),
  byweekday: z.array(z.coerce.number().int().min(0).max(6)).nonempty(),
  requester_name: z.string().min(1),
  phone: z.string().optional().default(""),
  group_name: z.string().optional().default(""),
  description: z.string().optional().default(""),
});

const fmtDateLocal = (d: Date) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json();
    const body = normalizeBody(raw);
    const parsed = sSchema.safeParse(body);

    if (!parsed.success) return new NextResponse("입력 형식이 올바르지 않습니다", { status: 400 });

    let { freq, hall_id, start_date, end_date, start_time, end_time, interval, byweekday, requester_name, phone, group_name, description } = parsed.data;
    const hallIdValue = normalizeHallIdForDb(hall_id);

    const dtStart = new Date(`${start_date}T00:00:00`);
    const dtUntil = new Date(`${end_date}T23:59:59`);
    const RR_DAYS = [RRule.SU, RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA];

    const rrule = new RRule({
      freq: freq === "monthly" ? RRule.MONTHLY : RRule.WEEKLY,
      interval,
      byweekday: byweekday.map((d) => RR_DAYS[d]),
      dtstart: dtStart,
      until: dtUntil,
    });

    const dates = rrule.all();
    if (dates.length === 0) return new NextResponse("생성할 예약이 없습니다", { status: 400 });

    // 🔒 강화된 충돌 검사
    for (const dt of dates) {
      const day = fmtDateLocal(dt);
      const { data: conflicts } = await supabaseAdmin
        .from("bookings")
        .select("id, requester_name")
        .eq("hall_id", hallIdValue)
        .eq("date", day)
        .lt("start_time", end_time) // 기존 시작 < 새 종료
        .gt("end_time", start_time); // 기존 종료 > 새 시작

      if (conflicts && conflicts.length > 0) {
        return new NextResponse(`충돌 발생: ${day}에 '${conflicts[0].requester_name}'님의 예약이 이미 있습니다.`, { status: 409 });
      }
    }

    // Series 및 Bookings 저장 로직 (이하 기존과 동일하되 정확도 개선)
    const { data: seriesRow, error: sErr } = await supabaseAdmin
      .from("series")
      .insert({ hall_id: hallIdValue, start_date, end_date, start_time, end_time, interval, byweekday, requester_name, phone, group_name, description })
      .select("id").single();

    if (sErr) throw new Error(sErr.message);

    const rows = dates.map((dt) => ({
      hall_id: hallIdValue,
      date: fmtDateLocal(dt),
      start_time,
      end_time,
      requester_name,
      phone,
      group_name,
      description,
      is_series: true,
      series_id: seriesRow.id,
    }));

    const { error: bErr } = await supabaseAdmin.from("bookings").insert(rows);
    if (bErr) throw new Error(bErr.message);

    return new NextResponse("예약 성공", { status: 201 });
  } catch (e: any) {
    return new NextResponse(`서버 오류: ${e.message}`, { status: 500 });
  }
}