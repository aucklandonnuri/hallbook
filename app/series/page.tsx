// app/series/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Hall = { id: string; name: string };
type Freq = "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "";

type Booking = {
  id: string | number;
  hall_id?: string | number;
  hall_name?: string;
  title?: string;
  applicant?: string | null;
  // 다양한 백엔드 스펙을 방어적으로 커버
  date?: string;                 // "YYYY-MM-DD"
  start?: string;                // "HH:mm" or "HH:mm:ss"
  end?: string;                  // "HH:mm" or "HH:mm:ss"
  start_time?: string;           // "HH:mm:ss"
  end_time?: string;             // "HH:mm:ss"
  start_datetime?: string;       // ISO
  end_datetime?: string;         // ISO
};

const TIME_OPTIONS = [
  "06:00","06:30","07:00","07:30","08:00","08:30",
  "09:00","09:30","10:00","10:30","11:00","11:30",
  "12:00","12:30","13:00","13:30","14:00","14:30",
  "15:00","15:30","16:00","16:30","17:00","17:30",
  "18:00","18:30","19:00","19:30","20:00","20:30",
  "21:00","21:30","22:00","22:30"
];

// ----- 유틸: "HH:mm" 또는 "HH:mm:ss"를 "HH:mm"으로 보이기 -----
function toHm(t?: string) {
  if (!t) return "";
  // "2025-10-11T09:00:00+13:00" 같은 ISO면 HH:mm 뽑기
  if (t.includes("T")) {
    const time = t.split("T")[1] || "";
    return time.slice(0,5);
  }
  // "HH:mm:ss" → "HH:mm"
  if (t.length >= 5) return t.slice(0,5);
  return t;
}

export default function SeriesPage() {
  // ===== 폼 상태 =====
  const [halls, setHalls] = useState<Hall[]>([]);
  const [loadingHalls, setLoadingHalls] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [date, setDate] = useState("");           // YYYY-MM-DD
  const [hallId, setHallId] = useState("");
  const [start, setStart] = useState("");         // HH:mm
  const [end, setEnd] = useState("");             // HH:mm
  const [freq, setFreq] = useState<Freq>("");

  const [occurrences, setOccurrences] = useState<number | "">("");
  const [until, setUntil] = useState("");         // YYYY-MM-DD

  const [applicant, setApplicant] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");         // 모임명
  const [memo, setMemo] = useState("");

  // ===== 당일 예약 현황 =====
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // 강제 리프레시 트리거

  // 홀 목록
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setLoadingHalls(true);
        const res = await fetch("/api/halls", { cache: "no-store" });
        if (!res.ok) throw new Error(`홀 목록 불러오기 실패: ${res.status}`);
        const rows: Hall[] = await res.json();
        if (!ignore) setHalls((rows ?? []).map(h => ({ id: String(h.id), name: h.name })));
      } catch (e: any) {
        toast.error(e?.message ?? "홀 목록을 불러오지 못했습니다");
      } finally {
        setLoadingHalls(false);
      }
    })();
    return () => { ignore = true; };
  }, []);

  // 당일 예약 현황 조회
  useEffect(() => {
    if (!date) { setBookings([]); return; }
    let ignore = false;
    (async () => {
      try {
        setLoadingBookings(true);
        // 백엔드가 date 필터만 받는 /api/bookings 를 가정.
        // hallId가 있으면 추가로 전달 (백엔드에서 무시하더라도 OK)
        const url = new URL("/api/bookings/by-date", window.location.origin);
        url.searchParams.set("date", date);
        if (hallId) url.searchParams.set("hall_id", hallId);

        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) throw new Error(`예약 현황 불러오기 실패: ${res.status}`);
        const rows: Booking[] = await res.json();
        if (!ignore) {
          // 시간 오름차순 정렬(가능한 키들에서 추출)
          const normalized = (rows ?? []).slice().sort((a, b) => {
            const as = toHm(a.start_time || a.start || a.start_datetime);
            const bs = toHm(b.start_time || b.start || b.start_datetime);
            return as.localeCompare(bs);
          });
          setBookings(normalized);
        }
      } catch (e: any) {
        // 현황 API가 아직 없더라도 페이지 기능에는 영향 X
        setBookings([]);
      } finally {
        setLoadingBookings(false);
      }
    })();
    return () => { ignore = true; };
  }, [date, hallId, refreshKey]);

  // ===== 검증 =====
  const trimmedTitle = useMemo(() => title.trim(), [title]);

  const flags = useMemo(() => {
    const missingDate = !date;
    const missingHall = !hallId;
    const missingStart = !start;
    const missingEnd = !end;
    const timeOrderBad = !!start && !!end && start >= end;
    const missingFreq = !freq;
    const missingTitle = !trimmedTitle;
    const untilOrderBad = !!until && !!date && until < date;
    return { missingDate, missingHall, missingStart, missingEnd, timeOrderBad, missingFreq, missingTitle, untilOrderBad };
  }, [date, hallId, start, end, freq, trimmedTitle, until]);

  const isBasicValid = useMemo(() => {
    const { missingDate, missingHall, missingStart, missingEnd, timeOrderBad, missingFreq, missingTitle, untilOrderBad } = flags;
    if (missingDate || missingHall || missingStart || missingEnd || missingFreq || missingTitle) return false;
    if (timeOrderBad || untilOrderBad) return false;
    return true;
  }, [flags]);

  // ===== 제출 =====
  async function handleSubmit() {
    try {
      if (!isBasicValid) {
        toast.error("필수 항목을 확인해주세요 (날짜, 홀, 시작/종료, 주기, 모임명)");
        return;
      }
      setSubmitting(true);

      const payload = {
        hall_id: hallId,
        start_date: date,                // "YYYY-MM-DD"
        start_time: `${start}:00`,       // "HH:mm:ss"
        end_time: `${end}:00`,           // "HH:mm:ss"
        applicant: applicant || null,
        phone: phone || null,
        title: trimmedTitle,
        description: memo || null,
        freq,                            // "WEEKLY" | "FORTNIGHTLY" | "MONTHLY"
        occurrences: occurrences === "" ? null : Number(occurrences),
        until: until || null,            // "YYYY-MM-DD"
      };

      const res = await fetch("/api/bookings/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `반복 예약 등록 실패 (${res.status})`);
      }

      toast.success("반복 예약이 등록되었습니다");
      // 등록된 첫 발생(시작 날짜)이 오늘 카드에 보이도록 현황 새로고침
      setRefreshKey(k => k + 1);
    } catch (e: any) {
      toast.error(e?.message ?? "반복 예약 등록 중 오류가 발생했습니다");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-container space-y-4 pb-24">
      <div className="card space-y-4">
        <h1 className="text-xl font-bold">반복 예약</h1>

        <div className="grid grid-cols-1 gap-3">
          {/* 날짜 & 홀 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm mb-1">시작 날짜</label>
              <input type="date" className="w-full border rounded px-2 py-1"
                value={date} onChange={(e) => setDate(e.target.value)} />
              {!date && <p className="text-xs text-red-600 mt-1">날짜를 선택하세요.</p>}
            </div>
            <div>
              <label className="block text-sm mb-1">홀</label>
              <select className="w-full border rounded px-2 py-1"
                value={hallId} onChange={(e) => setHallId(e.target.value)} disabled={loadingHalls}>
                <option value="">--선택--</option>
                {halls.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
              {!hallId && <p className="text-xs text-red-600 mt-1">홀을 선택하세요.</p>}
            </div>
          </div>

          {/* 시간 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm mb-1">시작</label>
              <select className="w-full border rounded px-2 py-1"
                value={start} onChange={(e) => setStart(e.target.value)}>
                <option value="">--선택--</option>
                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {!start && <p className="text-xs text-red-600 mt-1">시작 시간을 선택하세요.</p>}
            </div>
            <div>
              <label className="block text-sm mb-1">종료</label>
              <select className="w-full border rounded px-2 py-1"
                value={end} onChange={(e) => setEnd(e.target.value)}>
                <option value="">--선택--</option>
                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {!end && <p className="text-xs text-red-600 mt-1">종료 시간을 선택하세요.</p>}
              {start && end && start >= end && (
                <p className="text-xs text-red-600 mt-1">종료 시간은 시작 시간보다 늦어야 합니다.</p>
              )}
            </div>
          </div>

          {/* 주기 & 종료조건 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm mb-1">주기</label>
              <select className="w-full border rounded px-2 py-1"
                value={freq} onChange={(e) => setFreq(e.target.value as Freq)}>
                <option value="">--선택--</option>
                <option value="WEEKLY">매주</option>
                <option value="FORTNIGHTLY">격주</option>
                <option value="MONTHLY">매월</option>
              </select>
              {!freq && <p className="text-xs text-red-600 mt-1">주기를 선택하세요.</p>}
            </div>
            <div>
              <label className="block text-sm mb-1">종료일</label>
              <input type="date" className="w-full border rounded px-2 py-1"
                value={until} onChange={(e) => setUntil(e.target.value)} />
              {until && date && until < date && (
                <p className="text-xs text-red-600 mt-1">종료일은 시작 날짜 이후여야 합니다.</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">횟수</label>
            <input type="number" min={1} className="w-full border rounded px-2 py-1" placeholder="예: 10"
              value={occurrences}
              onChange={(e) => {
                const v = e.target.value;
                setOccurrences(v === "" ? "" : Math.max(1, Number(v)));
              }}
            />
            <p className="text-xs text-gray-500 mt-1">
              종료일 또는 횟수 중 하나만 지정해도 됩니다. (둘 다 비워두면 서버 기본 규칙 적용)
            </p>
          </div>

          {/* 신청자/연락처/모임명/세부설명 */}
          <div>
            <label className="block text-sm mb-1">신청자명</label>
            <input placeholder="예: 홍길동" className="w-full border rounded px-2 py-1"
              value={applicant} onChange={(e) => setApplicant(e.target.value)} autoComplete="name" />
          </div>
          <div>
            <label className="block text-sm mb-1">연락처</label>
            <input placeholder="예: 021-123-4567" className="w-full border rounded px-2 py-1"
              value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </div>
          <div>
            <label className="block text-sm mb-1">모임명</label>
            <input placeholder="예: 청년부 소그룹" className="w-full border rounded px-2 py-1"
              value={title} onChange={(e) => setTitle(e.target.value)} />
            {!trimmedTitle && <p className="text-xs text-red-600 mt-1">모임명을 입력하세요.</p>}
          </div>
          <div>
            <label className="block text-sm mb-1">세부설명</label>
            <textarea rows={3} placeholder="필요 장비, 배치 등"
              className="w-full border rounded px-2 py-1"
              value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>

          <button className="bg-black text-white rounded px-3 py-2 disabled:opacity-50"
            disabled={!isBasicValid || submitting} onClick={handleSubmit}>
            반복 예약 등록
          </button>
        </div>
      </div>

      {/* ====== 해당 날짜 예약 현황 ====== */}
      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">해당 날짜 예약 현황</h2>
          <button
            className="text-sm underline disabled:opacity-50"
            onClick={() => setRefreshKey(k => k + 1)}
            disabled={!date || loadingBookings}
          >
            다시 불러오기
          </button>
        </div>

        {!date ? (
          <p className="text-sm text-gray-500">날짜를 선택하면 해당 날짜의 예약을 보여줍니다.</p>
        ) : loadingBookings ? (
          <p className="text-sm text-gray-500">불러오는 중…</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-gray-500">예약이 없습니다.</p>
        ) : (
          <ul className="divide-y">
            {bookings.map(b => {
              const startLabel = toHm(b.start_time || b.start || b.start_datetime);
              const endLabel = toHm(b.end_time || b.end || b.end_datetime);
              return (
                <li key={String(b.id)} className="py-2 flex items-center gap-3">
                  <span className="inline-block w-24 text-sm font-mono">{startLabel}–{endLabel}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{b.title || "(제목 없음)"}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {b.hall_name ? `홀: ${b.hall_name}` : b.hall_id ? `홀 #${b.hall_id}` : ""}
                      {b.applicant ? ` · 신청자: ${b.applicant}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
