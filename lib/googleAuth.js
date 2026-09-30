import { supabase } from "./supabaseClient";

export const CALENDAR_SCOPES =
  "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events";

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
    options: { redirectTo: window.location.origin, scopes: CALENDAR_SCOPES },
  });
  return error;
}
