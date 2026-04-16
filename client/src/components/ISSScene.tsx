"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense } from "react";

function Model() {
  const { scene } = useGLTF("/iss_interiorinternational_space_station.glb");
  return <primitive object={scene} />;
}

export default function ISSScene() {
  return (
    <Canvas camera={{ position: [55.214, -0.950, -33.493], fov: 60, near: 0.01, far: 1000 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <Suspense fallback={null}>
        <Model />
      </Suspense>
      <OrbitControls enableZoom={false} enablePan={false} />
    </Canvas>
  );
}
