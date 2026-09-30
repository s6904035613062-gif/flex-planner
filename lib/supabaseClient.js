import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "ไม่พบ NEXT_PUBLIC_SUPABASE_URL หรือ NEXT_PUBLIC_SUPABASE_ANON_KEY — ตั้งค่าใน .env.local (ตอนพัฒนา) หรือ Environment Variables ของ Vercel (ตอน deploy)"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
