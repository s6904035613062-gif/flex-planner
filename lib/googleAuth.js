import { supabase } from "./supabaseClient";

// สวิตช์เปิด/ปิดฟีเจอร์ Google Calendar ทั้งระบบ (false = ปิดชั่วคราว, เปลี่ยนเป็น true เพื่อเปิดกลับ)
export const ENABLE_CALENDAR = false;

export const CALENDAR_SCOPES =
  "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events";

// ปิดปฏิทิน = ล็อกอินพื้นฐาน (email/profile) เท่านั้น
export const OAUTH_SCOPES = ENABLE_CALENDAR ? CALENDAR_SCOPES : "email profile";

const TOKEN_KEY = "flex-google-token";
const RETURN_KEY = "flex-return";

/** เก็บ provider_token ลง sessionStorage (Supabase ไม่เก็บให้ถาวร) — เรียกทุกครั้งที่ได้ session ใหม่ */
export function captureGoogleToken(session) {
  const token = session?.provider_token;
  if (!token) return;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

/** คืน Google access token หรือ null ถ้ายังไม่ได้เชื่อมต่อ */
export async function getGoogleToken() {
  try {
    const { data } = await supabase.auth.getSession();
    captureGoogleToken(data.session);
  } catch {}
  try {
    return sessionStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function clearGoogleToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

/** ล็อกอินซ้ำเพื่อขอ token ใหม่ แล้วกลับมาหน้าเดิม (ผ่านหน้าแรก) — คืน error ถ้ามี */
export async function connectGoogle() {
  try {
    sessionStorage.setItem(RETURN_KEY, window.location.pathname);
  } catch {}
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin, scopes: OAUTH_SCOPES },
  });
  return error;
}
