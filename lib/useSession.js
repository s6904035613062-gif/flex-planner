"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./supabaseClient";

/**
 * ติดตามสถานะล็อกอินของ Supabase Auth
 * - requireAuth = true (ค่าเริ่มต้น): ถ้าโหลดเสร็จแล้วไม่มี session จะ redirect ไป /login
 * - คืน userId (string) ไว้ใช้เป็น dependency แทน session ทั้งก้อน
 *   เพราะ session object จะเปลี่ยนทุกครั้งที่ token refresh
 */
export function useSession({ requireAuth = true } = {}) {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // getSession() จะรอให้ client อ่าน token จาก URL (หลังกลับจาก Google) เสร็จก่อน
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (requireAuth && !loading && !userId) router.replace("/login");
  }, [requireAuth, loading, userId, router]);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return { session, userId, email: session?.user?.email ?? "", loading, signOut };
}
