import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import { Suspense, useRef, useState, useEffect } from "react";
import * as THREE from "three";

function PulseLattice() {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!group.current) return;
    group.current.rotation.y += delta * 0.11;
    group.current.rotation.x += delta * 0.035;
  });
  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[2.35, 1]} />
        <meshStandardMaterial
          color="#0891b2"
          wireframe
          transparent
          opacity={0.28}
          emissive="#0891b2"
          emissiveIntensity={0.12}
        />
      </mesh>
      <mesh rotation={[0.55, 0.9, 0.15]}>
        <torusKnotGeometry args={[1.05, 0.26, 48, 12]} />
        <meshStandardMaterial
          color="#22d3ee"
          wireframe
          transparent
          opacity={0.22}
          emissive="#06b6d4"
          emissiveIntensity={0.18}
        />
      </mesh>
    </group>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.55} />
      <pointLight position={[8, 6, 10]} intensity={1.1} color="#67e8f9" />
      <pointLight position={[-6, -5, -4]} intensity={0.45} color="#a78bfa" />
      <Float speed={1.2} rotationIntensity={0.35} floatIntensity={0.4}>
        <PulseLattice />
      </Float>
    </>
  );
}

/**
 * Capa WebGL decorativa: estructuras biomédicas abstractas en wireframe.
 * Respeta prefers-reduced-motion y no captura eventos táctiles.
 */
export function MedicalAmbient3D() {
  const [allow, setAllow] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setAllow(!mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (!allow) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[3] mix-blend-screen opacity-[0.42] sm:opacity-[0.5]"
      aria-hidden
    >
      <Canvas
        gl={{
          alpha: true,
          antialias: false,
          powerPreference: "low-power",
        }}
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.2, 6.2], fov: 42 }}
        onCreated={({ gl, scene }) => {
          scene.background = null;
          gl.setClearColor(0x000000, 0);
        }}
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
    </div>
  );
}
