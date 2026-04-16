"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Suspense, useEffect } from "react";
import * as THREE from "three";

function HologramModel() {
  const { scene } = useGLTF("/iss-exterior.glb");

  useEffect(() => {
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      const wireframe = new THREE.MeshBasicMaterial({
        wireframe: true,
        color: 0x00ffff,
        transparent: true,
        opacity: 0.9,
      });
      mats.forEach((mat) => mat.dispose());
      child.material = wireframe;
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
      <EffectComposer>
        <Bloom intensity={1.5} luminanceThreshold={0} mipmapBlur />
      </EffectComposer>
      <OrbitControls enableZoom enableDamping />
    </Canvas>
  );
}
