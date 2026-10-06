"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "../lib/useSession";

export default function HomePage() {
  const { userId, email, loading, signOut } = useSession();
  const router = useRouter();

  // กลับมาหน้าเดิมหลังกด "เชื่อมต่อ Google ใหม่"
  useEffect(() => {
    if (!userId) return;
    try {
      const back = sessionStorage.getItem("flex-return");
      if (back) {
        sessionStorage.removeItem("flex-return");
        if (back.startsWith("/") && back !== "/") router.replace(back);
      }
    } catch {}
  }, [userId, router]);

  if (loading || !userId) {
    return <main className="home"><p className="lead">กำลังโหลด…</p></main>;
  }

  return (
    <main className="home">
      <div className="topbar">
        <span className="who">{email}</span>
        <button type="button" className="signout" onClick={signOut}>ออกจากระบบ</button>
      </div>

      <header>
        <h1>Flex Planner</h1>
        <p className="lead">
          ตารางอ่านหนังสือและออกกำลังกายที่ปรับตามวันของคุณ
        </p>
      </header>

      <nav className="choices" aria-label="เลือกตาราง">
        <Link href="/study" className="choice study">
          <span className="title">ตารางอ่านหนังสือ</span>
          <span className="desc">จัดชั่วโมงอ่านตามวิชาและวันสอบ</span>
        </Link>
        <Link href="/workout" className="choice workout">
          <span className="title">ตารางออกกำลังกาย</span>
          <span className="desc">จัดรายการออกกำลังกายตามวันที่ว่าง</span>
        </Link>
      </nav>

      <Link href="/settings" className="settings-link">ตั้งค่าแจ้งเตือน Telegram</Link>

      <footer className="legal">
        <Link href="/privacy">นโยบายความเป็นส่วนตัว</Link>
      </footer>
    </main>
  );
}
