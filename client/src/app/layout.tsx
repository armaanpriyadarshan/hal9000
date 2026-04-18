import type { Metadata } from "next";
import HalVoice from "@/components/HalVoice";
import "./globals.css";

export const metadata: Metadata = {
  title: "HAL 9000",
  description: "On-device voice agent for deep space missions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <HalVoice />
      </body>
    </html>
  );
}
