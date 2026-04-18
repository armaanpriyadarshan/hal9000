"use client";

import dynamic from "next/dynamic";

const ISSInteriorScene = dynamic(() => import("@/components/ISSInteriorScene"), { ssr: false });
const InteriorCaption = dynamic(() => import("@/components/InteriorCaption"), { ssr: false });

export default function Home() {
  return (
    <div className="h-screen w-screen relative">
      <ISSInteriorScene />
      <InteriorCaption />
    </div>
  );
}
