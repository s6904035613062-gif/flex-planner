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

## Google Calendar

ต้องทำเพิ่มก่อนใช้ปุ่มที่เกี่ยวกับ Google Calendar:

1. Google Cloud Console → APIs & Services → เปิดใช้ **Google Calendar API**
2. OAuth consent screen → เพิ่ม scopes `calendar.freebusy` และ `calendar.events`
   (ถ้าแอปยังอยู่ในโหมด Testing ให้เพิ่มอีเมลผู้ใช้ใน Test users)
3. เพิ่มคอลัมน์ในฐานข้อมูล:

```sql
alter table study_settings add column if not exists calendar jsonb;
alter table study_blocks   add column if not exists start_time text;
alter table study_blocks   add column if not exists end_time text;
alter table study_blocks   add column if not exists google_event_id text;
alter table workout_plan   add column if not exists google_event_id text;
```

- Google access token เก็บใน `sessionStorage` ของแท็บนั้น (ไม่มี refresh token) หมดอายุประมาณ 1 ชั่วโมง เมื่อหมดจะมีปุ่ม "เชื่อมต่อ Google ใหม่"
- `lib/googleAuth.js` (token), `lib/calendar.js` (freeBusy / สร้าง / ลบ event), `lib/ics.js` (ส่งออก .ics)

## แจ้งเตือน Telegram ตอนเช้า

1. สร้างบอทกับ **@BotFather** แล้วเก็บ token ไว้
2. สร้างตาราง `profiles` ใน Supabase:

```sql
create table if not exists profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  telegram_chat_id text,
  notify boolean not null default false
);
alter table profiles enable row level security;
create policy "own rows" on profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

3. เพิ่ม Environment Variables บน Vercel (ทั้งหมดฝั่งเซิร์ฟเวอร์ ห้ามขึ้นต้น `NEXT_PUBLIC_`):

| ชื่อ | ค่า |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (Supabase → Settings → API) ข้าม RLS ห้ามเปิดเผย |
| `TELEGRAM_BOT_TOKEN` | token จาก BotFather |
| `CRON_SECRET` | ข้อความสุ่มยาว ๆ (Vercel จะส่งเป็น `Authorization: Bearer ...` ให้ cron อัตโนมัติ) |

4. `vercel.json` ตั้ง cron เรียก `/api/cron/morning` ที่ `0 0 * * *` (UTC) = 07:00 น. เวลาไทย
   cron ทำงานเฉพาะ production deployment และบนแพ็กเกจ Hobby เวลาอาจคลาดเคลื่อนได้ภายในชั่วโมงนั้น (07:00–07:59 น.)
5. ให้ผู้ใช้เปิดหน้า `/settings` กรอก chat_id (หาจาก @userinfobot) กด Start กับบอทของเรา แล้วเปิดสวิตช์

ทดสอบด้วยตัวเอง:

```bash
curl https://<โดเมนของคุณ>/api/cron/morning -H "Authorization: Bearer <CRON_SECRET>"
```
