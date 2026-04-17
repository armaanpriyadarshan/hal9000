"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

const ISSExteriorScene = dynamic(() => import("@/components/ISSExteriorScene"), { ssr: false });

export default function Exterior() {
  return (
    <div className="h-screen w-screen relative">
      <ISSExteriorScene />
      <Link
        href="/"
        className="absolute top-4 right-4 z-10 px-4 py-2 font-mono text-sm text-white bg-black/50 border border-white/80 hover:bg-black/70"
      >
        View Interior
      </Link>
    </div>
  );
}
