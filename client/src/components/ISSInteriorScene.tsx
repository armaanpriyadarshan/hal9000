"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment } from "@react-three/drei";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, type ComponentRef } from "react";
import * as THREE from "three";

type OrbitControlsRef = ComponentRef<typeof OrbitControls>;

import {
  CANONICAL_AREAS,
  INTERIOR_AREAS,
  isCanonicalArea,
  type CanonicalArea,
} from "@/lib/interiorAreas";

const CAMERA_POSITION = new THREE.Vector3(55.214, -0.95, -33.493);
// 1 unit in -X from CAMERA_POSITION — the default startup anchor point.
const CAMERA_TARGET = new THREE.Vector3(54.214, -0.95, -33.493);

// Camera orbits the anchor (module centre) at this distance; full 360°
// azimuth with OrbitControls default axis mapping (drag right → view
// rotates right).
const ORBIT_DISTANCE = 1;
const ORBIT_OFFSET = new THREE.Vector3(1, 0, 0);

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

function AreaAnchor({
  area,
  controlsRef,
}: {
  area: CanonicalArea | null;
  controlsRef: React.RefObject<OrbitControlsRef | null>;
}) {
  const { camera } = useThree();
  const { scene: gltfScene } = useGLTF("/iss-interior.glb");

  // One-time map of area → world-space bounding-box centre.
  const areaCenters = useMemo(() => {
    const map = new Map<CanonicalArea, THREE.Vector3>();
    for (const key of CANONICAL_AREAS) {
      const entry = INTERIOR_AREAS[key];
      const node = gltfScene.getObjectByName(entry.glbNodeName);
      if (!node) {
        console.warn(`[interior] missing glb node for ${key}: ${entry.glbNodeName}`);
        continue;
      }
      const box = new THREE.Box3().setFromObject(node);
      map.set(key, box.getCenter(new THREE.Vector3()));
    }
    return map;
  }, [gltfScene]);

  useEffect(() => {
    // Default startup pose hard-codes both camera + target; for every named
    // area we orbit the module centre at a fixed radius so the user can
    // rotate a full 360° around it.
    if (area === null) {
      camera.position.copy(CAMERA_POSITION);
      controlsRef.current?.target.copy(CAMERA_TARGET);
      controlsRef.current?.update();
      return;
    }
    const anchor = areaCenters.get(area);
    if (!anchor) return;
    camera.position.copy(anchor).add(ORBIT_OFFSET);
    controlsRef.current?.target.copy(anchor);
    controlsRef.current?.update();
  }, [area, camera, areaCenters, controlsRef]);

  return null;
}

function Scene() {
  const params = useSearchParams();
  const raw = params.get("area");
  const area = isCanonicalArea(raw) ? raw : null;

  const controlsRef = useRef<OrbitControlsRef | null>(null);

  return (
    <>
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
        <AreaAnchor area={area} controlsRef={controlsRef} />
      </Suspense>
      <OrbitControls
        ref={controlsRef}
        enableZoom={false}
        enablePan={false}
        minDistance={ORBIT_DISTANCE}
        maxDistance={ORBIT_DISTANCE}
        rotateSpeed={0.5}
      />
    </>
  );
}

export default function ISSInteriorScene() {
  return (
    <Canvas
      camera={{ position: CAMERA_POSITION.toArray(), fov: 60, near: 0.01, far: 1000 }}
      gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.8 }}
    >
      <Scene />
    </Canvas>
  );
}
