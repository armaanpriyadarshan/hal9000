"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, Stars, useGLTF } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { BracketFrame } from "@/components/BracketFrame";

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

const HOLOGRAM_VERSION = "fresnel-v3-hdr";
const HIGH_VERTEX_COUNT = 2000;
const EDGE_ANGLE_DEG = 20;

const LERP_DURATION_MS = 1200;

type Lerp = {
  startPos: THREE.Vector3;
  startTarget: THREE.Vector3;
  endPos: THREE.Vector3;
  endTarget: THREE.Vector3;
  t0: number;
};

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

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
      rimColor: {
        value: highlighted
          ? new THREE.Color(2.4, 2.8, 3.0)
          : new THREE.Color(0xdcf0f8),
      },
      rimPower: { value: highlighted ? 1.4 : 2.5 },
      baseAlpha: { value: highlighted ? 0.85 : 0.2 },
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
  const lerpRef = useRef<Lerp | null>(null);
  const [boxCenter, setBoxCenter] = useState<THREE.Vector3 | null>(null);

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

    if (!highlight || matching.size === 0) {
      lerpRef.current = null;
      setBoxCenter(null);
      return;
    }
    const entry = SHIP_PARTS[highlight];
    const box = new THREE.Box3();
    matching.forEach((m) => box.expandByObject(m));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const diag = Math.max(size.length(), 0.1);
    const scale = entry.cameraDistanceScale ?? 1.8;
    const dir = new THREE.Vector3(...entry.cameraOffset).normalize();
    const endPos = center.clone().add(dir.multiplyScalar(diag * scale));

    lerpRef.current = {
      startPos: camera.position.clone(),
      startTarget: controls?.target.clone() ?? center.clone(),
      endPos,
      endTarget: center,
      t0: performance.now(),
    };
    setBoxCenter(center);
  }, [scene, highlight, camera, controls, defaultMat, highlightedMat]);

  useFrame(() => {
    const lerp = lerpRef.current;
    if (!lerp) return;
    const t = Math.min((performance.now() - lerp.t0) / LERP_DURATION_MS, 1);
    const e = easeInOutCubic(t);
    camera.position.lerpVectors(lerp.startPos, lerp.endPos, e);
    if (controls) {
      controls.target.lerpVectors(lerp.startTarget, lerp.endTarget, e);
      controls.update();
    }
    if (t >= 1) lerpRef.current = null;
  });

  useEffect(
    () => () => {
      defaultMat.dispose();
      highlightedMat.dispose();
      lineMat.dispose();
    },
    [defaultMat, highlightedMat, lineMat],
  );

  return (
    <>
      <primitive object={scene} />
      {highlight && boxCenter && (
        <Html
          position={[boxCenter.x, boxCenter.y, boxCenter.z]}
          center
          distanceFactor={8}
        >
          <BracketFrame className="relative px-3 py-1.5 pointer-events-none">
            <div className="font-mono uppercase tracking-[0.15em] text-white text-xs whitespace-nowrap">
              {SHIP_PARTS[highlight].displayName}
            </div>
          </BracketFrame>
        </Html>
      )}
    </>
  );
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
      <EffectComposer>
        <Bloom
          intensity={1.4}
          luminanceThreshold={0.15}
          luminanceSmoothing={0.025}
          mipmapBlur
        />
      </EffectComposer>
    </Canvas>
  );
}
