"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useEffect } from "react";
import * as THREE from "three";

const HOLOGRAM_VERSION = "surface-v3";
const HIGH_VERTEX_COUNT = 2000;
const EDGE_ANGLE_DEG = 20;

function HologramModel() {
  const { scene } = useGLTF("/iss-exterior.glb");

  useEffect(() => {
    const surfaceMat = new THREE.MeshBasicMaterial({
      color: 0x66ccff,
      transparent: true,
      opacity: 0.7,
      side: THREE.FrontSide,
      depthWrite: true,
    });
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xccf5ff,
      transparent: true,
      opacity: 0.85,
    });
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const stale: THREE.Object3D[] = [];
      for (const c of child.children) {
        if (c instanceof THREE.LineSegments) {
          c.geometry.dispose();
          stale.push(c);
        }
      }
      stale.forEach((c) => child.remove(c));
      child.visible = true;
      if (child.userData.hologramVersion === HOLOGRAM_VERSION) return;

      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => m.dispose());
      child.material = surfaceMat;
      const count = child.geometry.attributes.position?.count ?? 0;
      if (count <= HIGH_VERTEX_COUNT) {
        const edges = new THREE.EdgesGeometry(child.geometry, EDGE_ANGLE_DEG);
        child.add(new THREE.LineSegments(edges, lineMat));
      }
      child.userData.hologramVersion = HOLOGRAM_VERSION;
    });
  }, [scene]);

  return <primitive object={scene} />;
}

export default function ISSExteriorScene() {
  return (
    <Canvas camera={{ position: [0, 0, 30], fov: 50, near: 0.1, far: 1000 }}>
      <color attach="background" args={["#000000"]} />
      <Suspense fallback={null}>
        <HologramModel />
      </Suspense>
      <OrbitControls enableZoom enableDamping />
    </Canvas>
  );
}
