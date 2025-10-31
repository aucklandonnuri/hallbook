"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Booking } from "@/lib/types";
import { toast } from "sonner";
import { format } from "date-fns";

export default function BookingPage() {
  // ===== 상태 =====
  const [apiHalls, setApiHalls] = useState<{ id: string; name: string }[]>([]);
  const [date, setDate] = useState<string>(() => format(new Date(), "yyyy-MM-dd"));
  const [form, setForm] = useState({
    hall_id: "",
    start_time: "",
    end_time: "",
    requester_name: "",
    phone: "",
    group_name: "",
    description: ""
  });
  const [loading, setLoading] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);

  // === 수정 관련 상태 ===
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    hall_id: "",
    date: "",
    start_time: "",
    end_time: "",
    requester_name: "",
    phone: "",
    group_name: "",
    description: ""
  });

  // ===== 유틸 =====
  // DB "HH:MM:SS" -> input[type=time] "HH:MM"
  function toTimeInputValue(t?: string | null) {
    if (!t) return "";
    const m = t.match(/^(\d{2}:\d{2})(?::\d{2})$/);
    return m ? m[1] : t; // 이미 HH:MM이면 그대로
  }
  // input "HH:MM" -> DB "HH:MM:SS"
  function toDBTimeValue(t?: string | null) {
    if (!t) return t || "";
    return /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : t;
  }

  // ===== 함수 =====
  const reloadHalls = async () => {
    try {
      const res = await fetch(`/api/halls?ts=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const rows: { id: string; name: string }[] = await res.json();

      setApiHalls(rows);
      // 현재 선택이 비었거나 목록에 없으면 첫 항목 자동 선택
      if (rows.length) {
        setForm((f) =>
          f.hall_id && rows.some((h) => h.id === f.hall_id)
            ? f
            : { ...f, hall_id: rows[0].id }
        );
      } else {
        setForm((f) => ({ ...f, hall_id: "" }));
      }
    } catch (e: any) {
      toast.error("홀 목록을 불러오지 못했어요");
    }
  };

  const loadBookingsForDate = async (d: string) => {
    const { data, error } = await supabase
      .from("bookings")
      .select("*, hall:halls(id,name)")
      .eq("date", d)
      .order("start_time", { ascending: true });

    if (error) {
      toast.error("예약 현황을 불러오지 못했어요");
      return;
    }
    setBookings(data ?? []);
  };

  const submit = async () => {
    if (!form.hall_id || !date || !form.start_time || !form.end_time || !form.requester_name) {
      toast.error("필수 항목을 채워주세요");
      return;
    }
    if (form.end_time <= form.start_time) {
      toast.error("종료시간은 시작시간보다 늦어야 합니다");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        date,
        // 서버 일관성 위해 초 보정
        start_time: toDBTimeValue(form.start_time),
        end_time: toDBTimeValue(form.end_time),
      })
    });
    setLoading(false);

    if (!res.ok) {
      toast.error((await res.text()) || "예약 생성 실패");
      return;
    }

    toast.success("예약이 등록되었습니다");
    await loadBookingsForDate(date);
  };

  const cancelBooking = async (id: string) => {
    if (!confirm("정말로 이 예약을 취소(삭제)할까요?")) return;

    setBookings((prev) => prev.filter((b) => String(b.id) !== String(id)));

    const res = await fetch(`/api/bookings/${id}`, { method: "DELETE" });
    if (!res.ok) {
      await loadBookingsForDate(date); // 복구
      const ct = res.headers.get("content-type") || "";
      let msg = "삭제 실패";
      if (ct.includes("application/json")) {
        const j = await res.json().catch(() => null);
        if (j?.error) msg = j.error;
      }
      toast.error(msg);
      return;
    }

    await loadBookingsForDate(date);
    toast.success("예약이 취소되었습니다");
  };

  // === 수정 열기 ===
  const openEdit = (b: Booking) => {
    setEditing(b);
    setEditForm({
      hall_id: String((b as any).hall_id ?? b.hall?.id ?? ""),
      date: b.date ?? date, // 없으면 현재 date 기본
      start_time: toTimeInputValue(b.start_time),
      end_time: toTimeInputValue(b.end_time),
      requester_name: (b as any).requester_name ?? "",
      phone: (b as any).phone ?? "",
      group_name: (b as any).group_name ?? "",
      description: (b as any).description ?? "",
    });

    // 홀 목록에 편의상 자동 보정
    if (
      apiHalls.length &&
      editForm.hall_id &&
      !apiHalls.some(h => h.id === String((b as any).hall_id ?? b.hall?.id ?? ""))
    ) {
      setEditForm(prev => ({ ...prev, hall_id: apiHalls[0].id }));
    }
    setEditOpen(true);
  };

  // === 수정 저장 ===
  const saveEdit = async () => {
    if (!editing) return;

    // 간단 유효성
    if (!editForm.hall_id || !editForm.date || !editForm.start_time || !editForm.end_time || !editForm.requester_name) {
      toast.error("필수 항목을 채워주세요");
      return;
    }
    if (editForm.end_time <= editForm.start_time) {
      toast.error("종료시간은 시작시간보다 늦어야 합니다");
      return;
    }

    setEditSaving(true);
    try {
      const payload = {
        hall_id: editForm.hall_id, // 서버에서 숫자 변환 및 검증
        date: editForm.date,
        start_time: toDBTimeValue(editForm.start_time),
        end_time: toDBTimeValue(editForm.end_time),
        requester_name: editForm.requester_name,
        phone: editForm.phone,
        group_name: editForm.group_name,
        description: editForm.description,
      };

      const res = await fetch(`/api/bookings/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || "수정 실패");
      }

      toast.success("예약이 수정되었습니다");
      setEditOpen(false);

      // 수정 후: 현재 화면의 날짜를 기준으로 목록 갱신
      await loadBookingsForDate(date);
    } catch (err: any) {
      toast.error(err.message ?? "수정 실패");
    } finally {
      setEditSaving(false);
    }
  };

  // ===== 효과 =====
  useEffect(() => {
    reloadHalls(); // 최초 1회 홀 로드
  }, []);

  useEffect(() => {
    loadBookingsForDate(date); // 날짜 바뀔 때 예약 로드
  }, [date]);

  // 시간 옵션 (06:00 ~ 22:30, 30분 단위)
  const timeOptions = useMemo(() => {
    const items: string[] = [];
    for (let h = 6; h <= 22; h++) {
      for (let m of [0, 30]) {
        items.push(`${String(h).padStart(2, "0")}:${m === 0 ? "00" : "30"}`);
      }
    }
    return items;
  }, []);

  // ===== UI =====
  return (
    <div className="space-y-4">
      {/* 단일 예약 폼 */}
      <div className="card space-y-4">
        <h1 className="text-xl font-bold">단일 예약</h1>

        <div className="grid grid-cols-1 gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm mb-1">날짜</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border rounded px-2 py-1"
              />
            </div>

            <div>
              <label className="block text-sm mb-1">홀</label>
              <select
                value={form.hall_id}
                onChange={(e) => setForm((f) => ({ ...f, hall_id: e.target.value }))}
                className="w-full border rounded px-2 py-1"
              >
                {apiHalls.length === 0 && <option value="">--선택--</option>}
                {apiHalls.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm mb-1">시작</label>
              <select
                value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                className="w-full border rounded px-2 py-1"
              >
                <option value="">--선택--</option>
                {timeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm mb-1">종료</label>
              <select
                value={form.end_time}
                onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                className="w-full border rounded px-2 py-1"
              >
                <option value="">--선택--</option>
                {timeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">신청자명</label>
            <input
              value={form.requester_name}
              onChange={(e) => setForm((f) => ({ ...f, requester_name: e.target.value }))}
              placeholder="예: 홍길동"
              className="w-full border rounded px-2 py-1"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">연락처</label>
            <input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="예: 021-123-4567"
              className="w-full border rounded px-2 py-1"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">모임명</label>
            <input
              value={form.group_name}
              onChange={(e) => setForm((f) => ({ ...f, group_name: e.target.value }))}
              placeholder="예: 청년부 소그룹"
              className="w-full border rounded px-2 py-1"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">세부설명</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="필요 장비, 배치 등"
              className="w-full border rounded px-2 py-1"
            />
          </div>

          <button
            onClick={submit}
            disabled={loading}
            className="bg-black text-white rounded px-3 py-2 disabled:opacity-50"
          >
            {loading ? "등록 중..." : "예약 등록"}
          </button>
        </div>
      </div>

      {/* 해당 날짜 예약 현황 + 수정/취소 버튼 */}
      <div className="card space-y-2">
        <h2 className="text-lg font-bold">해당 날짜 예약 현황</h2>
        {bookings.length === 0 && <p className="text-sm text-gray-500">예약이 없습니다.</p>}

        <ul className="divide-y">
          {bookings.map((b) => (
            <li key={b.id} className="py-2">
              <div className="flex items-center justify-between">
                <div className="font-semibold">
                  {b.hall?.name} · {b.start_time}–{b.end_time}
                </div>

                <div className="flex items-center gap-2">
                  {b.is_series && (
                    <span className="text-[10px] rounded bg-gray-100 px-2 py-1">반복</span>
                  )}
                  <button
                    onClick={() => openEdit(b)}
                    className="text-xs rounded bg-gray-700 text-white px-2 py-1 hover:bg-gray-800"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => cancelBooking(b.id)}
                    className="text-xs rounded bg-red-600 text-white px-2 py-1 hover:bg-red-700"
                  >
                    취소
                  </button>
                </div>
              </div>

              <div className="text-sm">
                { (b as any).group_name } — { (b as any).requester_name } ({ (b as any).phone })
              </div>
              {(b as any).description && (
                <div className="text-xs text-gray-600 mt-1">{(b as any).description}</div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* ====== 수정 다이얼로그 ====== */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setEditOpen(false)}
          />
          {/* panel */}
          <div className="relative z-10 w-full max-w-lg rounded-lg bg-white p-4 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold">예약 수정</h3>
              <button
                className="text-sm px-2 py-1 rounded border"
                onClick={() => setEditOpen(false)}
              >
                닫기
              </button>
            </div>

            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm mb-1">날짜</label>
                  <input
                    type="date"
                    value={editForm.date}
                    onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                    className="w-full border rounded px-2 py-1"
                  />
                </div>

                <div>
                  <label className="block text-sm mb-1">홀</label>
                  <select
                    value={editForm.hall_id}
                    onChange={(e) => setEditForm((f) => ({ ...f, hall_id: e.target.value }))}
                    className="w-full border rounded px-2 py-1"
                  >
                    {apiHalls.length === 0 && <option value="">--선택--</option>}
                    {apiHalls.map((h) => (
                      <option key={h.id} value={h.id}>{h.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm mb-1">시작</label>
                  <select
                    value={editForm.start_time}
                    onChange={(e) => setEditForm((f) => ({ ...f, start_time: e.target.value }))}
                    className="w-full border rounded px-2 py-1"
                  >
                    <option value="">--선택--</option>
                    {timeOptions.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm mb-1">종료</label>
                  <select
                    value={editForm.end_time}
                    onChange={(e) => setEditForm((f) => ({ ...f, end_time: e.target.value }))}
                    className="w-full border rounded px-2 py-1"
                  >
                    <option value="">--선택--</option>
                    {timeOptions.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm mb-1">신청자명</label>
                <input
                  value={editForm.requester_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, requester_name: e.target.value }))}
                  className="w-full border rounded px-2 py-1"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">연락처</label>
                <input
                  value={editForm.phone}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full border rounded px-2 py-1"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">모임명</label>
                <input
                  value={editForm.group_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, group_name: e.target.value }))}
                  className="w-full border rounded px-2 py-1"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">세부설명</label>
                <textarea
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full border rounded px-2 py-1"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setEditOpen(false)}
                  className="rounded border px-3 py-2"
                >
                  취소
                </button>
                <button
                  onClick={saveEdit}
                  disabled={editSaving}
                  className="bg-black text-white rounded px-3 py-2 disabled:opacity-50"
                >
                  {editSaving ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
