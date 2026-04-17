"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment } from "@react-three/drei";
import { Suspense, useEffect } from "react";
import * as THREE from "three";

const CAMERA_POSITION: [number, number, number] = [55.214, -0.95, -33.493];
// Rotated 90° right (clockwise around Y) from the original -Z heading.
const CAMERA_TARGET: [number, number, number] = [54.214, -0.95, -33.493];

function Model() {
  const { scene } = useGLTF("/iss-interior.glb");

  useEffect(() => {
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat, i) => {
        if (!(mat instanceof THREE.MeshBasicMaterial)) return;
        const standard = new THREE.MeshStandardMaterial({
          map: mat.map,
          color: mat.color,
          side: mat.side,
          transparent: mat.transparent,
          opacity: mat.opacity,
          roughness: 0.5,
          metalness: 0.4,
        });
        if (Array.isArray(child.material)) {
          child.material[i] = standard;
        } else {
          child.material = standard;
        }
        mat.dispose();
      });
    });
  }, [scene]);

  return <primitive object={scene} />;
}

export default function ISSInteriorScene() {
  return (
    <Canvas
      camera={{ position: CAMERA_POSITION, fov: 60, near: 0.01, far: 1000 }}
      gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.8 }}
    >
      <ambientLight intensity={0.2} />
      <pointLight position={[55, 2.5, -33]} intensity={8} distance={8} color="#d4e4ff" decay={2} />
      <pointLight position={[55, 2.5, -38]} intensity={8} distance={8} color="#d4e4ff" decay={2} />
      <pointLight position={[55, 2.5, -28]} intensity={8} distance={8} color="#d4e4ff" decay={2} />
      <pointLight position={[50, 2.5, -33]} intensity={6} distance={8} color="#d4e4ff" decay={2} />
      <pointLight position={[60, 2.5, -33]} intensity={6} distance={8} color="#d4e4ff" decay={2} />
      <pointLight position={[55, -0.5, -35]} intensity={3} distance={5} color="#ff9944" decay={2} />
      <pointLight position={[54, 0, -31]} intensity={2} distance={4} color="#44aaff" decay={2} />
      <pointLight position={[56, 0.5, -36]} intensity={1.5} distance={6} color="#ff2200" decay={2} />
      <Suspense fallback={null}>
        <Model />
        <Environment preset="night" environmentIntensity={0.2} />
      </Suspense>
      <OrbitControls enableZoom={false} enablePan={false} target={CAMERA_TARGET} />
    </Canvas>
  );
}
