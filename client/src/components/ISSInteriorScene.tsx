"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment } from "@react-three/drei";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import {
  CANONICAL_AREAS,
  HATCH_HINT,
  INTERIOR_AREAS,
  bfs,
  isCanonicalArea,
  type CanonicalArea,
} from "@/lib/interiorAreas";

const CAMERA_POSITION: [number, number, number] = [55.214, -0.95, -33.493];
// Rotated 90° right (clockwise around Y) from the original -Z heading.
const CAMERA_TARGET: [number, number, number] = [54.214, -0.95, -33.493];

const SEGMENT_MS = 500;

type Flight = {
  waypoints: THREE.Vector3[];
  startedAt: number;
  segmentMs: number;
};

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

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

function FlightController({ area }: { area: CanonicalArea | null }) {
  const { camera } = useThree();
  const { scene: gltfScene } = useGLTF("/iss-interior.glb");

  const flightRef = useRef<Flight | null>(null);
  const originRef = useRef<CanonicalArea | null>(null);

  // Memoise area → world-space bounding-box centre once per glb load.
  // Skips areas whose glb node can't be found (logs a warning).
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

  // Resolve origin for a new flight: prefer the last-targeted area, else
  // the module whose bbox contains the current camera position, else the
  // default startup module (whichever contains CAMERA_POSITION).
  const resolveOrigin = (): CanonicalArea | null => {
    if (originRef.current) return originRef.current;
    const pos = camera.position;
    for (const key of CANONICAL_AREAS) {
      const entry = INTERIOR_AREAS[key];
      const node = gltfScene.getObjectByName(entry.glbNodeName);
      if (!node) continue;
      const box = new THREE.Box3().setFromObject(node);
      if (box.containsPoint(pos)) return key;
    }
    return null;
  };

  // Look up the hatch node for an edge in either direction, returning its
  // world-space bounding-box centre. Falls back to the midpoint of the
  // two module centres if the hint is missing or the node can't be found.
  const resolveHatchCenter = (
    a: CanonicalArea,
    b: CanonicalArea,
  ): THREE.Vector3 => {
    const hint = HATCH_HINT[`${a}→${b}`] ?? HATCH_HINT[`${b}→${a}`];
    if (hint) {
      const node = gltfScene.getObjectByName(hint);
      if (node) {
        return new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
      }
      console.warn(`[interior] hatch node not found: ${hint}`);
    }
    const cA = areaCenters.get(a);
    const cB = areaCenters.get(b);
    if (cA && cB) return cA.clone().add(cB).multiplyScalar(0.5);
    return new THREE.Vector3();
  };

  // Plan a flight whenever `area` changes.
  useEffect(() => {
    if (area === null) {
      // Clear: single-segment lerp back to the startup pose.
      flightRef.current = {
        waypoints: [
          camera.position.clone(),
          new THREE.Vector3(...CAMERA_POSITION),
        ],
        startedAt: performance.now(),
        segmentMs: SEGMENT_MS,
      };
      originRef.current = null;
      return;
    }

    const target = area;
    const origin = resolveOrigin();

    const targetCenter = areaCenters.get(target);
    if (!targetCenter) {
      console.warn(`[interior] target module has no center: ${target}`);
      return;
    }

    let waypoints: THREE.Vector3[];
    if (origin === null || origin === target) {
      // Cold start or same-module nav: single-segment lerp into the target.
      waypoints = [camera.position.clone(), targetCenter.clone()];
    } else {
      const chain = bfs(origin, target);
      if (!chain) {
        console.warn(`[interior] no path from ${origin} to ${target}`);
        return;
      }
      waypoints = [camera.position.clone()];
      for (let i = 0; i < chain.length - 1; i++) {
        waypoints.push(resolveHatchCenter(chain[i], chain[i + 1]));
        waypoints.push(areaCenters.get(chain[i + 1])!.clone());
      }
    }

    flightRef.current = {
      waypoints,
      startedAt: performance.now(),
      segmentMs: SEGMENT_MS,
    };
    originRef.current = target;
  // camera + gltfScene + areaCenters are stable across renders (camera is
  // the three.js camera mutated in place; gltfScene is drei-cached; areaCenters
  // is memoised on gltfScene). Re-running on their identity would cause
  // jittery re-plans.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area]);

  useFrame(() => {
    const flight = flightRef.current;
    if (!flight) return;

    const elapsed = performance.now() - flight.startedAt;
    const segmentCount = flight.waypoints.length - 1;
    const totalMs = segmentCount * flight.segmentMs;

    if (elapsed >= totalMs) {
      const last = flight.waypoints[flight.waypoints.length - 1];
      camera.position.copy(last);
      if (flight.waypoints.length >= 2) {
        // Project forward past `last` along the final segment's direction so the
        // camera keeps looking where it was heading, not at its own position.
        const prev = flight.waypoints[flight.waypoints.length - 2];
        const forward = last.clone().sub(prev).normalize().add(last);
        camera.lookAt(forward);
      }
      flightRef.current = null;
      return;
    }

    const segIndex = Math.min(
      segmentCount - 1,
      Math.floor(elapsed / flight.segmentMs),
    );
    const segT = (elapsed - segIndex * flight.segmentMs) / flight.segmentMs;
    const eased = easeInOutCubic(Math.min(1, Math.max(0, segT)));

    const a = flight.waypoints[segIndex];
    const b = flight.waypoints[segIndex + 1];
    camera.position.lerpVectors(a, b, eased);

    // Look at the waypoint two ahead when possible, so the camera is
    // already facing the next hatch before it enters it. Fall back to
    // the final waypoint near the end.
    const lookIndex = Math.min(segIndex + 2, flight.waypoints.length - 1);
    camera.lookAt(flight.waypoints[lookIndex]);
  });

  return null;
}

function Scene() {
  const params = useSearchParams();
  const raw = params.get("area");
  const area = isCanonicalArea(raw) ? raw : null;

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
        <FlightController area={area} />
      </Suspense>
      {/* OrbitControls kept for manual exploration when no flight is active.
          Its target is irrelevant once FlightController calls camera.lookAt each
          frame — the controls lose the thread during a flight, but recover on
          the next user drag. Zoom + pan stay disabled. */}
      <OrbitControls enableZoom={false} enablePan={false} target={CAMERA_TARGET} />
    </>
  );
}

export default function ISSInteriorScene() {
  return (
    <Canvas
      camera={{ position: CAMERA_POSITION, fov: 60, near: 0.01, far: 1000 }}
      gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.8 }}
    >
      <Scene />
    </Canvas>
  );
}
