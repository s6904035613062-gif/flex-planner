const pad = (n) => String(n).padStart(2, "0");

function utc(iso) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/** events: [{ uid, title, date, startISO?, endISO? }] — ถ้าไม่มีเวลาจะเป็น event ทั้งวัน */
export function buildIcs(events) {
  const stamp = utc(new Date().toISOString());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Flex Planner//TH", "CALSCALE:GREGORIAN"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`);
    if (e.startISO && e.endISO) lines.push(`DTSTART:${utc(e.startISO)}`, `DTEND:${utc(e.endISO)}`);
    else lines.push(`DTSTART;VALUE=DATE:${e.date.replace(/-/g, "")}`);
    lines.push(`SUMMARY:${esc(e.title)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function downloadIcs(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
