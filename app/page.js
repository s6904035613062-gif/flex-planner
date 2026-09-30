"use client";

import Link from "next/link";
import { useSession } from "../lib/useSession";

export default function HomePage() {
  const { userId, email, loading, signOut } = useSession();

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
    </main>
  );
}
