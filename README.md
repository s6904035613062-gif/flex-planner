# Flex Planner

เว็บตารางอ่านหนังสือและออกกำลังกายแบบไดนามิก
Next.js (App Router, JavaScript) + Supabase, deploy บน Vercel

## เวอร์ชัน

โปรเจกต์นี้ใช้ **Next.js เวอร์ชันล่าสุด** (Next.js 16.3.x ณ วันที่ 29 ก.ย. 2569 / 2026) คู่กับ React 19
ต้องใช้ Node.js 20.9 ขึ้นไป

`package.json` ตั้ง `"next": "^16.3.6"` เพื่อให้ `npm install` ดึง patch ล่าสุดเสมอ
(Next.js ประกาศ security release 16.3.7 ในวันที่ 30 ก.ย. 2026 — รัน `npm install` ใหม่หรือ `npm install next@latest` เพื่ออัปเดต)

## เริ่มใช้งาน

```bash
npm install
cp .env.local.example .env.local   # แล้วใส่ค่าจริงของ Supabase
npm run dev
```

เปิด http://localhost:3000

## Environment variables

| ชื่อ | ค่า |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL จาก Supabase (Settings → API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |

บน Vercel: Project Settings → Environment Variables แล้วเพิ่มสองตัวนี้ก่อน deploy

## โครงสร้างโปรเจกต์

```
app/            หน้าเว็บ (App Router)
lib/            supabaseClient, ownerKey, dates
```

- `lib/ownerKey.js` — `getOwnerKey()` สร้าง UUID ครั้งแรกแล้วเก็บใน localStorage ใช้แยกข้อมูลแต่ละคนโดยไม่ต้องล็อกอิน (เรียกฝั่ง client เท่านั้น เช่นใน `useEffect`)
- `lib/dates.js` — วันที่แบบ `YYYY-MM-DD` ตามเวลาท้องถิ่น, บวกวัน, ชื่อวันไทย (อา จ อ พ พฤ ศ ส)

## ตารางฐานข้อมูล (มีอยู่แล้วใน Supabase)

- `study_subjects` (id, owner_key, name, hours_needed, hours_done, exam_date, difficulty, created_at)
- `study_blocks` (id, owner_key, subject_id, plan_date, done)
- `study_settings` (owner_key, daily_hours jsonb ยาว 7 เรียง อา..ส)
- `workout_items` (id, owner_key, name, per_week)
- `workout_plan` (id, owner_key, item_name, plan_date, done, light)
- `workout_settings` (owner_key, days jsonb ยาว 7 เรียง อา..ส, minutes, skipped_dates jsonb)

ทุกตารางกรองข้อมูลด้วย `owner_key`
