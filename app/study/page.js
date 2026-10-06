"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { useSession } from "../../lib/useSession";
import { THAI_DAYS, todayStr, addDaysStr, parseDate, diffDays, thaiDayName } from "../../lib/dates";
import GoogleNotice from "../../lib/GoogleNotice";
import { ENABLE_CALENDAR } from "../../lib/googleAuth";
import { getBusy, pushPlan, removeEvents, removeEventsOf, toIssue, bkkISO } from "../../lib/calendar";
import { buildIcs, downloadIcs } from "../../lib/ics";
import "./study.css";

const DEFAULT_HOURS = [0, 2, 2, 2, 2, 2, 3];
const HORIZON_DAYS = 28;
const DIFFICULTY = { 1: "ง่าย", 2: "กลาง", 3: "ยาก" };
const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

const fmtDate = (s) => {
  const d = parseDate(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
const clampHours = (v) => Math.min(24, Math.max(0, parseInt(v, 10) || 0));
const normalizeHours = (arr) =>
  Array.isArray(arr) && arr.length === 7 ? arr.map(clampHours) : DEFAULT_HOURS;
const errText = (e) => `เกิดข้อผิดพลาด: ${e?.message || "ไม่ทราบสาเหตุ"}`;

const DEFAULT_CAL = { ws: "16:00", we: "22:00", auto: false, slots: {}, hours: {} };
const toMin = (t) => {
  const [h, m] = String(t).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const normalizeCal = (c) => ({
  ...DEFAULT_CAL,
  ...(c && typeof c === "object" ? c : {}),
  slots: c?.slots || {},
  hours: c?.hours || {},
});
// หักช่วง busy ออกจากช่วงว่าง (ทั้งคู่เป็นอาร์เรย์ [เริ่ม, จบ] หน่วยนาที)
function subtractRanges(free, busy) {
  let out = free;
  for (const [bs, be] of busy) {
    const next = [];
    for (const [s, e] of out) {
      if (be <= s || bs >= e) next.push([s, e]);
      else {
        if (bs > s) next.push([s, bs]);
        if (be < e) next.push([be, e]);
      }
    }
    out = next;
  }
  return out;
}
const slotHours = (slots) => slots.reduce((n, [s, e]) => n + Math.floor((e - s) / 60), 0);

/* ---------- อัลกอริทึม (คำนวณล้วน ไม่แตะฐานข้อมูล) ---------- */
function buildPlan({ subjects, dailyHours, doneByDate, today, cal }) {
  const remaining = new Map(
    subjects.map((s) => [s.id, Math.max(0, Number(s.hours_needed) - Number(s.hours_done))])
  );
  const blocks = [];

  for (let i = 0; i < HORIZON_DAYS; i++) {
    const day = addDaysStr(today, i);
    // โหมดอัตโนมัติ: ใช้ชั่วโมงว่างรายวันจากปฏิทิน (ถ้ามีของวันนั้น) ไม่งั้นใช้ตามวันในสัปดาห์
    const dayHours = cal.auto && cal.hours[day] !== undefined ? cal.hours[day] : dailyHours[parseDate(day).getDay()];
    let capacity = Math.floor(Number(dayHours) || 0) - (doneByDate[day] || 0);
    const placed = new Map();

    while (capacity > 0) {
      let best = null;
      let bestScore = -1;
      for (const s of subjects) {
        const rem = remaining.get(s.id);
        if (rem <= 0 || day > s.exam_date) continue; // ห้ามวางหลังวันสอบ
        const daysLeft = Math.max(1, diffDays(day, s.exam_date) + 1);
        const score =
          (rem / daysLeft) * (1 + s.difficulty * 0.25) * Math.pow(0.6, placed.get(s.id) || 0);
        if (score > bestScore) {
          best = s;
          bestScore = score;
        }
      }
      if (!best) break;
      blocks.push({ subject_id: best.id, plan_date: day });
      remaining.set(best.id, remaining.get(best.id) - 1);
      placed.set(best.id, (placed.get(best.id) || 0) + 1);
      capacity--;
    }
  }

  // ชั่วโมงที่จัดไม่ทัน: นับเฉพาะวิชาที่วันสอบยังไม่ถึงและอยู่ในช่วง 28 วันที่จัดตาราง
  const lastDay = addDaysStr(today, HORIZON_DAYS - 1);
  let unscheduled = 0;
  for (const s of subjects) {
    if (s.exam_date >= today && s.exam_date <= lastDay) unscheduled += remaining.get(s.id);
  }
  return { blocks, unscheduled };
}

/* ---------- generatePlan: อ่านข้อมูลล่าสุด → คำนวณ → ลบ block ที่ยังไม่ทำ (อนาคต/วันนี้) → insert ชุดใหม่ ---------- */
async function generatePlan() {
  const today = todayStr();
  const [sub, set, blk] = await Promise.all([
    supabase.from("study_subjects").select("*").order("exam_date", { ascending: true }),
    supabase.from("study_settings").select("daily_hours, calendar").maybeSingle(),
    supabase.from("study_blocks").select("id, subject_id, plan_date, done, start_time, end_time, google_event_id"),
  ]);
  for (const r of [sub, set, blk]) if (r.error) throw r.error;

  const subjects = sub.data;
  const dailyHours = normalizeHours(set.data?.daily_hours);
  const cal = normalizeCal(set.data?.calendar);
  if (!ENABLE_CALENDAR) cal.auto = false; // ปิดปฏิทิน → ใช้เวลาว่างตามวันในสัปดาห์เสมอ
  const doneByDate = {};
  const oldOpen = [];
  for (const b of blk.data) {
    if (b.done) doneByDate[b.plan_date] = (doneByDate[b.plan_date] || 0) + 1;
    else if (b.plan_date >= today) oldOpen.push(b);
  }

  const { blocks, unscheduled } = buildPlan({ subjects, dailyHours, doneByDate, today, cal });

  // กำหนดเวลาเริ่ม-จบของแต่ละบล็อก: เรียงต่อกันในช่วงว่างของวันนั้น (หลบบล็อกที่ทำเสร็จแล้ว)
  const doneRanges = {};
  for (const b of blk.data) {
    if (b.done && b.start_time && b.end_time) (doneRanges[b.plan_date] ||= []).push([toMin(b.start_time), toMin(b.end_time)]);
  }
  const daySlots = {};
  for (const b of blocks) {
    const d = b.plan_date;
    if (!daySlots[d]) {
      const base = cal.auto && cal.slots[d] ? cal.slots[d] : [[toMin(cal.ws), 1440]];
      daySlots[d] = subtractRanges(base.map(([s, e]) => [s, e]), doneRanges[d] || []);
    }
    const slot = daySlots[d].find(([s, e]) => e - s >= 60);
    b.start_time = slot ? toHHMM(slot[0]) : null;
    b.end_time = slot ? toHHMM(slot[0] + 60) : null;
    if (slot) slot[0] += 60;
  }

  // ถ้าแผนเหมือนเดิมเป๊ะ ไม่ต้องเขียนฐานข้อมูลซ้ำ
  const sig = (arr) => arr.map((b) => `${b.plan_date}|${b.subject_id}|${b.start_time ?? ""}`).sort().join(",");
  let calendarIssue = null;
  if (sig(blocks) !== sig(oldOpen)) {
    // บล็อกที่จะถูกลบ ถ้ามี event ในปฏิทินให้ลบด้วย
    const eventIds = oldOpen.map((b) => b.google_event_id).filter(Boolean);
    if (eventIds.length) {
      try {
        await removeEvents(eventIds);
      } catch (e) {
        const i = toIssue(e);
        calendarIssue = { ...i, msg: `${i.msg} — event เดิมบางรายการอาจยังค้างอยู่ในปฏิทิน` };
      }
    }
    const del = await supabase
      .from("study_blocks")
      .delete()
      .eq("done", false)
      .gte("plan_date", today);
    if (del.error) throw del.error;

    if (blocks.length > 0) {
      const ins = await supabase
        .from("study_blocks")
        .insert(blocks.map((b) => ({ ...b, done: false })));
      if (ins.error) throw ins.error;
    }
  }
  return { unscheduled, calendarIssue };
}

export default function StudyPage() {
  const { userId, loading: authLoading, signOut } = useSession();
  const [subjects, setSubjects] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [draft, setDraft] = useState(DEFAULT_HOURS.map(String));
  const [unscheduled, setUnscheduled] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ name: "", hours: "", exam: "", difficulty: "2" });
  const [formError, setFormError] = useState("");
  const [cal, setCal] = useState(DEFAULT_CAL);
  const [gIssue, setGIssue] = useState(null);
  const [gInfo, setGInfo] = useState("");
  const [gBusy, setGBusy] = useState(false);

  const lock = useRef({ promise: null, queued: false });
  const toggleChain = useRef(Promise.resolve());
  const today = todayStr();

  const loadData = useCallback(async () => {
    const [s, b] = await Promise.all([
      supabase.from("study_subjects").select("*")
        .order("exam_date", { ascending: true }).order("created_at", { ascending: true }),
      supabase.from("study_blocks").select("id, subject_id, plan_date, done, start_time, end_time, google_event_id")
        .gte("plan_date", todayStr()).order("plan_date", { ascending: true }),
    ]);
    if (s.error) throw s.error;
    if (b.error) throw b.error;
    setSubjects(s.data);
    setBlocks(b.data);
    return { subjects: s.data, blocks: b.data };
  }, []);

  // เรียกซ้อนได้: ถ้ากำลังจัดอยู่จะต่อคิวรอบใหม่ (กัน insert ซ้ำ) และคืน promise ที่จบเมื่อทุกรอบเสร็จ
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
          const r = await generatePlan();
          setUnscheduled(r.unscheduled);
          if (r.calendarIssue) setGIssue(r.calendarIssue);
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
      const { data, error: e } = await supabase
        .from("study_settings").select("daily_hours, calendar").maybeSingle();
      if (e) setError(errText(e));
      else {
        setDraft(normalizeHours(data?.daily_hours).map(String));
        setCal(normalizeCal(data?.calendar));
      }
      await regenerate(); // จัดใหม่ทุกครั้งที่เปิดหน้า เพื่อเกลี่ยงานที่ค้าง
      setLoading(false);
    })();
  }, [userId, regenerate]);

  async function addSubject(e) {
    e.preventDefault();
    const name = form.name.trim();
    const hours = Number(form.hours);
    if (!name) return setFormError("กรอกชื่อวิชา");
    if (!Number.isInteger(hours) || hours < 1) return setFormError("จำนวนชั่วโมงต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
    if (!form.exam) return setFormError("เลือกวันสอบ");
    if (form.exam < today) return setFormError("วันสอบต้องเป็นวันนี้หรือหลังจากนี้");
    setFormError("");
    const { error: err } = await supabase.from("study_subjects").insert({
      name, hours_needed: hours, hours_done: 0,
      exam_date: form.exam, difficulty: Number(form.difficulty),
    });
    if (err) return setError(errText(err));
    setForm({ name: "", hours: "", exam: "", difficulty: form.difficulty });
    await regenerate();
  }

  async function deleteSubject(s) {
    if (!window.confirm(`ลบวิชา "${s.name}" และตารางของวิชานี้ทั้งหมด?`)) return;
    try {
      await dropEvents("study_blocks", { subject_id: s.id });
      const b = await supabase.from("study_blocks").delete().eq("subject_id", s.id);
      if (b.error) throw b.error;
      const d = await supabase.from("study_subjects").delete().eq("id", s.id);
      if (d.error) throw d.error;
    } catch (err) {
      return setError(errText(err));
    }
    await regenerate();
  }

  async function saveSettings() {
    const hours = draft.map(clampHours);
    const { error: err } = await supabase
      .from("study_settings")
      .upsert({ daily_hours: hours }, { onConflict: "user_id" });
    if (err) return setError(errText(err));
    setDraft(hours.map(String));
    setSaved(true);
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

  async function saveCal(next) {
    const { error: err } = await supabase
      .from("study_settings")
      .upsert({ daily_hours: draft.map(clampHours), calendar: next }, { onConflict: "user_id" });
    if (err) {
      setError(errText(err));
      return false;
    }
    setCal(next);
    return true;
  }

  async function saveCalendarSettings() {
    setGInfo("");
    if (await saveCal(cal)) await regenerate();
  }

  // ดึงเวลาว่างจาก Google Calendar 28 วัน → ช่วงว่างต่อวัน (หัก busy จากช่วงที่พร้อมอ่าน) → ปัดลงเป็นชั่วโมงเต็ม
  async function fetchFreeTime() {
    setGIssue(null);
    setGInfo("");
    const ws = toMin(cal.ws);
    const we = toMin(cal.we);
    if (we - ws < 60) return setGIssue({ msg: "ช่วงเวลาที่พร้อมอ่านต้องยาวอย่างน้อย 1 ชั่วโมง", reconnect: false });
    setGBusy(true);
    try {
      const busy = await getBusy(bkkISO(today, 0), bkkISO(addDaysStr(today, HORIZON_DAYS), 0));
      const nowD = new Date(Date.now() + 7 * 3600000);
      const nowMin = Math.ceil((nowD.getUTCHours() * 60 + nowD.getUTCMinutes()) / 15) * 15;
      const slots = {};
      const hours = {};
      for (let i = 0; i < HORIZON_DAYS; i++) {
        const day = addDaysStr(today, i);
        const dayStart = Date.parse(`${day}T00:00:00+07:00`);
        const lo = i === 0 ? Math.max(ws, nowMin) : ws; // วันนี้: ไม่จัดย้อนเวลาที่ผ่านไปแล้ว
        const ranges = busy.map((b) => [
          Math.round((Date.parse(b.start) - dayStart) / 60000),
          Math.round((Date.parse(b.end) - dayStart) / 60000),
        ]);
        const free = lo < we ? subtractRanges([[lo, we]], ranges) : [];
        slots[day] = free;
        hours[day] = slotHours(free);
      }
      if (await saveCal({ ...cal, auto: true, slots, hours })) {
        setGInfo("ดึงเวลาว่างแล้วและเปิดโหมดอัตโนมัติให้ ปรับตัวเลขรายวันได้ที่ส่วน Google Calendar ด้านล่าง");
        await regenerate();
      }
    } catch (e) {
      setGIssue(toIssue(e));
    } finally {
      setGBusy(false);
    }
  }

  const eventOf = (b, name) =>
    b.start_time && b.end_time
      ? { title: `📚 ${name}`, startISO: bkkISO(b.plan_date, toMin(b.start_time)), endISO: bkkISO(b.plan_date, toMin(b.end_time)) }
      : null;

  async function sendToCalendar() {
    setGIssue(null);
    setGInfo("");
    setGBusy(true);
    try {
      if (lock.current.promise) await lock.current.promise;
      const fresh = await loadData();
      const nameOf = new Map(fresh.subjects.map((s) => [s.id, s.name]));
      const rows = fresh.blocks.filter((b) => !b.done && b.plan_date >= today && nameOf.has(b.subject_id));
      if (rows.length === 0) return setGInfo("ยังไม่มีรายการให้ส่งเข้าปฏิทิน");
      const { created, skipped } = await pushPlan({
        table: "study_blocks",
        rows,
        toEvent: (b) => eventOf(b, nameOf.get(b.subject_id)),
      });
      await loadData();
      setGInfo(`ส่งเข้า Google Calendar แล้ว ${created} รายการ${skipped ? ` (ข้าม ${skipped} รายการที่ไม่มีเวลา)` : ""}`);
    } catch (e) {
      setGIssue(toIssue(e));
      try { await loadData(); } catch {}
    } finally {
      setGBusy(false);
    }
  }

  function exportIcs() {
    const nameOf = new Map(subjects.map((s) => [s.id, s.name]));
    const rows = blocks.filter((b) => !b.done && b.plan_date >= today && nameOf.has(b.subject_id));
    if (rows.length === 0) return setGInfo("ยังไม่มีแผนให้ส่งออก");
    setGInfo("");
    downloadIcs(
      "flex-study-plan.ics",
      buildIcs(rows.map((b) => ({ uid: `study-${b.id}@flex-planner`, date: b.plan_date, ...(eventOf(b, nameOf.get(b.subject_id)) || { title: `📚 ${nameOf.get(b.subject_id)}` }) })))
    );
  }

  async function resetAll() {
    if (!window.confirm("รีเซ็ตข้อมูลอ่านหนังสือทั้งหมด? วิชา ตาราง และเวลาว่างจะถูกลบและกู้คืนไม่ได้")) return;
    setBusy(true);
    try {
      if (lock.current.promise) await lock.current.promise; // รอรอบจัดตารางที่ค้างอยู่ให้จบก่อน
      await toggleChain.current;
      await dropEvents("study_blocks", {});
      for (const table of ["study_blocks", "study_subjects", "study_settings"]) {
        const { error: err } = await supabase.from(table).delete().eq("user_id", userId);
        if (err) throw err;
      }
      setSubjects([]);
      setBlocks([]);
      setDraft(DEFAULT_HOURS.map(String));
      setUnscheduled(0);
      setSaved(false);
      setError("");
    } catch (err) {
      setError(errText(err));
      try { await loadData(); } catch {}
    } finally {
      setBusy(false);
    }
  }

  // ติ๊ก/เอาติ๊กออก: อัปเดต block แล้วปรับ hours_done ±1 (ทำทีละรายการตามลำดับ กันแข่งกันเขียน)
  function toggleBlock(block) {
    const next = !block.done;
    const delta = next ? 1 : -1;
    setBlocks((p) => p.map((b) => (b.id === block.id ? { ...b, done: next } : b)));
    setSubjects((p) =>
      p.map((s) => (s.id === block.subject_id ? { ...s, hours_done: Math.max(0, s.hours_done + delta) } : s))
    );
    toggleChain.current = toggleChain.current.then(async () => {
      try {
        const u = await supabase.from("study_blocks").update({ done: next }).eq("id", block.id);
        if (u.error) throw u.error;
        const cur = await supabase.from("study_subjects").select("hours_done").eq("id", block.subject_id).single();
        if (cur.error) throw cur.error;
        const h = await supabase.from("study_subjects")
          .update({ hours_done: Math.max(0, cur.data.hours_done + delta) }).eq("id", block.subject_id);
        if (h.error) throw h.error;
      } catch (err) {
        setError(errText(err));
        try { await loadData(); } catch {}
      }
    });
  }

  const subjectIndex = useMemo(() => new Map(subjects.map((s, i) => [s.id, i])), [subjects]);
  const days = useMemo(() => {
    const map = new Map([[today, []]]);
    for (const b of blocks) {
      if (!subjectIndex.has(b.subject_id)) continue;
      if (!map.has(b.plan_date)) map.set(b.plan_date, []);
      map.get(b.plan_date).push(b);
    }
    for (const list of map.values()) {
      list.sort((a, b) => subjectIndex.get(a.subject_id) - subjectIndex.get(b.subject_id) || String(a.id).localeCompare(String(b.id)));
    }
    return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [blocks, subjectIndex, today]);

  const summary = useMemo(() => {
    let need = 0;
    let done = 0;
    let nearest = null;
    for (const s of subjects) {
      const n = Number(s.hours_needed);
      need += n;
      done += Math.min(Number(s.hours_done), n);
      if (s.exam_date >= today && (!nearest || s.exam_date < nearest.exam_date)) nearest = s;
    }
    return {
      need,
      done,
      pct: need > 0 ? Math.round((done / need) * 100) : 0,
      nearest,
      left: nearest ? diffDays(today, nearest.exam_date) : 0,
    };
  }, [subjects, today]);

  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (authLoading || !userId || loading) return <main className="study"><p className="muted">กำลังโหลด…</p></main>;

  return (
    <main className="study">
      <header>
        <div className="topbar">
          <Link href="/" className="back">หน้าแรก</Link>
          <button type="button" className="ghost" onClick={signOut}>ออกจากระบบ</button>
        </div>
        <h1>ตารางอ่านหนังสือ</h1>
        {busy && <p className="muted" role="status">กำลังจัดตาราง…</p>}
      </header>

      {subjects.length > 0 && (
        <section className="summary" aria-label="สรุปความคืบหน้า">
          <p className="summary-main">อ่านแล้ว {summary.done} จาก {summary.need} ชั่วโมง ({summary.pct}%)</p>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.pct} aria-label="ความคืบหน้ารวม">
            <span style={{ width: `${summary.pct}%` }} />
          </div>
          {summary.nearest && (
            <p className="muted small">
              {summary.left === 0
                ? `วันนี้สอบวิชาที่ใกล้ที่สุด (${summary.nearest.name})`
                : `เหลืออีก ${summary.left} วันถึงสอบวิชาที่ใกล้ที่สุด (${summary.nearest.name})`}
            </p>
          )}
        </section>
      )}

      {error && <div className="banner error" role="alert">{error}</div>}
      {unscheduled > 0 && (
        <div className="banner warn" role="status">
          ยังจัดไม่ทัน {unscheduled} ชม. ก่อนวันสอบ เพิ่มเวลาว่างต่อวันหรือขยับวันสอบ
        </div>
      )}

      <section aria-labelledby="h-plan">
        <div className="section-head">
          <h2 id="h-plan">แผนของคุณ</h2>
          <button type="button" className="ghost" disabled={busy} onClick={regenerate}>↻ จัดตารางใหม่</button>
        </div>
        <div className="actions">
          {ENABLE_CALENDAR && (
            <button type="button" className="ghost" disabled={busy || gBusy} onClick={sendToCalendar}>ส่งแผนเข้า Google Calendar</button>
          )}
          <button type="button" className="ghost" onClick={exportIcs}>ส่งออก .ics</button>
        </div>
        <GoogleNotice issue={gIssue} />
        {gInfo && <p className="muted small" role="status">{gInfo}</p>}
        {subjects.length === 0 && <p className="muted">ยังไม่มีแผน เพิ่มวิชาด้านล่างเพื่อเริ่มจัดตาราง</p>}
        {subjects.length > 0 &&
          days.map(([date, list]) => {
            const isToday = date === today;
            const doneCount = list.filter((b) => b.done).length;
            return (
              <div key={date} className={`day${isToday ? " today" : ""}`}>
                <div className="day-head">
                  <strong>{isToday ? "วันนี้" : thaiDayName(date)}</strong>
                  <span>{isToday ? `${thaiDayName(date)} ` : ""}{fmtDate(date)}</span>
                  {list.length > 0 && <span className="count">{doneCount}/{list.length} ชม.</span>}
                </div>
                {list.length === 0 ? (
                  <p className="muted small">ไม่มีบล็อกอ่านหนังสือวันนี้</p>
                ) : (
                  <ul>
                    {list.map((b) => (
                      <li key={b.id}>
                        <label className={b.done ? "done" : ""}>
                          <input type="checkbox" checked={b.done} disabled={busy} onChange={() => toggleBlock(b)} />
                          <span>{subjects[subjectIndex.get(b.subject_id)].name}</span>
                          {b.start_time && <span className="time">{b.start_time}–{b.end_time}</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
      </section>

      <section aria-labelledby="h-sub">
        <h2 id="h-sub">วิชา</h2>
        <form className="card form" onSubmit={addSubject}>
          <label>ชื่อวิชา
            <input value={form.name} onChange={setF("name")} maxLength={60} placeholder="เช่น ฟิสิกส์" />
          </label>
          <div className="row">
            <label>ชั่วโมงที่ต้องอ่านทั้งหมด
              <input type="number" inputMode="numeric" min="1" step="1" value={form.hours} onChange={setF("hours")} />
            </label>
            <label>วันสอบ
              <input type="date" min={today} value={form.exam} onChange={setF("exam")} />
            </label>
          </div>
          <label>ระดับความยาก
            <select value={form.difficulty} onChange={setF("difficulty")}>
              <option value="1">ง่าย</option>
              <option value="2">กลาง</option>
              <option value="3">ยาก</option>
            </select>
          </label>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <button type="submit" className="primary">เพิ่มวิชา</button>
        </form>

        {subjects.map((s) => {
          const need = Number(s.hours_needed);
          const pct = Math.min(100, Math.round((s.hours_done / need) * 100));
          const left = diffDays(today, s.exam_date);
          return (
            <article key={s.id} className="card subject">
              <div className="subject-top">
                <h3>{s.name}</h3>
                <button type="button" className="danger" onClick={() => deleteSubject(s)} aria-label={`ลบวิชา ${s.name}`}>ลบ</button>
              </div>
              <p className="small">
                อ่านแล้ว {s.hours_done}/{need} ชม. · สอบ {fmtDate(s.exam_date)}{" "}
                {left < 0 ? "(สอบแล้ว)" : left === 0 ? "(วันนี้)" : `(อีก ${left} วัน)`} · ระดับ{DIFFICULTY[s.difficulty]}
              </p>
              <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`ความคืบหน้า ${s.name}`}>
                <span style={{ width: `${pct}%` }} />
              </div>
            </article>
          );
        })}
      </section>

      <section aria-labelledby="h-free">
        <h2 id="h-free">เวลาว่างต่อวัน (ชั่วโมง)</h2>
        <div className="card">
          <div className="week">
            {THAI_DAYS.map((d, i) => (
              <label key={d}>{d}
                <input
                  type="number" inputMode="numeric" min="0" max="24" step="1"
                  value={draft[i]}
                  onChange={(e) => { setSaved(false); setDraft((p) => p.map((v, j) => (j === i ? e.target.value : v))); }}
                />
              </label>
            ))}
          </div>
          <button type="button" className="primary" onClick={saveSettings}>บันทึกเวลาว่าง</button>
          {saved && !busy && <p className="muted small" role="status">บันทึกแล้ว</p>}
        </div>
      </section>

      {ENABLE_CALENDAR && (
      <section aria-labelledby="h-cal">
        <h2 id="h-cal">Google Calendar</h2>
        <div className="card form">
          <div className="row">
            <label>พร้อมอ่านตั้งแต่
              <input type="time" value={cal.ws} onChange={(e) => setCal((c) => ({ ...c, ws: e.target.value || c.ws }))} />
            </label>
            <label>พร้อมอ่านถึง
              <input type="time" value={cal.we} onChange={(e) => setCal((c) => ({ ...c, we: e.target.value || c.we }))} />
            </label>
          </div>
          <button type="button" className="ghost" disabled={busy || gBusy} onClick={fetchFreeTime}>
            {gBusy ? "กำลังทำงาน…" : "ดึงเวลาว่างจาก Google Calendar"}
          </button>
          <label className="switch">
            <input type="checkbox" checked={cal.auto} onChange={(e) => setCal((c) => ({ ...c, auto: e.target.checked }))} />
            ใช้เวลาว่างจาก Google Calendar อัตโนมัติ
          </label>
          {cal.auto && Object.keys(cal.hours).some((d) => d >= today) && (
            <details>
              <summary>ปรับชั่วโมงว่างรายวัน</summary>
              <div className="daygrid">
                {Object.keys(cal.hours).filter((d) => d >= today).sort().map((d) => (
                  <label key={d}>{thaiDayName(d)} {fmtDate(d)}
                    <input type="number" inputMode="numeric" min="0" max="24" step="1" value={cal.hours[d]}
                      onChange={(e) => setCal((c) => ({ ...c, hours: { ...c.hours, [d]: clampHours(e.target.value) } }))} />
                  </label>
                ))}
              </div>
            </details>
          )}
          <p className="muted small">เปลี่ยนช่วงเวลาที่พร้อมอ่านแล้ว ให้กดดึงเวลาว่างใหม่อีกครั้ง</p>
          <button type="button" className="primary" disabled={busy} onClick={saveCalendarSettings}>บันทึกการตั้งค่าปฏิทิน</button>
        </div>
      </section>
      )}

      <section aria-labelledby="h-data">
        <h2 id="h-data">จัดการข้อมูล</h2>
        <button type="button" className="danger" disabled={busy} onClick={resetAll}>รีเซ็ตข้อมูลทั้งหมด</button>
      </section>
    </main>
  );
}
