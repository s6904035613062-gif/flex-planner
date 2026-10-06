import Link from "next/link";
import { ENABLE_CALENDAR } from "../../lib/googleAuth";
import "./privacy.css";

export const metadata = {
  title: "นโยบายความเป็นส่วนตัว | Flex Planner",
  description: "นโยบายความเป็นส่วนตัวของ Flex Planner",
};

// แก้เป็นอีเมลจริงของคุณ
const CONTACT_EMAIL = "[ใส่อีเมลของคุณ]";
const UPDATED = "6 ตุลาคม 2569";

export default function PrivacyPage() {
  return (
    <main className="privacy">
      <Link href="/">กลับหน้าแรก</Link>
      <h1>นโยบายความเป็นส่วนตัว</h1>
      <p className="updated">อัปเดตล่าสุด: {UPDATED}</p>

      <section>
        <h2>เว็บนี้คืออะไร</h2>
        <p>
          Flex Planner เป็นโครงงานการเรียน ช่วยจัดตารางอ่านหนังสือและออกกำลังกายให้ปรับตามเวลาว่างของคุณในแต่ละวัน
        </p>
      </section>

      <section>
        <h2>ข้อมูลที่เก็บ</h2>
        <ul>
          <li>อีเมลและชื่อจากบัญชี Google ที่คุณใช้ล็อกอิน</li>
          <li>ข้อมูลที่คุณกรอกเอง ได้แก่ วิชา จำนวนชั่วโมง วันสอบ เมนูออกกำลังกาย รวมถึงแผนงานที่ระบบจัดให้และสถานะว่าทำแล้วหรือยัง</li>
          <li>Telegram chat_id เฉพาะกรณีที่คุณกรอกเองเพื่อรับแจ้งเตือน</li>
          {ENABLE_CALENDAR && (
            <li>ข้อมูลช่วงว่าง/ไม่ว่างและรหัสกิจกรรมใน Google Calendar เฉพาะเมื่อคุณกดใช้ฟีเจอร์ปฏิทินเอง</li>
          )}
        </ul>
      </section>

      <section>
        <h2>ใช้ข้อมูลเพื่ออะไร</h2>
        <ul>
          <li>แสดงและจัดตารางอ่านหนังสือและออกกำลังกายของคุณ</li>
          <li>ส่งแจ้งเตือนทาง Telegram เฉพาะเมื่อคุณเปิดการแจ้งเตือนไว้เท่านั้น (ข้อความจะส่งผ่านบริการของ Telegram)</li>
          <li>ไม่ขายและไม่แชร์ข้อมูลของคุณให้บุคคลที่สามเพื่อวัตถุประสงค์อื่น</li>
        </ul>
      </section>

      <section>
        <h2>ที่เก็บข้อมูล</h2>
        <p>
          ข้อมูลเก็บไว้ที่ Supabase และเว็บโฮสต์บน Vercel ข้อมูลของแต่ละคนมองเห็นได้เฉพาะเจ้าของบัญชีนั้น
        </p>
      </section>

      <section>
        <h2>สิทธิ์ของคุณ</h2>
        <p>
          คุณขอลบบัญชีและข้อมูลทั้งหมดได้โดยติดต่ออีเมล{" "}
          {CONTACT_EMAIL.includes("@") ? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> : CONTACT_EMAIL}
        </p>
        <p>
          คุณยังจัดการข้อมูลเองได้ในเว็บ: ปุ่ม "รีเซ็ตข้อมูลทั้งหมด" ในหน้าอ่านหนังสือและหน้าออกกำลังกายจะลบข้อมูลของโหมดนั้น
          และในหน้าตั้งค่าคุณปิดการแจ้งเตือนหรือลบ chat_id ได้ทุกเมื่อ
        </p>
      </section>

      <section>
        <h2>วันที่อัปเดตล่าสุด</h2>
        <p>{UPDATED}</p>
      </section>
    </main>
  );
}
