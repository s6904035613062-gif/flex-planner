"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { useSession } from "../../lib/useSession";
import "./settings.css";

export default function SettingsPage() {
  const { userId, loading: authLoading, signOut } = useSession();
  const [chatId, setChatId] = useState("");
  const [notify, setNotify] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data, error: e } = await supabase
        .from("profiles").select("telegram_chat_id, notify").maybeSingle();
      if (e) setError(`อ่านการตั้งค่าไม่ได้: ${e.message}`);
      else {
        setChatId(data?.telegram_chat_id ?? "");
        setNotify(!!data?.notify);
      }
      setLoading(false);
    })();
  }, [userId]);

  async function save(e) {
    e.preventDefault();
    setSaved(false);
    const id = chatId.trim();
    if (id && !/^-?\d+$/.test(id)) return setError("chat_id ต้องเป็นตัวเลขเท่านั้น เช่น 123456789");
    if (notify && !id) return setError("กรอก chat_id ก่อนเปิดการแจ้งเตือน");
    setError("");
    setSaving(true);
    const { error: err } = await supabase
      .from("profiles")
      .upsert({ telegram_chat_id: id || null, notify }, { onConflict: "user_id" });
    setSaving(false);
    if (err) return setError(`บันทึกไม่สำเร็จ: ${err.message}`);
    setChatId(id);
    setSaved(true);
  }

  if (authLoading || !userId || loading) {
    return <main className="settings"><p className="muted">กำลังโหลด…</p></main>;
  }

  return (
    <main className="settings">
      <header>
        <div className="topbar">
          <Link href="/" className="back">หน้าแรก</Link>
          <button type="button" className="ghost" onClick={signOut}>ออกจากระบบ</button>
        </div>
        <h1>ตั้งค่า</h1>
      </header>

      <form className="card" onSubmit={save}>
        <h2>แจ้งเตือน Telegram ตอนเช้า</h2>
        <p className="muted">ทุกเช้าประมาณ 07:00 น. บอทจะส่งรายการอ่านหนังสือและออกกำลังกายของวันนี้ที่ยังไม่ได้ทำ ถ้าวันไหนไม่มีรายการ จะไม่ส่ง</p>

        <label>Telegram chat_id
          <input
            inputMode="numeric"
            value={chatId}
            onChange={(e) => { setSaved(false); setChatId(e.target.value); }}
            placeholder="เช่น 123456789"
            autoComplete="off"
          />
        </label>

        <details>
          <summary>วิธีหา chat_id</summary>
          <ol>
            <li>เปิด Telegram แล้วค้นหา <strong>@userinfobot</strong> กด Start</li>
            <li>บอทจะตอบกลับด้วยข้อมูลของคุณ ให้คัดลอกตัวเลขหลัง <strong>Id</strong> มาใส่ในช่องด้านบน</li>
            <li>สำคัญ: ต้องเปิดแชตกับบอทของ Flex Planner แล้วกด <strong>Start</strong> ก่อน ไม่อย่างนั้นบอทจะส่งข้อความหาคุณไม่ได้</li>
          </ol>
        </details>

        <label className="switch">
          <input type="checkbox" checked={notify} onChange={(e) => { setSaved(false); setNotify(e.target.checked); }} />
          เปิดการแจ้งเตือนตอนเช้า
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={saving}>{saving ? "กำลังบันทึก…" : "บันทึก"}</button>
        {saved && <p className="muted" role="status">บันทึกแล้ว</p>}
      </form>
    </main>
  );
}
