// app/api/bookings/[id]/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ---------- Helpers ----------
const emptyToUndef = <T extends unknown>(v: T) =>
  v === "" || v === null || v === undefined ? undefined : (v as T);

function normalizeTimeToHHMMSS(t?: string | null) {
  if (t == null || t === "") return undefined; // 빈 문자열은 업데이트 제외
  if (/^\d{2}:\d{2}$/.test(t)) return `${t}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(t)) return t;
  throw new Error("Invalid time format (expect HH:MM or HH:MM:SS)");
}

function normalizeHallId(h: unknown) {
  if (h == null || h === "") return undefined; // 업데이트 제외
  if (typeof h === "number") return h; // 숫자 허용
  if (typeof h === "string") return h.trim(); // 문자열(숫자/UUID) 모두 허용
  throw new Error("Invalid hall_id"); // 그 외 타입만 에러
}

function stripUndefined(obj: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// 동일 홀/날짜/시간대 겹침 여부 검사 (자기 자신 제외 가능)
async function hasTimeOverlap(args: {
  hall_id: number | string;
  date: string;
  start_time: string;
  end_time: string;
  excludeId?: string;
}) {
  const { hall_id, date, start_time, end_time, excludeId } = args;

  let query = supabaseAdmin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("hall_id", hall_id)
    .eq("date", date)
    // [start, end) 구간 겹침 조건
    .lt("start_time", end_time)
    .gt("end_time", start_time);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { count, error } = await query;
  if (error) throw error;

  return (count ?? 0) > 0;
}

// 예약 비밀번호 검증 헬퍼 (DELETE에서만 사용)
async function verifyBookingPassword(bookingId: string, edit_password: string) {
  if (!edit_password || typeof edit_password !== "string") {
    return { ok: false, message: "비밀번호가 필요합니다." };
  }

  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("id, edit_password_hash")
    .eq("id", bookingId)
    .single();

  if (error || !booking) {
    return { ok: false, message: "예약을 찾을 수 없습니다." };
  }

  if (!booking.edit_password_hash) {
    // 옛날에 비밀번호 없이 생성된 예약일 수도 있음
    return {
      ok: false,
      message:
        "이 예약은 비밀번호로 보호되지 않았습니다. 관리자에게 문의해주세요.",
    };
  }

  const match = await bcrypt.compare(edit_password, booking.edit_password_hash);
  if (!match) {
    return { ok: false, message: "비밀번호가 일치하지 않습니다." };
  }

  return { ok: true };
}

// ---------- PATCH (update one) ----------
export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/bookings/[id]">
) {
  try {
    const { id } = await ctx.params;
    const trimmedId = id?.trim();
    if (!trimmedId) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const body = await req.json();

    // 비밀번호 검증은 하지 않는다 (수정은 비번 없이 가능)

    // 프론트(editForm) 필드와 정합
    const candidate = {
      hall_id: normalizeHallId(body.hall_id),
      date: emptyToUndef(body.date), // YYYY-MM-DD
      start_time: normalizeTimeToHHMMSS(body.start_time),
      end_time: normalizeTimeToHHMMSS(body.end_time),

      requester_name: emptyToUndef(body.requester_name),
      phone: emptyToUndef(body.phone),
      group_name: emptyToUndef(body.group_name),
      description: emptyToUndef(body.description),
    };
    const updates = stripUndefined(candidate);
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    // 기존 예약 값 조회 (겹침 검사와 최종 값 계산용)
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("bookings")
      .select("hall_id, date, start_time, end_time")
      .eq("id", trimmedId)
      .single();

    if (readErr) {
      return NextResponse.json({ error: readErr.message }, { status: 400 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // 업데이트 이후 최종 값 계산 (업데이트 값 없으면 기존 값 사용)
    const effective = {
      hall_id: (updates.hall_id ?? existing.hall_id) as number | string,
      date: (updates.date ?? existing.date) as string,
      start_time: (updates.start_time ?? existing.start_time) as string,
      end_time: (updates.end_time ?? existing.end_time) as string,
    };

    // 최소 검증: 시작/종료 시간 역전 방지
    if (effective.start_time && effective.end_time) {
      const d = effective.date ?? "1970-01-01";
      const s = new Date(`${d}T${effective.start_time}`);
      const e = new Date(`${d}T${effective.end_time}`);
      if (!(s instanceof Date) || isNaN(+s) || !(e instanceof Date) || isNaN(+e)) {
        return NextResponse.json(
          { error: "시간 형식이 올바르지 않습니다." },
          { status: 400 }
        );
      }
      if (e <= s) {
        return NextResponse.json(
          { error: "종료 시간이 시작 시간보다 같거나 빠릅니다." },
          { status: 400 }
        );
      }
    }

    // 중복 예약(겹침) 체크
    const overlap = await hasTimeOverlap({
      hall_id: effective.hall_id,
      date: effective.date,
      start_time: effective.start_time,
      end_time: effective.end_time,
      excludeId: trimmedId, // 자기 자신은 제외
    });

    if (overlap) {
      return NextResponse.json(
        { error: "이미 해당 시간에 다른 예약이 있습니다." },
        { status: 400 }
      );
    }

    // 실제 업데이트 실행
    const { data, error } = await supabaseAdmin
      .from("bookings")
      .update(updates)
      .eq("id", trimmedId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    console.error("[PATCH /bookings/:id]", err);
    return NextResponse.json(
      { error: err.message ?? "Update failed" },
      { status: 400 }
    );
  }
}

// ---------- DELETE (cancel one or series) ----------
// 단건 취소:    DELETE /api/bookings/:id
// 전체 시리즈:  DELETE /api/bookings/:id?mode=series
export async function DELETE(
  req: Request,
  ctx: RouteContext<"/api/bookings/[id]">
) {
  try {
    const { id } = await ctx.params;
    const trimmedId = id?.trim();
    if (!trimmedId) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const url = new URL(req.url);
    const mode = url.searchParams.get("mode"); // "series" 이면 시리즈 전체 삭제

    // body가 없을 수도 있으므로 안전하게 처리
    const body = await req.json().catch(() => ({} as any));
    const { edit_password } = body ?? {};

    // 먼저 비밀번호 검증
    const verify = await verifyBookingPassword(trimmedId, edit_password);
    if (!verify.ok) {
      return NextResponse.json({ error: verify.message }, { status: 403 });
    }

    if (mode === "series") {
      // 1) 대상 예약의 series_id 조회
      const { data: row, error: readErr } = await supabaseAdmin
        .from("bookings")
        .select("series_id")
        .eq("id", trimmedId)
        .single();
      if (readErr) {
        return NextResponse.json({ error: readErr.message }, { status: 400 });
      }
      if (!row?.series_id) {
        return NextResponse.json(
          { error: "시리즈 예약이 아닙니다." },
          { status: 400 }
        );
      }

      // 2) 같은 series_id 모두 삭제
      const { error: delErr } = await supabaseAdmin
        .from("bookings")
        .delete()
        .eq("series_id", row.series_id);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 400 });
      }

      return NextResponse.json({ ok: true, deleted: "series" });
    }

    // 단건 삭제 (id는 문자열 그대로)
    const { error } = await supabaseAdmin
      .from("bookings")
      .delete()
      .eq("id", trimmedId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, deleted: "single" });
  } catch (e: any) {
    console.error("[DELETE /bookings/:id]", e);
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
