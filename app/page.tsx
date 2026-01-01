"use client";

// Vercel에서 매번 새로운 데이터를 가져오도록 강제하는 설정
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { useEffect, useMemo, useState, useCallback } from "react";
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
  function toTimeInputValue(t?: string | null) {
    if (!t) return "";
    const m = t.match(/^(\d{2}:\d{2})(?::\d{2})$/);
    return m ? m[1] : t;
  }
  function toDBTimeValue(t?: string | null) {
    if (!t) return t || "";
    return /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : t;
  }

  // ===== 데이터 로딩 (안정성 강화) =====
  const reloadHalls = useCallback(async () => {
    try {
      // 타임스탬프를 추가하여 Vercel 캐시를 완전히 무력화합니다.
      const res = await fetch(`/api/halls?t=${new Date().getTime()}`, { 
        cache: "no-store",
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      if (!res.ok) throw new Error("서버에서 홀 목록을 가져오지 못했습니다.");
      const rows = await res.json();
      
      if (Array.isArray(rows) && rows.length > 0) {
        setApiHalls(rows);
        setForm((f) => ({ ...f, hall_id: f.hall_id || rows[0].id }));
      }
    } catch (e: any) {
      console.error("Halls loading error:", e);
      // 토스트 메시지는 실서비스에서 방해될 수 있으니 콘솔로그로 대체하거나 한 번만 띄웁니다.
    }
  }, []);

  const loadBookingsForDate = useCallback(async (d: string) => {
    const { data, error } = await supabase
      .from("bookings")
      .select("*, hall:halls(id,name)")
      .eq("date", d)
      .order("start_time", { ascending: true });

    if (error) {
      console.error("Bookings load error:", error);
      return;
    }
    setBookings(data ?? []);
  }, []);

  // ===== 액션 함수들 =====
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
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          date,
          start_time: toDBTimeValue(form.start_time),
          end_time: toDBTimeValue(form.end_time),
        })
      });

      if (!res.ok) {
        const errMsg = await res.text();
        throw new Error(errMsg || "예약 생성 실패");
      }

      toast.success("예약이 등록되었습니다");
      await loadBookingsForDate(date);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const cancelBooking = async (id: string) => {
    if (!confirm("정말로 이 예약을 취소할까요?")) return;
    const res = await fetch(`/api/bookings/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("삭제 실패");
      return;
    }
    await loadBookingsForDate(date);
    toast.success("예약이 취소되었습니다");
  };

  const openEdit = (b: Booking) => {
    setEditing(b);
    setEditForm({
      hall_id: String((b as any).hall_id ?? b.hall?.id ?? ""),
      date: b.date ?? date,
      start_time: toTimeInputValue(b.start_time),
      end_time: toTimeInputValue(b.end_time),
      requester_name: (b as any).requester_name ?? "",
      phone: (b as any).phone ?? "",
      group_name: (b as any).group_name ?? "",
      description: (b as any).description ?? "",
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/bookings/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editForm,
          start_time: toDBTimeValue(editForm.start_time),
          end_time: toDBTimeValue(editForm.end_time),
        }),
      });
      if (!res.ok) throw new Error("수정 실패");
      toast.success("수정되었습니다");
      setEditOpen(false);
      await loadBookingsForDate(date);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setEditSaving(false);
    }
  };

  useEffect(() => {
    reloadHalls();
  }, [reloadHalls]);

  useEffect(() => {
    loadBookingsForDate(date);
  }, [date, loadBookingsForDate]);

  const timeOptions = useMemo(() => {
    const items: string[] = [];
    for (let h = 7; h <= 21; h++) {
      items.push(`${String(h).padStart(2, "0")}:00`);
      items.push(`${String(h).padStart(2, "0")}:30`);
    }
    return items;
  }, []);

  const checkIsReserved = (hallId: string, time: string) => {
    return bookings.find(b => {
      const bHallId = String((b as any).hall_id ?? b.hall?.id);
      const bStart = (b.start_time || "").slice(0, 5);
      const bEnd = (b.end_time || "").slice(0, 5);
      return bHallId === String(hallId) && time >= bStart && time < bEnd;
    });
  };

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-8 pb-20">
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">홀 예약 현황</h1>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border rounded-lg px-3 py-2 font-medium bg-white"
          />
        </div>

        <div className="border rounded-xl bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse table-fixed">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border-b p-2 sticky left-0 bg-gray-50 z-10 w-20">시간</th>
                  {apiHalls.map(hall => (
                    <th key={hall.id} className="border-b border-l p-2 min-w-[100px] truncate">{hall.name}</th>
                  ))}
                  {apiHalls.length === 0 && <th className="border-b p-4 text-gray-400">홀 정보를 불러오는 중...</th>}
                </tr>
              </thead>
              <tbody>
                {apiHalls.length > 0 && timeOptions.map(time => (
                  <tr key={time}>
                    <td className="border-b p-1 text-center font-medium sticky left-0 bg-white shadow-[1px_0_0_0_#e5e7eb]">{time}</td>
                    {apiHalls.map(hall => {
                      const reserved = checkIsReserved(hall.id, time);
                      return (
                        <td 
                          key={`${hall.id}-${time}`} 
                          className={`border-b border-l p-1 h-10 ${reserved ? (reserved.is_series ? 'bg-green-100' : 'bg-blue-100') : 'bg-white'}`}
                        >
                          {reserved && (
                            <div className="w-full h-full rounded flex items-center justify-center text-[9px] text-blue-800 font-medium overflow-hidden leading-tight text-center">
                              {reserved.requester_name}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 flex flex-wrap gap-4 text-[11px] border-t bg-gray-50">
            <div className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-100 border border-blue-300 rounded" /> 일반예약</div>
            <div className="flex items-center gap-1"><span className="w-3 h-3 bg-green-100 border border-green-300 rounded" /> 반복예약</div>
            <div className="flex items-center gap-1"><span className="w-3 h-3 bg-white border border-gray-300 rounded" /> 예약가능</div>
          </div>
        </div>
      </section>

      {/* 예약 신청 폼 */}
      <section className="card bg-gray-50 p-6 rounded-2xl shadow-inner border border-gray-200">
        <h2 className="text-xl font-bold mb-4">새 예약 신청</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-1">장소 선택</label>
              <select
                value={form.hall_id}
                onChange={(e) => setForm((f) => ({ ...f, hall_id: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 bg-white"
              >
                {apiHalls.length === 0 && <option value="">로딩 중...</option>}
                {apiHalls.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-semibold mb-1">시작</label>
                <select value={form.start_time} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} className="w-full border rounded-lg px-3 py-2 bg-white">
                  <option value="">선택</option>
                  {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">종료</label>
                <select value={form.end_time} onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} className="w-full border rounded-lg px-3 py-2 bg-white">
                  <option value="">선택</option>
                  {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <input value={form.requester_name} onChange={(e) => setForm((f) => ({ ...f, requester_name: e.target.value }))} placeholder="신청자명" className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div className="space-y-4">
            <input value={form.group_name} onChange={(e) => setForm((f) => ({ ...f, group_name: e.target.value }))} placeholder="모임명/목적" className="w-full border rounded-lg px-3 py-2" />
            <textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="추가 내용" className="w-full border rounded-lg px-3 py-2" />
            <button onClick={submit} disabled={loading} className="w-full bg-blue-600 text-white font-bold rounded-xl py-3 hover:bg-blue-700 disabled:opacity-50">
              {loading ? "등록 중..." : "예약 등록하기"}
            </button>
          </div>
        </div>
      </section>

      {/* 예약 내역 리스트 */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold">상세 내역</h2>
        <div className="grid gap-3">
          {bookings.map((b) => (
            <div key={b.id} className="border rounded-xl p-4 bg-white shadow-sm flex items-center justify-between">
              <div>
                <div className="font-bold">{b.hall?.name} | <span className="text-blue-600">{b.start_time?.slice(0,5)}~{b.end_time?.slice(0,5)}</span></div>
                <div className="text-sm text-gray-500">{b.group_name} ({b.requester_name})</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(b)} className="px-3 py-1 bg-gray-100 rounded-md text-sm">수정</button>
                <button onClick={() => cancelBooking(b.id)} className="px-3 py-1 bg-red-50 text-red-600 rounded-md text-sm">취소</button>
              </div>
            </div>
          ))}
          {bookings.length === 0 && <p className="text-center py-10 text-gray-400">예약 내역이 없습니다.</p>}
        </div>
      </section>

      {/* 수정 모달 (동일) */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-bold">예약 수정</h3>
            <input type="date" value={editForm.date} onChange={(e) => setEditForm(f => ({...f, date: e.target.value}))} className="w-full border rounded-lg px-3 py-2" />
            <div className="grid grid-cols-2 gap-2">
              <select value={editForm.start_time} onChange={(e) => setEditForm(f => ({...f, start_time: e.target.value}))} className="border rounded-lg px-3 py-2">
                {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={editForm.end_time} onChange={(e) => setEditForm(f => ({...f, end_time: e.target.value}))} className="border rounded-lg px-3 py-2">
                {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <input value={editForm.requester_name} onChange={(e) => setEditForm(f => ({...f, requester_name: e.target.value}))} placeholder="신청자명" className="w-full border rounded-lg px-3 py-2" />
            <div className="flex gap-2">
              <button onClick={() => setEditOpen(false)} className="flex-1 py-2 border rounded-lg">취소</button>
              <button onClick={saveEdit} disabled={editSaving} className="flex-1 py-2 bg-black text-white rounded-lg">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  
}
