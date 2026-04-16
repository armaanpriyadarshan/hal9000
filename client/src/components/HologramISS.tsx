"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Suspense, useEffect, useRef, useMemo } from "react";
import * as THREE from "three";

const HOLOGRAM_COLOR = new THREE.Color("#00e5ff");
const GRID_COLOR = new THREE.Color("#003844");

const hologramVertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const hologramFragmentShader = `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    // Fresnel edge glow
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.0);

    // Scanlines
    float scanline = sin(vPosition.y * 80.0 + uTime * 2.0) * 0.5 + 0.5;
    scanline = smoothstep(0.3, 0.7, scanline) * 0.3 + 0.7;

    // Horizontal flicker
    float flicker = sin(uTime * 12.0) * 0.03 + 0.97;

    // Base alpha — wireframe-ish transparency
    float alpha = (fresnel * 0.6 + 0.15) * scanline * flicker;

    gl_FragColor = vec4(uColor, alpha);
  }
`;

function HologramModel() {
  const { scene } = useGLTF("/iss_interiorinternational_space_station.glb");
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const hologramMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: hologramVertexShader,
        fragmentShader: hologramFragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: HOLOGRAM_COLOR },
        },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  );

  useEffect(() => {
    materialRef.current = hologramMaterial;
  }, [hologramMaterial]);

  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = hologramMaterial;
      }
    });
    return clone;
  }, [scene, hologramMaterial]);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.002;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={clonedScene} scale={0.15} />
    </group>
  );
}

function Grid() {
  return (
    <gridHelper
      args={[40, 40, GRID_COLOR, GRID_COLOR]}
      position={[0, -4, 0]}
    />
  );
}

export default function HologramISS() {
  return (
    <Canvas
      camera={{ position: [0, 3, 12], fov: 50, near: 0.1, far: 200 }}
      gl={{ toneMapping: THREE.NoToneMapping }}
      style={{ background: "#000508" }}
    >
      <ambientLight intensity={0.05} />
      <Suspense fallback={null}>
        <HologramModel />
      </Suspense>
      <Grid />
      <EffectComposer>
        <Bloom
          intensity={1.5}
          luminanceThreshold={0}
          luminanceSmoothing={0.9}
          mipmapBlur
        />
      </EffectComposer>
    </Canvas>
  );
}
