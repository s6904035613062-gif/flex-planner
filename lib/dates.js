// ชื่อวันภาษาไทย เรียง อา..ส (ตรงกับ Date.getDay() 0-6)
export const THAI_DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function pad(n) {
  return String(n).padStart(2, "0");
}

/** แปลง "YYYY-MM-DD" เป็น Date เวลาท้องถิ่น 00:00 (ไม่ใช้ new Date(str) เพราะจะถูกตีเป็น UTC) */
export function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toDate(value) {
  return typeof value === "string" ? parseDate(value) : new Date(value);
}

/** แปลง Date เป็น "YYYY-MM-DD" ตามเวลาท้องถิ่น */
export function toDateStr(date = new Date()) {
  const d = toDate(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** วันนี้เป็น "YYYY-MM-DD" */
export function todayStr() {
  return toDateStr(new Date());
}

/** บวก/ลบวัน รับ Date หรือ "YYYY-MM-DD" คืน Date ใหม่ */
export function addDays(value, days) {
  const d = toDate(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** เหมือน addDays แต่คืนเป็น "YYYY-MM-DD" */
export function addDaysStr(value, days) {
  return toDateStr(addDays(value, days));
}

/** ชื่อวันภาษาไทยแบบย่อ (อา จ อ พ พฤ ศ ส) */
export function thaiDayName(value) {
  return THAI_DAYS[toDate(value).getDay()];
}

/** จำนวนวันจาก a ถึง b (b - a) ตามวันปฏิทินท้องถิ่น */
export function diffDays(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / 86400000);
}
