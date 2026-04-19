"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, Stars, useGLTF } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { DraggableCaption } from "@/components/hud/DraggableCaption";

import {
  CAMERA_DISTANCE_SCALE,
  CAMERA_OFFSET,
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

// Risk levels the scene can render. Matches the ORA severity enum
// but kept inline to avoid an import cycle with the hook layer.
// "none" is the default (no alert focus) → neutral blue.
type HighlightRisk = "none" | "advisory" | "caution" | "warning" | "emergency";

const RISKY = new Set<HighlightRisk>(["warning", "emergency"]);

function isHighlightRisk(v: string | null): v is HighlightRisk {
  return v === "advisory" || v === "caution" || v === "warning" || v === "emergency";
}

function makeMaterial(highlighted: boolean, risk: HighlightRisk = "none"): THREE.ShaderMaterial {
  // Risky highlights swap the Fresnel palette to warm-red so the
  // part *itself* communicates threat, not just the HUD banner.
  // Matches the halVisualizer ring + EmergencyFlash vignette colours
  // so the scene has one consistent emotional-colour vocabulary.
  const risky = highlighted && RISKY.has(risk);
  const baseColor = risky
    ? new THREE.Color(1.0, 0.47, 0.31)  // rgb(255,120,80) as linear
    : new THREE.Color(0x72b8e0);
  const rimColor = risky
    ? new THREE.Color(3.0, 1.2, 0.4)     // warm red bloom
    : highlighted
      ? new THREE.Color(2.4, 2.8, 3.0)
      : new THREE.Color(0xdcf0f8);

  return new THREE.ShaderMaterial({
    uniforms: {
      baseColor: { value: baseColor },
      rimColor: { value: rimColor },
      rimPower: { value: highlighted ? 1.4 : 2.5 },
      baseAlpha: { value: highlighted ? 0.85 : 0.2 },
      rimAlpha: { value: highlighted ? 1.0 : 0.9 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.FrontSide,
    transparent: true,
    // Write depth so overlapping translucent meshes stop re-sorting
    // every frame during rotation. The GLB has many near-coplanar
    // surfaces (inner/outer shells); without depthWrite the sort
    // order flipped with every camera rotation, blinking whole
    // panels in and out. Setting depthWrite=true trades "see through
    // everything" for rock-stable depth ordering — which is what
    // actually reads as a hologram, not flicker.
    depthWrite: true,
    // Push highlighted meshes slightly out of z so they never fight
    // coplanar defaults. Factor + units empirically small — enough
    // to separate stacks, not visible as displacement.
    polygonOffset: true,
    polygonOffsetFactor: highlighted ? -1 : 1,
    polygonOffsetUnits: highlighted ? -1 : 1,
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

function HologramModel({
  highlight,
  risk,
}: {
  highlight: CanonicalPart | null;
  risk: HighlightRisk;
}) {
  const { scene } = useGLTF("/iss-exterior.glb");
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsLike | null;
  const router = useRouter();

  const defaultMat = useMemo(() => makeMaterial(false), []);
  // Re-memo highlighted material on risk change so Fresnel palette
  // swaps blue↔red when the scene transitions between routine
  // highlighting and an active alert.
  const highlightedMat = useMemo(() => makeMaterial(true, risk), [risk]);
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
  const [anchor, setAnchor] = useState<THREE.Vector3 | null>(null);
  // Pixel offset of the caption from the leader-line anchor. User can
  // drag the card to taste; leader line follows. Reset when highlight
  // changes.
  const [captionOffset, setCaptionOffset] = useState<{ x: number; y: number }>({
    x: 180,
    y: -30,
  });

  useEffect(() => {
    const matching = highlight
      ? resolveMatchingMeshes(scene, SHIP_PARTS[highlight].match)
      : new Set<THREE.Mesh>();
    if (highlight && matching.size === 0) {
      console.warn(`[shipParts] no meshes matched for "${highlight}"`);
    }
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const isHighlighted = matching.has(child);
      child.material = isHighlighted ? highlightedMat : defaultMat;
      // Highlighted meshes render last so the warm-red glow always
      // reads on top of the neutral blue. Without this, Three.js's
      // internal sort can put a behind-camera default mesh on top
      // of the highlighted mesh during rotation.
      child.renderOrder = isHighlighted ? 2 : 0;
    });

    if (!highlight || matching.size === 0) {
      setBoxCenter(null);
      setAnchor(null);
      // On highlight clear, lerp camera back to the default full-ISS
      // framing so the × (and any other clear) feels like a real
      // "reset view" rather than leaving the camera stuck on the part.
      if (!highlight) {
        scene.updateMatrixWorld(true);
        const wholeBox = new THREE.Box3().setFromObject(scene);
        const wholeCenter = wholeBox.getCenter(new THREE.Vector3());
        const wholeSize = wholeBox.getSize(new THREE.Vector3());
        const wholeDiag = Math.max(wholeSize.length(), 0.1);
        lerpRef.current = {
          startPos: camera.position.clone(),
          startTarget: controls?.target.clone() ?? wholeCenter.clone(),
          endPos: new THREE.Vector3(
            wholeCenter.x,
            wholeCenter.y,
            wholeCenter.z + wholeDiag * 1.1,
          ),
          endTarget: wholeCenter,
          t0: performance.now(),
        };
      } else {
        lerpRef.current = null;
      }
      return;
    }
    // Reset the draggable offset on every fresh highlight so the card
    // shows up in a predictable spot, not where the last drag ended.
    setCaptionOffset({ x: 180, y: -30 });
    const box = new THREE.Box3();
    matching.forEach((m) => box.expandByObject(m));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const diag = Math.max(size.length(), 0.1);
    const dir = new THREE.Vector3(...CAMERA_OFFSET).normalize();
    const endPos = center.clone().add(dir.multiplyScalar(diag * CAMERA_DISTANCE_SCALE));

    lerpRef.current = {
      startPos: camera.position.clone(),
      startTarget: controls?.target.clone() ?? center.clone(),
      endPos,
      endTarget: center,
      t0: performance.now(),
    };
    setBoxCenter(center);

    // Leader-line anchor: the matched mesh whose *world-space bounding-
    // box centre* is closest to where the camera ends up. Must be the
    // world bbox centre, not `mesh.getWorldPosition()` — the latter
    // returns the mesh's local origin transformed to world space, which
    // glTF files often place at (0,0,0) or some arbitrary pivot far
    // from the visible geometry.
    let bestCenter: THREE.Vector3 | null = null;
    let anchorDist = Infinity;
    matching.forEach((m) => {
      m.updateWorldMatrix(true, false);
      const wb = new THREE.Box3().setFromObject(m);
      const wc = wb.getCenter(new THREE.Vector3());
      const d = wc.distanceTo(endPos);
      if (d < anchorDist) {
        anchorDist = d;
        bestCenter = wc;
      }
    });
    setAnchor(bestCenter ?? center);
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
      {highlight && anchor && (
        <Html
          position={[anchor.x, anchor.y, anchor.z]}
          zIndexRange={[100, 0]}
          style={{ pointerEvents: "none" }}
        >
          {/* Leader line + draggable caption card. The wrapper sits at
              the 3D anchor point; the card absolute-positions itself at
              `captionOffset` pixels from the anchor; the SVG line
              connects them. Card is pointer-events-auto so the user can
              drag it; anchor circle stays pointer-events-none. */}
          <div className="relative">
            <svg
              width={1}
              height={1}
              style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
            >
              <circle
                cx={0}
                cy={0}
                r={2.5}
                fill="none"
                stroke="#fff"
                strokeWidth={0.5}
              />
              <line
                x1={0}
                y1={0}
                x2={captionOffset.x}
                y2={captionOffset.y + 30}
                stroke="rgba(255,255,255,0.6)"
                strokeWidth={0.5}
              />
            </svg>
            <DraggableCaption
              offset={captionOffset}
              onOffsetChange={setCaptionOffset}
              kind={SHIP_PARTS[highlight].kind}
              name={SHIP_PARTS[highlight].displayName}
              description={SHIP_PARTS[highlight].description}
              onClose={() => router.push("/exterior")}
            />
          </div>
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
  const riskRaw = searchParams.get("risk");
  const risk: HighlightRisk = isHighlightRisk(riskRaw) ? riskRaw : "none";

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
        <HologramModel highlight={highlight} risk={risk} />
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
