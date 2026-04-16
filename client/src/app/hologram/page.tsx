"use client";

import dynamic from "next/dynamic";

const HologramISS = dynamic(() => import("@/components/HologramISS"), {
  ssr: false,
});

export default function HologramPage() {
  return (
    <div className="h-screen w-screen">
      <HologramISS />
    </div>
  );
}
