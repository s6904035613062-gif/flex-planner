# Flex Planner

เว็บตารางอ่านหนังสือและออกกำลังกายแบบไดนามิก
Next.js (App Router, JavaScript) + Supabase (ล็อกอินด้วย Google), deploy บน Vercel

## เวอร์ชัน

โปรเจกต์นี้ใช้ **Next.js เวอร์ชันล่าสุด** (Next.js 16.3.x ณ วันที่ 30 ก.ย. 2569 / 2026) คู่กับ React 19
ต้องใช้ Node.js 20.9 ขึ้นไป (`"next": "^16.3.6"` ใน `package.json`)

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

## ตั้งค่าล็อกอิน Google (Supabase Auth)

1. Google Cloud Console → สร้าง OAuth Client ID (Web application) แล้วใส่ Authorized redirect URI เป็น
   `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
2. Supabase → Authentication → Providers → Google → เปิดใช้งาน แล้วใส่ Client ID / Client Secret
3. Supabase → Authentication → URL Configuration
   - Site URL: โดเมนที่ deploy บน Vercel
   - Redirect URLs: เพิ่มโดเมน Vercel และ `http://localhost:3000`

## ฐานข้อมูล

ทุกตารางมีคอลัมน์ `user_id` (default `auth.uid()`) และเปิด RLS ให้เห็น/แก้ได้เฉพาะแถวของตัวเอง
โค้ดฝั่งเว็บจึงไม่ส่งและไม่กรอง `user_id` เอง (ยกเว้นตอนรีเซ็ตข้อมูล ที่ใช้ `.eq("user_id", ...)` เพราะ DELETE ต้องมีเงื่อนไข)
policy ของแต่ละตารางต้องครอบคลุม select, insert, update และ delete ตัวอย่าง:

```sql
alter table study_blocks enable row level security;
create policy "own rows" on study_blocks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- `study_subjects` (id, user_id, name, hours_needed, hours_done, exam_date, difficulty, created_at)
- `study_blocks` (id, user_id, subject_id, plan_date, done)
- `study_settings` (user_id PK, daily_hours jsonb ยาว 7 เรียง อา..ส)
- `workout_items` (id, user_id, name, per_week)
- `workout_plan` (id, user_id, item_name, plan_date, done, light)
- `workout_settings` (user_id PK, days jsonb ยาว 7 เรียง อา..ส, minutes, skipped_dates jsonb)

## โครงสร้างโปรเจกต์

```
app/            หน้าเว็บ (App Router): /, /login, /study, /workout
lib/            supabaseClient, useSession, dates
```

- `lib/useSession.js` — hook ติดตามสถานะล็อกอินด้วย `supabase.auth.onAuthStateChange` และ redirect ไป `/login` ถ้ายังไม่มี session
- `lib/dates.js` — วันที่แบบ `YYYY-MM-DD` ตามเวลาท้องถิ่น, บวกวัน, ชื่อวันไทย (อา จ อ พ พฤ ศ ส)
