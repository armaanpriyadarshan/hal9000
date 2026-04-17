"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Suspense, useEffect } from "react";
import * as THREE from "three";

function HologramModel() {
  const { scene } = useGLTF("/iss-exterior.glb");

  useEffect(() => {
    const HIGH_VERTEX_COUNT = 2000;
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.9,
    });
    const hiddenMat = new THREE.MeshBasicMaterial({ visible: false });
    const meshes: THREE.Mesh[] = [];
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });
    for (const mesh of meshes) {
      if (mesh.userData.hologramProcessed) continue;
      const geom = mesh.geometry;
      const vertexCount = geom.attributes.position?.count ?? 0;
      let edgeGeom: THREE.BufferGeometry;
      if (vertexCount > HIGH_VERTEX_COUNT) {
        geom.computeBoundingBox();
        const bb = geom.boundingBox!;
        const box = new THREE.BoxGeometry(
          bb.max.x - bb.min.x,
          bb.max.y - bb.min.y,
          bb.max.z - bb.min.z,
        );
        box.translate(
          (bb.max.x + bb.min.x) / 2,
          (bb.max.y + bb.min.y) / 2,
          (bb.max.z + bb.min.z) / 2,
        );
        edgeGeom = new THREE.EdgesGeometry(box);
        box.dispose();
      } else {
        edgeGeom = new THREE.EdgesGeometry(geom, 15);
      }
      const line = new THREE.LineSegments(edgeGeom, lineMat);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((mat) => mat.dispose());
      mesh.material = hiddenMat;
      mesh.add(line);
      mesh.userData.hologramProcessed = true;
    }
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
        <Bloom intensity={0.5} luminanceThreshold={0.3} mipmapBlur />
      </EffectComposer>
      <OrbitControls enableZoom enableDamping />
    </Canvas>
  );
}
