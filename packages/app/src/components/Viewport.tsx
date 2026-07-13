/**
 * The graphics area.
 *
 * Per UI-UX.md §2C-D: an infinite space that gets as much of the screen as
 * possible, additive selection, a context menu, and a View Cube in the top right.
 * The chrome is deliberately dim so this is the brightest thing on screen.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, GizmoHelper, GizmoViewcube, OrbitControls, Edges } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useStore } from '../state/store.ts';

interface LoadedBody {
  id: string;
  geometry: THREE.BufferGeometry;
}

function useGlbBodies(glb: ArrayBuffer | null): LoadedBody[] {
  const [bodies, setBodies] = useState<LoadedBody[]>([]);

  useEffect(() => {
    if (!glb) {
      setBodies([]);
      return;
    }
    const loader = new GLTFLoader();
    loader.parse(glb, '', (gltf) => {
      const next: LoadedBody[] = [];
      gltf.scene.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          const mesh = node as THREE.Mesh;
          next.push({ id: mesh.name, geometry: mesh.geometry as THREE.BufferGeometry });
        }
      });
      setBodies(next);
    });
  }, [glb]);

  return bodies;
}

const CATEGORY_COLOR: Record<string, string> = {
  part: '#8b93a1',
  plaster: '#d8d2c4', // plaster is off-white; it should read as plaster
  printable: '#3f7fd8',
};

function Body({
  id,
  geometry,
  color,
  selected,
  showEdges,
  translucent,
  useVertexColors,
  offset,
  onPick,
}: {
  id: string;
  geometry: THREE.BufferGeometry;
  color: string;
  selected: boolean;
  showEdges: boolean;
  translucent: boolean;
  useVertexColors: boolean;
  offset: THREE.Vector3;
  onPick: (id: string, additive: boolean) => void;
}) {
  const hasColors = useVertexColors && geometry.hasAttribute('color');

  return (
    <mesh
      geometry={geometry}
      position={offset}
      castShadow
      receiveShadow
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onPick(id, e.shiftKey || e.ctrlKey || e.metaKey);
      }}
    >
      <meshStandardMaterial
        color={hasColors ? '#ffffff' : color}
        vertexColors={hasColors}
        roughness={0.72}
        metalness={0.02}
        transparent={translucent || selected}
        opacity={translucent ? 0.35 : 1}
        emissive={selected ? new THREE.Color('#2f81f7') : new THREE.Color('#000000')}
        emissiveIntensity={selected ? 0.35 : 0}
        side={THREE.DoubleSide}
      />
      {showEdges && <Edges threshold={25} color="#0c0e12" />}
    </mesh>
  );
}

/** Keeps the camera framing the model whenever a new one arrives. */
function AutoFrame({ bodies }: { bodies: LoadedBody[] }) {
  const { camera, controls } = useThree();
  const framed = useRef<string>('');

  useEffect(() => {
    if (bodies.length === 0) return;

    const key = bodies.map((b) => b.id).join('|');
    if (key === framed.current) return;
    framed.current = key;

    const box = new THREE.Box3();
    for (const body of bodies) {
      body.geometry.computeBoundingBox();
      if (body.geometry.boundingBox) box.union(body.geometry.boundingBox);
    }
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) || 1;

    camera.position.set(center.x + radius * 1.6, center.y - radius * 1.9, center.z + radius * 1.3);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (orbit?.target) {
      orbit.target.copy(center);
      orbit.update();
    }
  }, [bodies, camera, controls]);

  return null;
}

/** Smoothly eases the exploded-view offsets rather than snapping them. */
function useExplodeOffset(explode: number, direction: [number, number, number], scale: number) {
  const target = useMemo(
    () => new THREE.Vector3(...direction).multiplyScalar(explode * scale),
    [direction, explode, scale],
  );
  const current = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    current.current.lerp(target, Math.min(1, delta * 8));
  });

  return current.current;
}

function Scene() {
  const regen = useStore((s) => s.regen);
  const display = useStore((s) => s.display);
  const showHeatmap = useStore((s) => s.showHeatmap);
  const explode = useStore((s) => s.explode);
  const selection = useStore((s) => s.selection);
  const hidden = useStore((s) => s.hidden);
  const isolated = useStore((s) => s.isolated);
  const select = useStore((s) => s.select);
  const clearSelection = useStore((s) => s.clearSelection);

  const bodies = useGlbBodies(regen?.glb ?? null);
  const meta = useMemo(
    () => new Map((regen?.bodies ?? []).map((b) => [b.id, b])),
    [regen],
  );

  // Explode distance scales with the model, so it reads the same on a thimble and
  // on a garden pot.
  const scale = useMemo(() => {
    const box = new THREE.Box3();
    for (const b of bodies) {
      b.geometry.computeBoundingBox();
      if (b.geometry.boundingBox) box.union(b.geometry.boundingBox);
    }
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z) * 0.6 || 50;
  }, [bodies]);

  const visible = bodies.filter((b) => {
    if (isolated) return b.id === isolated;
    return !hidden.has(b.id);
  });

  return (
    <>
      <AutoFrame bodies={bodies} />

      <ambientLight intensity={0.55} />
      <directionalLight position={[80, -120, 160]} intensity={1.5} castShadow />
      <directionalLight position={[-100, 90, 60]} intensity={0.45} />

      {/* Empty space clears the selection, per Onshape. Spacebar does too. */}
      <mesh position={[0, 0, -1e4]} onClick={() => clearSelection()}>
        <planeGeometry args={[1e5, 1e5]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {visible.map((body) => (
        <ExplodedBody
          key={body.id}
          body={body}
          scale={scale}
          explode={explode}
          meta={meta.get(body.id)}
          display={display}
          showHeatmap={showHeatmap}
          selected={selection.includes(body.id)}
          onPick={select}
        />
      ))}

      <Grid
        args={[600, 600]}
        cellSize={10}
        cellColor="#232830"
        sectionSize={50}
        sectionColor="#2f3946"
        fadeDistance={900}
        infiniteGrid
        rotation={[Math.PI / 2, 0, 0]}
      />

      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />

      <GizmoHelper alignment="top-right" margin={[68, 68]}>
        <GizmoViewcube
          color="#1e2229"
          textColor="#a7b0bd"
          strokeColor="#39404b"
          hoverColor="#2f81f7"
        />
      </GizmoHelper>
    </>
  );
}

function ExplodedBody({
  body,
  scale,
  explode,
  meta,
  display,
  showHeatmap,
  selected,
  onPick,
}: {
  body: LoadedBody;
  scale: number;
  explode: number;
  meta?: { category: string; explode: [number, number, number] };
  display: string;
  showHeatmap: boolean;
  selected: boolean;
  onPick: (id: string, additive: boolean) => void;
}) {
  const offset = useExplodeOffset(explode, meta?.explode ?? [0, 0, 0], scale);

  return (
    <Body
      id={body.id}
      geometry={body.geometry}
      color={CATEGORY_COLOR[meta?.category ?? 'part'] ?? '#8b93a1'}
      selected={selected}
      showEdges={display === 'shaded-edges'}
      translucent={display === 'translucent'}
      useVertexColors={showHeatmap && body.id === 'master'}
      offset={offset}
      onPick={onPick}
    />
  );
}

export function Viewport() {
  const perspective = useStore((s) => s.perspective);
  const clearSelection = useStore((s) => s.clearSelection);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Spacebar clears the selection pool. Straight from the Onshape guide.
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('input, textarea')) {
        e.preventDefault();
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  return (
    <div className="relative h-full w-full bg-shell-900" data-testid="viewport">
      <Canvas
        shadows
        camera={{ position: [180, -220, 150], fov: 35, up: [0, 0, 1], far: 20000 }}
        orthographic={!perspective}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#0d0f13']} />
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
    </div>
  );
}
