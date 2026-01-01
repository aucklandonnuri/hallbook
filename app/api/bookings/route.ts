// app/api/bookings/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function normTime(t: string) {
  if (/^\d{2}:\d{2}$/.test(t)) return `${t}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(t)) return t;
  throw new Error("시간 형식이 올바르지 않습니다(예: 09:30).");
}

function mapPgError(msg?: string) {
  // Postgrest가 message에 PG 코드/문구를 포함합니다.
  if (!msg) return "예약 생성에 실패했습니다.";
  if (msg.includes("23505") || msg.includes("duplicate key"))
    return "해당 시간대에 이미 예약이 있습니다.";
  if (msg.includes("23503"))
    return "존재하지 않는 홀(hall_id)입니다.";
  if (msg.includes("23502"))
    return "필수 값이 비어 있습니다.";
  if (msg.includes("22007"))
    return "시간/날짜 형식이 올바르지 않습니다.";
  return msg; // 기본은 원문 노출
}

// 동일 홀/날짜/시간대 겹침 여부 검사
async function hasTimeOverlap(args: {
  hall_id: number | string;
  date: string;
  start_time: string;
  end_time: string;
}) {
  const { hall_id, date, start_time, end_time } = args;

  const { count, error } = await supabaseAdmin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("hall_id", hall_id)
    .eq("date", date)
    // [start, end) 구간 겹침 조건
    .lt("start_time", end_time)
    .gt("end_time", start_time);

  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      hall_id,
      date,            // 'yyyy-MM-dd'
      start_time,      // 'HH:mm' or 'HH:mm:ss'
      end_time,        // 'HH:mm' or 'HH:mm:ss'
      requester_name,
      phone,
      group_name,
      description,
      // 새로 추가되는 필드들 (프론트에서 넘겨줄 예정)
      edit_password,
      edit_password_hint,
    } = body || {};

    if (!hall_id || !date || !start_time || !end_time || !requester_name) {
      return NextResponse.json(
        { error: "필수 항목이 누락되었습니다." },
        { status: 400 }
      );
    }

    const start = normTime(String(start_time));
    const end = normTime(String(end_time));
    if (end <= start) {
      return NextResponse.json(
        { error: "종료시간은 시작시간보다 늦어야 합니다." },
        { status: 400 }
      );
    }

    const hallIdValue = /^\d+$/.test(String(hall_id)) ? Number(hall_id) : hall_id;

    // ✅ 중복(겹침) 체크
    const overlap = await hasTimeOverlap({
      hall_id: hallIdValue,
      date,
      start_time: start,
      end_time: end,
    });

    if (overlap) {
      return NextResponse.json(
        { error: "이미 해당 시간에 다른 예약이 있습니다." },
        { status: 400 }
      );
    }

    // ✅ 비밀번호 해시 처리
    let edit_password_hash: string | null = null;

    if (typeof edit_password === "string" && edit_password.length > 0) {
      if (edit_password.length < 4) {
        return NextResponse.json(
          { error: "비밀번호는 최소 4자 이상 입력해주세요." },
          { status: 400 }
        );
      }
      edit_password_hash = await bcrypt.hash(edit_password, 10);
    }

    const { data, error } = await supabaseAdmin
      .from("bookings")
      .insert([
        {
          hall_id: hallIdValue,
          date,
          start_time: start,
          end_time: end,
          requester_name,
          phone: phone ?? "",
          group_name: group_name ?? "",
          description: description ?? "",
          is_series: false,
          // ✅ 새 컬럼들
          edit_password_hash,
          edit_password_hint: edit_password_hint ?? null,
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: mapPgError(error.message) },
        { status: 400 }
      );
    }

    // 비밀번호 / 해시는 응답에 포함하지 않는다
    return NextResponse.json({ ok: true, booking: data });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
