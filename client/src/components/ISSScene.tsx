"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment } from "@react-three/drei";
import { Suspense, useEffect } from "react";
import * as THREE from "three";

function Model() {
  const { scene } = useGLTF("/iss_interiorinternational_space_station.glb");

  useEffect(() => {
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((mat, i) => {
          if (mat instanceof THREE.MeshBasicMaterial) {
            const standard = new THREE.MeshStandardMaterial({
              map: mat.map,
              color: mat.color,
              side: mat.side,
              transparent: mat.transparent,
              opacity: mat.opacity,
              roughness: 0.7,
              metalness: 0.2,
            });
            if (Array.isArray(child.material)) {
              child.material[i] = standard;
            } else {
              child.material = standard;
            }
            mat.dispose();
          }
        });
      }
    });
  }, [scene]);

  return <primitive object={scene} />;
}

export default function ISSScene() {
  return (
    <Canvas
      camera={{ position: [55.214, -0.950, -33.493], fov: 60, near: 0.01, far: 1000 }}
      gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }}
    >
      <ambientLight intensity={0.15} />
      <directionalLight position={[10, 8, 5]} intensity={0.8} color="#fff5e6" castShadow />
      <pointLight position={[55, 1, -33]} intensity={2} distance={15} color="#e8f0ff" />
      <pointLight position={[55, 1, -40]} intensity={1.5} distance={12} color="#e8f0ff" />
      <pointLight position={[50, 1, -30]} intensity={1} distance={10} color="#ffe8cc" />
      <hemisphereLight args={["#c8d8e8", "#2a2a3a", 0.3]} />
      <Suspense fallback={null}>
        <Model />
        <Environment preset="city" environmentIntensity={0.15} />
      </Suspense>
      <OrbitControls enableZoom={false} enablePan={false} target={[55.214, -0.950, -34.493]} />
    </Canvas>
  );
}
