import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "모아드롭 · 영상과 소리를 간편하게",
  description: "허용된 영상과 음원을 원하는 형식으로 저장하세요.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
