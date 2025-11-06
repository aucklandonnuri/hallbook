import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ---------- Helpers ----------
const emptyToUndef = <T extends unknown>(v: T) =>
  (v === "" || v === null || v === undefined ? undefined : (v as T));

function normalizeTimeToHHMMSS(t?: string | null) {
  if (t == null || t === "") return undefined; // 빈 문자열은 업데이트 제외
  if (/^\d{2}:\d{2}$/.test(t)) return `${t}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(t)) return t;
  throw new Error("Invalid time format (expect HH:MM or HH:MM:SS)");
}
function normalizeHallId(h: unknown) {
  if (h == null || h === "") return undefined;      // 업데이트 제외
  if (typeof h === "number") return h;              // 숫자 허용
  if (typeof h === "string") return h.trim();       // 문자열(숫자/UUID) 모두 허용
  throw new Error("Invalid hall_id");               // 그 외 타입만 에러
}
function stripUndefined(obj: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// ---------- PATCH (update one) ----------
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id?.trim();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const body = await req.json();

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
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    // 최소 검증: 시작/종료 시간 역전 방지 (둘 다 있을 때만)
    if (updates.start_time && updates.end_time) {
      const d = (updates.date as string | undefined) ?? "1970-01-01";
      const s = new Date(`${d}T${updates.start_time as string}`);
      const e = new Date(`${d}T${updates.end_time as string}`);
      if (!(s instanceof Date) || isNaN(+s) || !(e instanceof Date) || isNaN(+e)) {
        return NextResponse.json({ error: "시간 형식이 올바르지 않습니다." }, { status: 400 });
      }
      if (e <= s) {
        return NextResponse.json({ error: "종료 시간이 시작 시간보다 같거나 빠릅니다." }, { status: 400 });
      }
    }

    // 주의: id는 문자열 그대로 비교 (기존 동작과 동일)
    const { data, error } = await supabaseAdmin
      .from("bookings")
      .update(updates)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(data);
  } catch (err: any) {
    console.error("[PATCH /bookings/:id]", err);
    return NextResponse.json({ error: err.message ?? "Update failed" }, { status: 400 });
  }
}

// ---------- DELETE (cancel one or series) ----------
// 단건 취소:    DELETE /api/bookings/:id
// 전체 시리즈:  DELETE /api/bookings/:id?mode=series
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id?.trim();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const url = new URL(req.url);
    const mode = url.searchParams.get("mode"); // "series" 이면 시리즈 전체 삭제

    if (mode === "series") {
      // 1) 대상 예약의 series_id 조회
      const { data: row, error: readErr } = await supabaseAdmin
        .from("bookings")
        .select("series_id")
        .eq("id", id)
        .single();
      if (readErr) return NextResponse.json({ error: readErr.message }, { status: 400 });
      if (!row?.series_id) {
        return NextResponse.json({ error: "시리즈 예약이 아닙니다." }, { status: 400 });
      }

      // 2) 같은 series_id 모두 삭제
      const { error: delErr } = await supabaseAdmin
        .from("bookings")
        .delete()
        .eq("series_id", row.series_id);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

      return NextResponse.json({ ok: true, deleted: "series" });
    }

    // 단건 삭제 (id는 문자열 그대로)
    const { error } = await supabaseAdmin
      .from("bookings")
      .delete()
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, deleted: "single" });
  } catch (e: any) {
    console.error("[DELETE /bookings/:id]", e);
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
