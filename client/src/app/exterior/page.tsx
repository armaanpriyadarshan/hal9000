"use client";

import dynamic from "next/dynamic";

const ISSExteriorScene = dynamic(() => import("@/components/ISSExteriorScene"), { ssr: false });
const ExteriorHud = dynamic(() => import("@/components/ExteriorHud"), { ssr: false });

export default function Exterior() {
  return (
    <div className="h-screen w-screen relative">
      <ISSExteriorScene />
      <ExteriorHud />
    </div>
  );
}
