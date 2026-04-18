"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Stars, useGLTF } from "@react-three/drei";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";

import {
  SHIP_PARTS,
  isCanonicalPart,
  type CanonicalPart,
  type Match,
} from "@/lib/shipParts";

type OrbitControlsLike = {
  target: THREE.Vector3;
  maxDistance: number;
  minDistance: number;
  update: () => void;
};

const HOLOGRAM_VERSION = "fresnel-v2-hl";
const HIGH_VERTEX_COUNT = 2000;
const EDGE_ANGLE_DEG = 20;

const VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vViewPos;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = `
  uniform vec3 baseColor;
  uniform vec3 rimColor;
  uniform float rimPower;
  uniform float baseAlpha;
  uniform float rimAlpha;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  void main() {
    vec3 V = normalize(vViewPos);
    vec3 N = normalize(vNormal);
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), rimPower);
    vec3 color = mix(baseColor, rimColor, fresnel);
    float alpha = mix(baseAlpha, rimAlpha, fresnel);
    gl_FragColor = vec4(color, alpha);
  }
`;

function makeMaterial(highlighted: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      baseColor: { value: new THREE.Color(0x72b8e0) },
      rimColor: { value: new THREE.Color(highlighted ? 0xffffff : 0xdcf0f8) },
      rimPower: { value: highlighted ? 1.8 : 2.5 },
      baseAlpha: { value: highlighted ? 0.55 : 0.2 },
      rimAlpha: { value: highlighted ? 1.0 : 0.9 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false,
  });
}

function resolveMatchingMeshes(
  scene: THREE.Object3D,
  match: Match,
): Set<THREE.Mesh> {
  const matches = new Set<THREE.Mesh>();
  if (match.kind === "parent") {
    for (const parentName of match.values) {
      const parent = scene.getObjectByName(parentName);
      if (!parent) continue;
      parent.traverse((child) => {
        if (child instanceof THREE.Mesh) matches.add(child);
      });
    }
  } else {
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const name = child.name;
      if (match.values.some((v) => name.startsWith(v))) matches.add(child);
    });
  }
  return matches;
}

function HologramModel({ highlight }: { highlight: CanonicalPart | null }) {
  const { scene } = useGLTF("/iss-exterior.glb");
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsLike | null;

  const defaultMat = useMemo(() => makeMaterial(false), []);
  const highlightedMat = useMemo(() => makeMaterial(true), []);
  const lineMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0xccf5ff,
        transparent: true,
        opacity: 0.85,
      }),
    [],
  );

  // Initial load: tag meshes with default material + edges; frame the camera on the full ISS.
  useEffect(() => {
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
      child.material = defaultMat;
      const count = child.geometry.attributes.position?.count ?? 0;
      if (count <= HIGH_VERTEX_COUNT) {
        const edges = new THREE.EdgesGeometry(child.geometry, EDGE_ANGLE_DEG);
        child.add(new THREE.LineSegments(edges, lineMat));
      }
      child.userData.hologramVersion = HOLOGRAM_VERSION;
    });

    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const diag = size.length();

    const startDistance = diag * 1.1;
    const maxDistance = diag * 1.8;
    const minDistance = diag * 0.05;

    camera.position.set(center.x, center.y, center.z + startDistance);
    camera.lookAt(center);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.near = Math.max(diag * 0.001, 0.01);
      camera.far = diag * 10;
      camera.updateProjectionMatrix();
    }
    if (controls) {
      controls.target.copy(center);
      controls.maxDistance = maxDistance;
      controls.minDistance = minDistance;
      controls.update();
    }
  }, [scene, camera, controls, defaultMat, lineMat]);

  // Highlight pass: swap per-mesh materials based on the current highlight.
  useEffect(() => {
    const matching = highlight
      ? resolveMatchingMeshes(scene, SHIP_PARTS[highlight].match)
      : new Set<THREE.Mesh>();
    if (highlight && matching.size === 0) {
      console.warn(`[shipParts] no meshes matched for "${highlight}"`);
    }
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.material = matching.has(child) ? highlightedMat : defaultMat;
    });
  }, [scene, highlight, defaultMat, highlightedMat]);

  return <primitive object={scene} />;
}

export default function ISSExteriorScene() {
  const searchParams = useSearchParams();
  const highlightRaw = searchParams.get("highlight");
  const highlight: CanonicalPart | null = isCanonicalPart(highlightRaw)
    ? highlightRaw
    : null;

  return (
    <Canvas camera={{ position: [0, 0, 30], fov: 50, near: 0.1, far: 1000 }}>
      <color attach="background" args={["#000000"]} />
      <Stars
        radius={400}
        depth={120}
        count={6000}
        factor={5}
        saturation={0}
        fade
        speed={0.3}
      />
      <Suspense fallback={null}>
        <HologramModel highlight={highlight} />
      </Suspense>
      <OrbitControls enableZoom enableDamping makeDefault />
    </Canvas>
  );
}
