"use client";

import { connectGoogle } from "./googleAuth";

/** แถบแจ้งปัญหา Google — issue = { msg, reconnect } จาก toIssue() */
export default function GoogleNotice({ issue }) {
  if (!issue) return null;
  return (
    <div className="banner error" role="alert">
      <p style={{ margin: 0 }}>{issue.msg}</p>
      {issue.reconnect && (
        <button type="button" className="ghost" style={{ marginTop: 8 }} onClick={() => connectGoogle()}>
          เชื่อมต่อ Google ใหม่
        </button>
      )}
    </div>
  );
}
