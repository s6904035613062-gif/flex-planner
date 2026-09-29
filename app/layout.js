import { IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata = {
  title: "Flex Planner",
  description: "ตารางอ่านหนังสือและออกกำลังกายที่ปรับตามวันของคุณ",
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body className={plex.className}>{children}</body>
    </html>
  );
}
