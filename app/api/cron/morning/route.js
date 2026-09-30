import { createClient } from "@supabase/supabase-js";

// เรียกโดย Vercel Cron เท่านั้น ห้าม cache
export const dynamic = "force-dynamic";

const BATCH = 5;

function bangkokToday() {
  // en-CA ให้รูปแบบ YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function sendTelegram(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(`Telegram ${res.status}: ${body.description || "ส่งไม่สำเร็จ"}`);
  }
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
    !botToken && "TELEGRAM_BOT_TOKEN",
  ].filter(Boolean);
  if (missing.length) {
    return Response.json({ ok: false, error: `ขาด environment variable: ${missing.join(", ")}` }, { status: 500 });
  }

  // service role ข้าม RLS → ทุก query ต้องกรอง user_id เอง
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const today = bangkokToday();

  const { data: profiles, error: profErr } = await supabase
    .from("profiles")
    .select("user_id, telegram_chat_id")
    .eq("notify", true)
    .not("telegram_chat_id", "is", null)
    .neq("telegram_chat_id", "");
  if (profErr) {
    return Response.json({ ok: false, error: `อ่านตาราง profiles ไม่ได้: ${profErr.message}` }, { status: 500 });
  }

  async function notifyOne(p) {
    try {
      const uid = p.user_id;
      const [blocksRes, planRes] = await Promise.all([
        supabase.from("study_blocks").select("subject_id").eq("user_id", uid).eq("plan_date", today).eq("done", false),
        supabase.from("workout_plan").select("item_name, light").eq("user_id", uid).eq("plan_date", today).eq("done", false),
      ]);
      if (blocksRes.error) throw blocksRes.error;
      if (planRes.error) throw planRes.error;

      const lines = [];

      // อ่านหนังสือ: รวมบล็อกต่อวิชา → "📚 คณิต × 2 ชม."
      const counts = new Map();
      for (const b of blocksRes.data) counts.set(b.subject_id, (counts.get(b.subject_id) || 0) + 1);
      if (counts.size > 0) {
        const { data: subs, error: subErr } = await supabase
          .from("study_subjects").select("id, name").eq("user_id", uid).in("id", [...counts.keys()]);
        if (subErr) throw subErr;
        const nameOf = new Map(subs.map((s) => [s.id, s.name]));
        for (const [id, n] of counts) {
          if (nameOf.has(id)) lines.push(`📚 ${nameOf.get(id)} × ${n} ชม.`);
        }
      }

      // ออกกำลังกาย: "🏃 คาร์ดิโอ 40 นาที" (แบบเบา = ครึ่งหนึ่ง)
      if (planRes.data.length > 0) {
        const { data: ws, error: wsErr } = await supabase
          .from("workout_settings").select("minutes").eq("user_id", uid).maybeSingle();
        if (wsErr) throw wsErr;
        const minutes = Number(ws?.minutes) || 40;
        for (const r of planRes.data) {
          lines.push(`🏃 ${r.item_name} ${r.light ? Math.round(minutes / 2) : minutes} นาที${r.light ? " (เบา)" : ""}`);
        }
      }

      if (lines.length === 0) return "skipped";
      await sendTelegram(botToken, p.telegram_chat_id, `☀️ วันนี้ต้องทำ\n${lines.join("\n")}`);
      return "sent";
    } catch (e) {
      console.error(`morning notify failed for user ${p.user_id}:`, e?.message || e);
      return "failed";
    }
  }

  const result = { sent: 0, skipped: 0, failed: 0 };
  for (let i = 0; i < profiles.length; i += BATCH) {
    const outcomes = await Promise.all(profiles.slice(i, i + BATCH).map(notifyOne));
    for (const o of outcomes) result[o]++;
  }

  return Response.json({ ok: true, date: today, total: profiles.length, ...result });
}
