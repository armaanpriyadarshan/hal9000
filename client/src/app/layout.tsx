import type { Metadata } from "next";
import { EB_Garamond, JetBrains_Mono } from "next/font/google";
import HalVoice from "@/components/HalVoice";
import "./globals.css";

// Distinct CSS variable names (--font-*-src) let Tailwind's @theme alias
// --font-mono / --font-serif to them without creating a self-reference.
const serif = EB_Garamond({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-serif-src",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-src",
});

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
    <html
      lang="en"
      className={`${serif.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <HalVoice />
      </body>
    </html>
  );
}
