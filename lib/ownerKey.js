const STORAGE_KEY = "flex-planner-owner-key";

function generateUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // fallback สำหรับเบราว์เซอร์เก่า
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * คืน UUID ประจำเครื่อง/เบราว์เซอร์นี้ (สร้างครั้งแรก แล้วเก็บใน localStorage)
 * ใช้ในฝั่ง client เท่านั้น (เช่น ใน useEffect) — ฝั่ง server จะคืน null
 */
export function getOwnerKey() {
  if (typeof window === "undefined") return null;

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;

    const created = generateUuid();
    window.localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // localStorage ใช้ไม่ได้ (เช่น private mode) — คืนค่าชั่วคราวที่อยู่แค่ในหน้านี้
    if (!window.__flexOwnerKey) window.__flexOwnerKey = generateUuid();
    return window.__flexOwnerKey;
  }
}
