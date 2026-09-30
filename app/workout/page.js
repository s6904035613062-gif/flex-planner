"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { useSession } from "../../lib/useSession";
import { THAI_DAYS, todayStr, addDaysStr, parseDate, thaiDayName } from "../../lib/dates";
import GoogleNotice from "../../lib/GoogleNotice";
import { pushPlan, removeEvents, removeEventsOf, toIssue, bkkISO } from "../../lib/calendar";
import { buildIcs, downloadIcs } from "../../lib/ics";
import "./workout.css";

const DEFAULT_DAYS = [0, 1, 1, 0, 1, 1, 0];
const DEFAULT_MINUTES = 40;
const HORIZON_DAYS = 14;
const SUGGESTED = [
  { name: "คาร์ดิโอ", per_week: 2 },
  { name: "ท่อนบน", per_week: 2 },
  { name: "ท่อนล่าง", per_week: 1 },
];
const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

const fmtDate = (s) => {
  const d = parseDate(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
const clampMinutes = (v) => Math.min(300, Math.max(5, parseInt(v, 10) || DEFAULT_MINUTES));
const normalizeDays = (a) => (Array.isArray(a) && a.length === 7 ? a.map((v) => (v ? 1 : 0)) : DEFAULT_DAYS);
const normalizeSettings = (r) => ({
  days: normalizeDays(r?.days),
  minutes: r?.minutes ? clampMinutes(r.minutes) : DEFAULT_MINUTES,
  skipped: Array.isArray(r?.skipped_dates) ? r.skipped_dates : [],
});
const errText = (e) => `เกิดข้อผิดพลาด: ${e?.message || "ไม่ทราบสาเหตุ"}`;

const WORKOUT_START = "18:00"; // เวลาเริ่ม event ออกกำลังกายในปฏิทิน
const toMin = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/* ---------- อัลกอริทึม (คำนวณล้วน) ---------- */
function buildWorkoutPlan({ items, days, skipped, doneRows, today }) {
  const history = doneRows.map((r) => ({ date: r.plan_date, name: r.item_name }));
  const doneDates = new Set(doneRows.map((r) => r.plan_date));
  const result = [];
  if (items.length === 0) return result;

  for (let i = 0; i < HORIZON_DAYS; i++) {
    const day = addDaysStr(today, i);
    // เฉพาะวันที่เปิดไว้ ไม่ถูกข้าม และยังไม่มีรายการที่ทำเสร็จในวันนั้น
    if (!days[parseDate(day).getDay()] || skipped.includes(day) || doneDates.has(day)) continue;

    const from = addDaysStr(day, -7);
    const prior = history.filter((h) => h.date < day);
    const prev = prior.reduce((a, h) => (!a || h.date >= a.date ? h : a), null);

    // ห้ามซ้ำกับครั้งก่อนหน้าติดกัน (ถ้ามีเมนูมากกว่า 1)
    const cands = items.length > 1 && prev ? items.filter((it) => it.name !== prev.name) : items;

    let best = null;
    let bestScore = -Infinity;
    let bestLast = "";
    for (const it of cands) {
      const mine = prior.filter((h) => h.name === it.name);
      const count = mine.filter((h) => h.date >= from).length; // 7 วันก่อนหน้า
      const score = it.per_week - count;
      const last = mine.reduce((m, h) => (h.date > m ? h.date : m), "");
      // คะแนนเท่ากัน → เมนูที่ไม่ได้ทำมานานกว่าได้ก่อน
      if (score > bestScore || (score === bestScore && last < bestLast)) {
        best = it;
        bestScore = score;
        bestLast = last;
      }
    }
    result.push({ plan_date: day, item_name: best.name });
    history.push({ date: day, name: best.name });
  }
  return result;
}

/* ---------- generateWorkoutPlan: อ่านข้อมูลล่าสุด → คำนวณ → ลบ done=false ตั้งแต่วันนี้ → insert ชุดใหม่ ---------- */
async function generateWorkoutPlan() {
  const today = todayStr();
  const [it, st, pl] = await Promise.all([
    supabase.from("workout_items").select("id, name, per_week").order("id", { ascending: true }),
    supabase.from("workout_settings").select("days, minutes, skipped_dates").maybeSingle(),
    supabase.from("workout_plan").select("id, item_name, plan_date, done, light, google_event_id"),
  ]);
  for (const r of [it, st, pl]) if (r.error) throw r.error;

  const { days, skipped } = normalizeSettings(st.data);
  const doneRows = pl.data.filter((r) => r.done);
  const oldOpen = pl.data.filter((r) => !r.done && r.plan_date >= today);
  const lightByDate = {};
  for (const r of oldOpen) if (r.light) lightByDate[r.plan_date] = true; // คงสถานะ "เบา" ของวันเดิม

  const rows = buildWorkoutPlan({ items: it.data, days, skipped, doneRows, today }).map((r) => ({
    ...r,
    light: !!lightByDate[r.plan_date],
  }));

  const sig = (a) => a.map((r) => `${r.plan_date}|${r.item_name}|${r.light ? 1 : 0}`).sort().join(",");
  if (sig(rows) === sig(oldOpen)) return {};

  // แถวที่จะถูกลบ ถ้ามี event ในปฏิทินให้ลบด้วย
  let calendarIssue = null;
  const eventIds = oldOpen.map((r) => r.google_event_id).filter(Boolean);
  if (eventIds.length) {
    try {
      await removeEvents(eventIds);
    } catch (e) {
      const i = toIssue(e);
      calendarIssue = { ...i, msg: `${i.msg} — event เดิมบางรายการอาจยังค้างอยู่ในปฏิทิน` };
    }
  }

  const del = await supabase.from("workout_plan").delete().eq("done", false).gte("plan_date", today);
  if (del.error) throw del.error;
  if (rows.length > 0) {
    const ins = await supabase.from("workout_plan")
      .insert(rows.map((r) => ({ ...r, done: false })));
    if (ins.error) throw ins.error;
  }
  return { calendarIssue };
}

export default function WorkoutPage() {
  const { userId, loading: authLoading, signOut } = useSession();
  const [items, setItems] = useState([]);
  const [plan, setPlan] = useState([]);
  const [settings, setSettings] = useState({ days: DEFAULT_DAYS, minutes: DEFAULT_MINUTES, skipped: [] });
  const [draftDays, setDraftDays] = useState(DEFAULT_DAYS);
  const [draftMinutes, setDraftMinutes] = useState(String(DEFAULT_MINUTES));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ name: "", per_week: "2" });
  const [formError, setFormError] = useState("");
  const [gIssue, setGIssue] = useState(null);
  const [gInfo, setGInfo] = useState("");
  const [gBusy, setGBusy] = useState(false);

  const lock = useRef({ promise: null, queued: false });
  const today = todayStr();

  const loadData = useCallback(async () => {
    const [i, p] = await Promise.all([
      supabase.from("workout_items").select("id, name, per_week").order("id", { ascending: true }),
      supabase.from("workout_plan").select("id, item_name, plan_date, done, light, google_event_id")
        .gte("plan_date", addDaysStr(todayStr(), -365)).order("plan_date", { ascending: true }),
    ]);
    if (i.error) throw i.error;
    if (p.error) throw p.error;
    setItems(i.data);
    setPlan(p.data);
    return { items: i.data, plan: p.data };
  }, []);

  // เรียกซ้อนได้: ถ้ากำลังจัดอยู่จะต่อคิวรอบใหม่ กัน insert ซ้ำ
  const regenerate = useCallback(() => {
    if (!userId) return Promise.resolve();
    const l = lock.current;
    if (l.promise) {
      l.queued = true;
      return l.promise;
    }
    setBusy(true);
    l.promise = (async () => {
      try {
        do {
          l.queued = false;
          const r = await generateWorkoutPlan();
          if (r?.calendarIssue) setGIssue(r.calendarIssue);
          await loadData();
        } while (l.queued);
        setError("");
      } catch (e) {
        setError(errText(e));
      } finally {
        l.promise = null;
        setBusy(false);
      }
    })();
    return l.promise;
  }, [userId, loadData]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data, error: e } = await supabase.from("workout_settings")
        .select("days, minutes, skipped_dates").maybeSingle();
      if (e) setError(errText(e));
      else {
        const s = normalizeSettings(data);
        setSettings(s);
        setDraftDays(s.days);
        setDraftMinutes(String(s.minutes));
      }
      await regenerate();
      setLoading(false);
    })();
  }, [userId, regenerate]);

  async function persistSettings(next) {
    const { error: err } = await supabase.from("workout_settings").upsert(
      { days: next.days, minutes: next.minutes, skipped_dates: next.skipped },
      { onConflict: "user_id" }
    );
    if (err) {
      setError(errText(err));
      return false;
    }
    setSettings(next);
    return true;
  }

  async function saveSettings() {
    const minutes = clampMinutes(draftMinutes);
    const ok = await persistSettings({
      days: draftDays,
      minutes,
      skipped: settings.skipped.filter((d) => d >= today),
    });
    if (!ok) return;
    setDraftMinutes(String(minutes));
    setSaved(true);
    await regenerate();
  }

  async function skipDay(date) {
    const skipped = [...new Set([...settings.skipped.filter((d) => d >= today), date])];
    if (await persistSettings({ ...settings, skipped })) await regenerate();
  }

  async function unskipDay(date) {
    const skipped = settings.skipped.filter((d) => d >= today && d !== date);
    if (await persistSettings({ ...settings, skipped })) await regenerate();
  }

  async function addItem(name, perWeek) {
    const { error: err } = await supabase.from("workout_items").insert({ name, per_week: perWeek });
    if (err) throw err;
  }

  async function submitItem(e) {
    e.preventDefault();
    const name = form.name.trim();
    const n = Number(form.per_week);
    if (!name) return setFormError("กรอกชื่อเมนู");
    if (items.some((i) => i.name.toLowerCase() === name.toLowerCase())) return setFormError("มีเมนูนี้อยู่แล้ว");
    if (!Number.isInteger(n) || n < 1 || n > 7) return setFormError("จำนวนครั้งต่อสัปดาห์ต้องเป็น 1–7");
    setFormError("");
    try {
      await addItem(name, n);
    } catch (err) {
      return setError(errText(err));
    }
    setForm({ name: "", per_week: form.per_week });
    await regenerate();
  }

  async function useSuggested() {
    try {
      const { error: err } = await supabase.from("workout_items")
        .insert(SUGGESTED);
      if (err) throw err;
    } catch (err) {
      return setError(errText(err));
    }
    await regenerate();
  }

  async function deleteItem(it) {
    if (!window.confirm(`ลบเมนู "${it.name}"?`)) return;
    const { error: err } = await supabase.from("workout_items").delete().eq("id", it.id);
    if (err) return setError(errText(err));
    await regenerate();
  }

  async function dropEvents(table, match) {
    try {
      await removeEventsOf(table, match);
    } catch (e) {
      const i = toIssue(e);
      setGIssue({ ...i, msg: `${i.msg} — event ในปฏิทินอาจยังค้างอยู่` });
    }
  }

  const eventOf = (r) => {
    const mins = r.light ? Math.round(settings.minutes / 2) : settings.minutes;
    const start = toMin(WORKOUT_START);
    return {
      title: `🏃 ${r.item_name}`,
      startISO: bkkISO(r.plan_date, start),
      endISO: bkkISO(r.plan_date, start + mins),
    };
  };

  async function sendToCalendar() {
    setGIssue(null);
    setGInfo("");
    setGBusy(true);
    try {
      if (lock.current.promise) await lock.current.promise;
      const fresh = await loadData();
      const rows = fresh.plan.filter((r) => !r.done && r.plan_date >= today);
      if (rows.length === 0) return setGInfo("ยังไม่มีรายการให้ส่งเข้าปฏิทิน");
      const { created } = await pushPlan({ table: "workout_plan", rows, toEvent: eventOf });
      await loadData();
      setGInfo(`ส่งเข้า Google Calendar แล้ว ${created} รายการ (เริ่มเวลา ${WORKOUT_START} น.)`);
    } catch (e) {
      setGIssue(toIssue(e));
      try { await loadData(); } catch {}
    } finally {
      setGBusy(false);
    }
  }

  function exportIcs() {
    const rows = plan.filter((r) => !r.done && r.plan_date >= today);
    if (rows.length === 0) return setGInfo("ยังไม่มีแผนให้ส่งออก");
    setGInfo("");
    downloadIcs("flex-workout-plan.ics", buildIcs(rows.map((r) => ({ uid: `workout-${r.id}@flex-planner`, date: r.plan_date, ...eventOf(r) }))));
  }

  async function resetAll() {
    if (!window.confirm("รีเซ็ตข้อมูลออกกำลังกายทั้งหมด? เมนู ตาราง และการตั้งค่าจะถูกลบและกู้คืนไม่ได้")) return;
    setBusy(true);
    try {
      if (lock.current.promise) await lock.current.promise; // รอรอบจัดตารางที่ค้างอยู่ให้จบก่อน
      await dropEvents("workout_plan", {});
      for (const table of ["workout_plan", "workout_items", "workout_settings"]) {
        const { error: err } = await supabase.from(table).delete().eq("user_id", userId);
        if (err) throw err;
      }
      setItems([]);
      setPlan([]);
      setSettings({ days: DEFAULT_DAYS, minutes: DEFAULT_MINUTES, skipped: [] });
      setDraftDays(DEFAULT_DAYS);
      setDraftMinutes(String(DEFAULT_MINUTES));
      setSaved(false);
      setError("");
    } catch (err) {
      setError(errText(err));
      try { await loadData(); } catch {}
    } finally {
      setBusy(false);
    }
  }

  async function updateRow(row, patch) {
    setPlan((p) => p.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    const { error: err } = await supabase.from("workout_plan").update(patch).eq("id", row.id);
    if (err) {
      setError(errText(err));
      try { await loadData(); } catch {}
    }
  }

  const days = useMemo(() => {
    const map = new Map();
    for (const r of plan) {
      if (r.plan_date < today) continue;
      if (!map.has(r.plan_date)) map.set(r.plan_date, []);
      map.get(r.plan_date).push(r);
    }
    return [...map.entries()];
  }, [plan, today]);

  // สรุปสัปดาห์นี้ (อา–ส) และสตรีค: นับถอยหลังเฉพาะ "วันที่เปิดไว้" ที่ทำเสร็จติดกัน
  // วันที่เปิดไว้แต่ไม่มีรายการที่ติ๊กเสร็จ (พลาดหรือข้าม) จะตัดสตรีค ยกเว้นวันนี้ที่ยังไม่ทำและไม่ได้ข้าม
  const stats = useMemo(() => {
    const weekStart = addDaysStr(today, -parseDate(today).getDay());
    const weekEnd = addDaysStr(weekStart, 6);
    const week = plan.filter((r) => r.plan_date >= weekStart && r.plan_date <= weekEnd);
    const doneDates = new Set(plan.filter((r) => r.done).map((r) => r.plan_date));
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = addDaysStr(today, -i);
      if (!settings.days[parseDate(d).getDay()]) continue;
      if (doneDates.has(d)) streak++;
      else if (i === 0 && !settings.skipped.includes(d)) continue;
      else break;
    }
    return { done: week.filter((r) => r.done).length, total: week.length, streak };
  }, [plan, settings, today]);

  const upcomingSkipped = settings.skipped.filter((d) => d >= today).sort();
  const half = Math.round(settings.minutes / 2);

  if (authLoading || !userId || loading) return <main className="workout"><p className="muted">กำลังโหลด…</p></main>;

  return (
    <main className="workout">
      <header>
        <div className="topbar">
          <Link href="/" className="back">หน้าแรก</Link>
          <button type="button" className="ghost" onClick={signOut}>ออกจากระบบ</button>
        </div>
        <h1>ตารางออกกำลังกาย</h1>
        {busy && <p className="muted" role="status">กำลังจัดตาราง…</p>}
      </header>

      {items.length > 0 && (
        <section className="summary" aria-label="สรุปสัปดาห์นี้">
          <p className="summary-main">สัปดาห์นี้ทำแล้ว {stats.done} จาก {stats.total} ครั้ง</p>
          <p className="muted">สตรีค: ออกกำลังกายตามแผนติดต่อกัน {stats.streak} วัน</p>
        </section>
      )}

      {error && <div className="banner error" role="alert">{error}</div>}

      <section aria-labelledby="h-plan">
        <div className="section-head">
          <h2 id="h-plan">แผน 14 วันข้างหน้า</h2>
          <button type="button" className="ghost" disabled={busy} onClick={regenerate}>↻ จัดตารางใหม่</button>
        </div>
        <div className="actions">
          <button type="button" className="ghost" disabled={busy || gBusy} onClick={sendToCalendar}>ส่งแผนเข้า Google Calendar</button>
          <button type="button" className="ghost" onClick={exportIcs}>ส่งออก .ics</button>
        </div>
        <GoogleNotice issue={gIssue} />
        {gInfo && <p className="muted small" role="status">{gInfo}</p>}
        {items.length === 0 && <p className="muted">ยังไม่มีเมนู เพิ่มเมนูด้านล่างเพื่อเริ่มจัดตาราง</p>}
        {items.length > 0 && !settings.days.some(Boolean) && (
          <p className="muted">ยังไม่ได้เลือกวันที่ว่าง เลือกอย่างน้อย 1 วันด้านล่าง</p>
        )}
        {items.length > 0 && settings.days.some(Boolean) && days.length === 0 && (
          <p className="muted">ไม่มีวันที่ต้องออกกำลังกายใน 14 วันข้างหน้า</p>
        )}
        {days.map(([date, rows]) => {
          const isToday = date === today;
          const allDone = rows.every((r) => r.done);
          return (
            <div key={date} className={`day${isToday ? " today" : ""}`}>
              <div className="day-head">
                <strong>{isToday ? "วันนี้" : thaiDayName(date)}</strong>
                <span>{isToday ? `${thaiDayName(date)} ` : ""}{fmtDate(date)}</span>
                {!allDone && (
                  <button type="button" className="ghost" disabled={busy} onClick={() => skipDay(date)}>ข้ามวัน</button>
                )}
              </div>
              <ul>
                {rows.map((r) => (
                  <li key={r.id}>
                    <label className={r.done ? "done" : ""}>
                      <input type="checkbox" checked={r.done} disabled={busy} onChange={() => updateRow(r, { done: !r.done })} />
                      <span className="name">{r.item_name}</span>
                      <span className="meta">{r.light ? half : settings.minutes} นาที</span>
                      {r.light && <span className="tag">เบา</span>}
                    </label>
                    {!r.done && (
                      <button type="button" className="ghost" disabled={busy} onClick={() => updateRow(r, { light: !r.light })}>
                        {r.light ? "กลับเป็นปกติ" : "เหนื่อย→เบา"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section aria-labelledby="h-items">
        <h2 id="h-items">เมนูที่อยากเน้น</h2>
        {items.length === 0 && (
          <div className="card">
            <p className="muted">เริ่มจากเมนูแนะนำ: คาร์ดิโอ 2, ท่อนบน 2, ท่อนล่าง 1 ครั้งต่อสัปดาห์</p>
            <button type="button" className="primary" onClick={useSuggested}>ใช้เมนูแนะนำ</button>
          </div>
        )}
        {items.length > 0 && (
          <ul className="chips">
            {items.map((it) => (
              <li key={it.id} className="chip">
                <span>{it.name} · {it.per_week} ครั้ง/สัปดาห์</span>
                <button type="button" onClick={() => deleteItem(it)} aria-label={`ลบเมนู ${it.name}`}>ลบ</button>
              </li>
            ))}
          </ul>
        )}
        <form className="card form" onSubmit={submitItem}>
          <div className="row">
            <label>ชื่อเมนูหรือกล้ามเนื้อ
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={40} placeholder="เช่น หลัง" />
            </label>
            <label>ครั้งต่อสัปดาห์
              <input type="number" inputMode="numeric" min="1" max="7" step="1" value={form.per_week}
                onChange={(e) => setForm((f) => ({ ...f, per_week: e.target.value }))} />
            </label>
          </div>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <button type="submit" className="primary">เพิ่มเมนู</button>
        </form>
      </section>

      <section aria-labelledby="h-set">
        <h2 id="h-set">วันที่ว่างและเวลา</h2>
        <div className="card form">
          <div className="pills" role="group" aria-label="วันที่ว่างออกกำลังกาย">
            {THAI_DAYS.map((d, i) => (
              <button key={d} type="button" className={`pill${draftDays[i] ? " on" : ""}`} aria-pressed={!!draftDays[i]}
                onClick={() => { setSaved(false); setDraftDays((p) => p.map((v, j) => (j === i ? (v ? 0 : 1) : v))); }}>
                {d}
              </button>
            ))}
          </div>
          <label>เวลาต่อครั้ง (นาที)
            <input type="number" inputMode="numeric" min="5" max="300" step="5" value={draftMinutes}
              onChange={(e) => { setSaved(false); setDraftMinutes(e.target.value); }} />
          </label>
          <button type="button" className="primary" onClick={saveSettings}>บันทึกการตั้งค่า</button>
          {saved && !busy && <p className="muted small" role="status">บันทึกแล้ว</p>}
        </div>

        {upcomingSkipped.length > 0 && (
          <div className="card">
            <p className="small"><strong>วันที่ข้ามไว้</strong></p>
            <ul className="chips">
              {upcomingSkipped.map((d) => (
                <li key={d} className="chip">
                  <span>{thaiDayName(d)} {fmtDate(d)}</span>
                  <button type="button" onClick={() => unskipDay(d)}>ยกเลิกข้าม</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="h-data">
        <h2 id="h-data">จัดการข้อมูล</h2>
        <button type="button" className="danger" disabled={busy} onClick={resetAll}>รีเซ็ตข้อมูลทั้งหมด</button>
      </section>
    </main>
  );
}
