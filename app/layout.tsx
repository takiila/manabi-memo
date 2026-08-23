import type { Metadata, Viewport } from "next";
import "./globals.css";
import OfflineReady from "./offline-ready";

export const metadata: Metadata = {
  title: "まなびメモ",
  description: "授業中は普通に書き、必要なところだけ付箋にして、あとから自分の考えを一言足せる講義ノート",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#345f53",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}<OfflineReady /></body>
    </html>
  );
}
