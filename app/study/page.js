"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { getOwnerKey } from "../../lib/ownerKey";
import { THAI_DAYS, todayStr, addDaysStr, parseDate, diffDays, thaiDayName } from "../../lib/dates";
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

/* ---------- อัลกอริทึม (คำนวณล้วน ไม่แตะฐานข้อมูล) ---------- */
function buildPlan({ subjects, dailyHours, doneByDate, today }) {
  const remaining = new Map(
    subjects.map((s) => [s.id, Math.max(0, Number(s.hours_needed) - Number(s.hours_done))])
  );
  const blocks = [];

  for (let i = 0; i < HORIZON_DAYS; i++) {
    const day = addDaysStr(today, i);
    let capacity = Math.floor(Number(dailyHours[parseDate(day).getDay()]) || 0) - (doneByDate[day] || 0);
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
async function generatePlan(ownerKey) {
  const today = todayStr();
  const [sub, set, blk] = await Promise.all([
    supabase.from("study_subjects").select("*").eq("owner_key", ownerKey).order("exam_date", { ascending: true }),
    supabase.from("study_settings").select("daily_hours").eq("owner_key", ownerKey).maybeSingle(),
    supabase.from("study_blocks").select("id, subject_id, plan_date, done").eq("owner_key", ownerKey),
  ]);
  for (const r of [sub, set, blk]) if (r.error) throw r.error;

  const subjects = sub.data;
  const dailyHours = normalizeHours(set.data?.daily_hours);
  const doneByDate = {};
  const oldOpen = [];
  for (const b of blk.data) {
    if (b.done) doneByDate[b.plan_date] = (doneByDate[b.plan_date] || 0) + 1;
    else if (b.plan_date >= today) oldOpen.push(b);
  }

  const { blocks, unscheduled } = buildPlan({ subjects, dailyHours, doneByDate, today });

  // ถ้าแผนเหมือนเดิมเป๊ะ ไม่ต้องเขียนฐานข้อมูลซ้ำ
  const sig = (arr) => arr.map((b) => `${b.plan_date}|${b.subject_id}`).sort().join(",");
  if (sig(blocks) !== sig(oldOpen)) {
    const del = await supabase
      .from("study_blocks")
      .delete()
      .eq("owner_key", ownerKey)
      .eq("done", false)
      .gte("plan_date", today);
    if (del.error) throw del.error;

    if (blocks.length > 0) {
      const ins = await supabase
        .from("study_blocks")
        .insert(blocks.map((b) => ({ ...b, owner_key: ownerKey, done: false })));
      if (ins.error) throw ins.error;
    }
  }
  return { unscheduled };
}

export default function StudyPage() {
  const [ownerKey, setOwnerKey] = useState(null);
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

  const lock = useRef({ promise: null, queued: false });
  const toggleChain = useRef(Promise.resolve());
  const today = todayStr();

  const loadData = useCallback(async (key) => {
    const [s, b] = await Promise.all([
      supabase.from("study_subjects").select("*").eq("owner_key", key)
        .order("exam_date", { ascending: true }).order("created_at", { ascending: true }),
      supabase.from("study_blocks").select("id, subject_id, plan_date, done").eq("owner_key", key)
        .gte("plan_date", todayStr()).order("plan_date", { ascending: true }),
    ]);
    if (s.error) throw s.error;
    if (b.error) throw b.error;
    setSubjects(s.data);
    setBlocks(b.data);
  }, []);

  // เรียกซ้อนได้: ถ้ากำลังจัดอยู่จะต่อคิวรอบใหม่ (กัน insert ซ้ำ) และคืน promise ที่จบเมื่อทุกรอบเสร็จ
  const regenerate = useCallback(() => {
    if (!ownerKey) return Promise.resolve();
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
          const r = await generatePlan(ownerKey);
          setUnscheduled(r.unscheduled);
          await loadData(ownerKey);
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
  }, [ownerKey, loadData]);

  useEffect(() => {
    setOwnerKey(getOwnerKey());
  }, []);

  useEffect(() => {
    if (!ownerKey) return;
    (async () => {
      const { data, error: e } = await supabase
        .from("study_settings").select("daily_hours").eq("owner_key", ownerKey).maybeSingle();
      if (e) setError(errText(e));
      else setDraft(normalizeHours(data?.daily_hours).map(String));
      await regenerate(); // จัดใหม่ทุกครั้งที่เปิดหน้า เพื่อเกลี่ยงานที่ค้าง
      setLoading(false);
    })();
  }, [ownerKey, regenerate]);

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
      owner_key: ownerKey, name, hours_needed: hours, hours_done: 0,
      exam_date: form.exam, difficulty: Number(form.difficulty),
    });
    if (err) return setError(errText(err));
    setForm({ name: "", hours: "", exam: "", difficulty: form.difficulty });
    await regenerate();
  }

  async function deleteSubject(s) {
    if (!window.confirm(`ลบวิชา "${s.name}" และตารางของวิชานี้ทั้งหมด?`)) return;
    try {
      const b = await supabase.from("study_blocks").delete().eq("owner_key", ownerKey).eq("subject_id", s.id);
      if (b.error) throw b.error;
      const d = await supabase.from("study_subjects").delete().eq("owner_key", ownerKey).eq("id", s.id);
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
      .upsert({ owner_key: ownerKey, daily_hours: hours }, { onConflict: "owner_key" });
    if (err) return setError(errText(err));
    setDraft(hours.map(String));
    setSaved(true);
    await regenerate();
  }

  async function resetAll() {
    if (!window.confirm("รีเซ็ตข้อมูลอ่านหนังสือทั้งหมด? วิชา ตาราง และเวลาว่างจะถูกลบและกู้คืนไม่ได้")) return;
    setBusy(true);
    try {
      if (lock.current.promise) await lock.current.promise; // รอรอบจัดตารางที่ค้างอยู่ให้จบก่อน
      await toggleChain.current;
      for (const table of ["study_blocks", "study_subjects", "study_settings"]) {
        const { error: err } = await supabase.from(table).delete().eq("owner_key", ownerKey);
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
      try { await loadData(ownerKey); } catch {}
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
        const u = await supabase.from("study_blocks").update({ done: next })
          .eq("owner_key", ownerKey).eq("id", block.id);
        if (u.error) throw u.error;
        const cur = await supabase.from("study_subjects").select("hours_done")
          .eq("owner_key", ownerKey).eq("id", block.subject_id).single();
        if (cur.error) throw cur.error;
        const h = await supabase.from("study_subjects")
          .update({ hours_done: Math.max(0, cur.data.hours_done + delta) })
          .eq("owner_key", ownerKey).eq("id", block.subject_id);
        if (h.error) throw h.error;
      } catch (err) {
        setError(errText(err));
        try { await loadData(ownerKey); } catch {}
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

  if (loading) return <main className="study"><p className="muted">กำลังโหลด…</p></main>;

  return (
    <main className="study">
      <header>
        <Link href="/" className="back">หน้าแรก</Link>
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

      <section aria-labelledby="h-data">
        <h2 id="h-data">จัดการข้อมูล</h2>
        <button type="button" className="danger" disabled={busy} onClick={resetAll}>รีเซ็ตข้อมูลทั้งหมด</button>
      </section>
    </main>
  );
}
