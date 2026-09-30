"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { useSession } from "../../lib/useSession";
import { CALENDAR_SCOPES } from "../../lib/googleAuth";

export default function LoginPage() {
  const router = useRouter();
  const { userId, loading } = useSession({ requireAuth: false });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  // ล็อกอินอยู่แล้ว → กลับหน้าแรก
  useEffect(() => {
    if (userId) router.replace("/");
  }, [userId, router]);

  async function signInWithGoogle() {
    setWorking(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin, scopes: CALENDAR_SCOPES },
    });
    if (err) {
      setError(`เข้าสู่ระบบไม่สำเร็จ: ${err.message}`);
      setWorking(false);
    }
  }

  if (loading || userId) {
    return <main className="home"><p className="lead">กำลังโหลด…</p></main>;
  }

  return (
    <main className="home">
      <header>
        <h1>Flex Planner</h1>
        <p className="lead">เข้าสู่ระบบเพื่อดูตารางของคุณจากทุกอุปกรณ์</p>
      </header>

      <button type="button" className="login-btn" onClick={signInWithGoogle} disabled={working}>
        {working ? "กำลังไปที่ Google…" : "เข้าสู่ระบบด้วย Google"}
      </button>

      {error && <p className="login-error" role="alert">{error}</p>}
    </main>
  );
}
