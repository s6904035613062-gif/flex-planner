import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home">
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
