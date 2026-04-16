"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const ISSInteriorScene = dynamic(() => import("@/components/ISSInteriorScene"), { ssr: false });
const ISSExteriorScene = dynamic(() => import("@/components/ISSExteriorScene"), { ssr: false });

type View = "interior" | "exterior";

export default function Home() {
  const [view, setView] = useState<View>("interior");

  const toggle = () => setView((v) => (v === "interior" ? "exterior" : "interior"));
  const label = view === "interior" ? "View Exterior" : "View Interior";

  return (
    <div className="h-screen w-screen relative">
      {view === "interior" ? <ISSInteriorScene /> : <ISSExteriorScene />}
      <button
        onClick={toggle}
        className="absolute top-4 right-4 z-10 px-4 py-2 font-mono text-sm text-white bg-black/50 border border-white/80 hover:bg-black/70 cursor-pointer"
      >
        {label}
      </button>
    </div>
  );
}
