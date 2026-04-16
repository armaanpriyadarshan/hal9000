"use client";

import { Canvas } from "@react-three/fiber";
import { PointerLockControls, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

function Model() {
  const { scene } = useGLTF("/iss_interiorinternational_space_station.glb");
  return <primitive object={scene} />;
}

function Movement() {
  const { camera } = useThree();
  const keys = useRef<Set<string>>(new Set());
  const speed = 15;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [camera]);

  useFrame((_, delta) => {
    const direction = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();

    camera.getWorldDirection(forward);
    right.crossVectors(forward, camera.up).normalize();

    if (keys.current.has("KeyW")) direction.add(forward);
    if (keys.current.has("KeyS")) direction.sub(forward);
    if (keys.current.has("KeyD")) direction.add(right);
    if (keys.current.has("KeyA")) direction.sub(right);
    if (keys.current.has("Space")) direction.y += 1;
    if (keys.current.has("ShiftLeft")) direction.y -= 1;

    if (direction.length() > 0) {
      direction.normalize();
      camera.position.addScaledVector(direction, speed * delta);
    }
  });

  return null;
}

export default function ISSScene() {
  return (
    <Canvas camera={{ position: [55.214, -0.950, -33.493], fov: 60, near: 0.01, far: 1000 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <Suspense fallback={null}>
        <Model />
      </Suspense>
      <Movement />
      <PointerLockControls />
    </Canvas>
  );
}
