import { supabase } from "./supabaseClient";
import { getGoogleToken, clearGoogleToken } from "./googleAuth";

const API = "https://www.googleapis.com/calendar/v3";
const RECONNECT_CODES = ["NOT_CONNECTED", "EXPIRED", "FORBIDDEN"];

export class GoogleError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** แปลง error เป็น { msg, reconnect } สำหรับแสดงผล (reconnect = ต้องแสดงปุ่มเชื่อมต่อ Google ใหม่) */
export function toIssue(e) {
  if (e instanceof GoogleError) return { msg: e.message, reconnect: RECONNECT_CODES.includes(e.code) };
  return { msg: `เกิดข้อผิดพลาด: ${e?.message || "ไม่ทราบสาเหตุ"}`, reconnect: false };
}

/** วันที่ "YYYY-MM-DD" + นาทีนับจากเที่ยงคืน (เวลา Asia/Bangkok, +07:00) → ISO string */
export function bkkISO(date, minutes) {
  const ms = Date.parse(`${date}T00:00:00+07:00`) + minutes * 60000;
  const d = new Date(ms + 7 * 3600000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00+07:00`;
}

async function gfetch(url, options = {}) {
  const token = await getGoogleToken();
  if (!token) throw new GoogleError("NOT_CONNECTED", "ยังไม่ได้เชื่อมต่อ Google Calendar กรุณาเชื่อมต่อก่อน");
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } catch {
    throw new GoogleError("OFFLINE", "เชื่อมต่ออินเทอร์เน็ตไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่อีกครั้ง");
  }
  if (res.status === 401) {
    clearGoogleToken();
    throw new GoogleError("EXPIRED", "การเชื่อมต่อ Google หมดอายุ กรุณาเชื่อมต่อใหม่");
  }
  if (res.status === 403) {
    throw new GoogleError("FORBIDDEN", "ไม่มีสิทธิ์เข้าถึง Google Calendar กรุณาเชื่อมต่อใหม่และอนุญาตสิทธิ์ปฏิทินให้ครบ");
  }
  return res;
}

function apiError(res) {
  return new GoogleError("API", `Google Calendar ตอบกลับผิดพลาด (รหัส ${res.status}) ลองใหม่อีกครั้ง`);
}

/** ช่วงไม่ว่างของปฏิทินหลัก: [{ start, end }] เป็น ISO string */
export async function getBusy(startISO, endISO) {
  const res = await gfetch(`${API}/freeBusy`, {
    method: "POST",
    body: JSON.stringify({ timeMin: startISO, timeMax: endISO, timeZone: "Asia/Bangkok", items: [{ id: "primary" }] }),
  });
  if (!res.ok) throw apiError(res);
  const data = await res.json();
  const cal = data.calendars?.primary;
  if (!cal || cal.errors?.length) throw new GoogleError("API", "อ่านปฏิทินหลักของคุณไม่ได้");
  return cal.busy || [];
}

/** สร้าง event ในปฏิทินหลัก คืน event id */
export async function createEvent({ title, startISO, endISO }) {
  const res = await gfetch(`${API}/calendars/primary/events`, {
    method: "POST",
    body: JSON.stringify({
      summary: title,
      start: { dateTime: startISO, timeZone: "Asia/Bangkok" },
      end: { dateTime: endISO, timeZone: "Asia/Bangkok" },
    }),
  });
  if (!res.ok) throw apiError(res);
  return (await res.json()).id;
}

/** ลบ event — 404/410 ถือว่าลบไปแล้ว */
export async function deleteEvent(eventId) {
  const res = await gfetch(`${API}/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw apiError(res);
}

async function inChunks(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

export async function removeEvents(ids) {
  await inChunks(ids, 5, deleteEvent);
}

/** ลบ event ทั้งหมดที่ผูกกับแถวในตาราง (กรองเพิ่มด้วย match เช่น { subject_id }) */
export async function removeEventsOf(table, match = {}) {
  let q = supabase.from(table).select("google_event_id").not("google_event_id", "is", null);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data, error } = await q;
  if (error) throw error;
  if (data?.length) await removeEvents(data.map((r) => r.google_event_id));
}

/**
 * ส่งแผนเข้าปฏิทิน: ลบ event เดิมของ rows → สร้างใหม่ตาม toEvent(row) → บันทึก google_event_id กลับลงตาราง
 * toEvent คืน null ถ้าแถวนั้นไม่มีเวลา (จะถูกข้าม)
 */
export async function pushPlan({ table, rows, toEvent }) {
  await inChunks(rows.filter((r) => r.google_event_id), 5, (r) => deleteEvent(r.google_event_id));
  let created = 0;
  let skipped = 0;
  await inChunks(rows, 5, async (r) => {
    const ev = toEvent(r);
    if (!ev) {
      skipped++;
      if (r.google_event_id) await supabase.from(table).update({ google_event_id: null }).eq("id", r.id);
      return;
    }
    const id = await createEvent(ev);
    const { error } = await supabase.from(table).update({ google_event_id: id }).eq("id", r.id);
    if (error) throw error;
    created++;
  });
  return { created, skipped };
}
