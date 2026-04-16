"use client";

import dynamic from "next/dynamic";

const ISSScene = dynamic(() => import("@/components/ISSScene"), { ssr: false });

export default function Home() {
  return (
    <div className="h-screen w-screen">
      <ISSScene />
    </div>
  );
}
