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
  target,
  clip,
  onPick,
}: {
  id: string;
  geometry: THREE.BufferGeometry;
  color: string;
  selected: boolean;
  showEdges: boolean;
  translucent: boolean;
  useVertexColors: boolean;
  target: THREE.Vector3;
  clip: THREE.Plane[];
  onPick: (id: string, additive: boolean, point: THREE.Vector3) => void;
}) {
  const hasColors = useVertexColors && geometry.hasAttribute('color');
  const ref = useRef<THREE.Mesh>(null);

  // Ease the piece toward its exploded position by mutating the object directly.
  // Passing a Vector3 as a `position` prop would not work: r3f copies props into
  // the object at RENDER time, and nothing here re-renders while the slider moves,
  // so a mutated prop object is simply never read again.
  useFrame((_, delta) => {
    ref.current?.position.lerp(target, Math.min(1, delta * 8));
  });

  return (
    <mesh
      ref={ref}
      geometry={geometry}
      castShadow
      receiveShadow
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onPick(id, e.shiftKey || e.ctrlKey || e.metaKey, e.point);
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
        clippingPlanes={clip}
        clipShadows
      />
      {/* Edges are a separate line material and are NOT clipped by the section plane
          -- so left alone they leave a ghost wireframe of the material you just cut
          away, hovering in space like the outline of a box that is not there. */}
      {showEdges && clip.length === 0 && <Edges threshold={25} color="#0c0e12" />}
    </mesh>
  );
}

/**
 * The cut face.
 *
 * A clipping plane alone leaves you looking into a hollow shell: the near wall is
 * removed and you see the *inside* of the far wall, which reads as an empty box
 * rather than a solid block of plaster with a cavity in it. That is precisely the
 * wrong impression -- the whole point of sectioning a mold is to see how much
 * plaster is where.
 *
 * So the cut is capped. The standard stencil trick: draw the solid's back faces to
 * increment the stencil buffer and its front faces to decrement, which leaves a
 * non-zero stencil exactly where the plane passes through material. Then paint a
 * quad over the plane, masked to that region. The result is a solid cut face.
 */
function SectionCaps({
  plane,
  bodies,
  visible,
  scale,
}: {
  plane: THREE.Plane;
  bodies: LoadedBody[];
  visible: Set<string>;
  scale: number;
}) {
  const capRef = useRef<THREE.Mesh>(null);
  const { gl } = useThree();

  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  // Keep the cap quad sitting on the plane, facing along it.
  useFrame(() => {
    const cap = capRef.current;
    if (!cap) return;
    cap.position.copy(plane.normal).multiplyScalar(-plane.constant);
    cap.lookAt(cap.position.clone().add(plane.normal));
  });

  const shown = bodies.filter((b) => visible.has(b.id));

  return (
    <>
      {shown.map((body) => (
        <group key={`stencil-${body.id}`}>
          {/* Back faces: +1 where we are inside the solid. */}
          <mesh geometry={body.geometry} renderOrder={1}>
            <meshBasicMaterial
              side={THREE.BackSide}
              clippingPlanes={[plane]}
              colorWrite={false}
              depthWrite={false}
              stencilWrite
              stencilFunc={THREE.AlwaysStencilFunc}
              stencilFail={THREE.IncrementWrapStencilOp}
              stencilZFail={THREE.IncrementWrapStencilOp}
              stencilZPass={THREE.IncrementWrapStencilOp}
            />
          </mesh>
          {/* Front faces: -1 again once we have passed back out. */}
          <mesh geometry={body.geometry} renderOrder={1}>
            <meshBasicMaterial
              side={THREE.FrontSide}
              clippingPlanes={[plane]}
              colorWrite={false}
              depthWrite={false}
              stencilWrite
              stencilFunc={THREE.AlwaysStencilFunc}
              stencilFail={THREE.DecrementWrapStencilOp}
              stencilZFail={THREE.DecrementWrapStencilOp}
              stencilZPass={THREE.DecrementWrapStencilOp}
            />
          </mesh>
        </group>
      ))}

      {/* The cap itself, painted only where the stencil says there is material. */}
      <mesh ref={capRef} renderOrder={2}>
        <planeGeometry args={[scale * 40, scale * 40]} />
        <meshStandardMaterial
          color="#b9b2a2"
          roughness={0.9}
          metalness={0}
          side={THREE.DoubleSide}
          stencilWrite
          stencilRef={0}
          stencilFunc={THREE.NotEqualStencilFunc}
          stencilFail={THREE.ReplaceStencilOp}
          stencilZFail={THREE.ReplaceStencilOp}
          stencilZPass={THREE.ReplaceStencilOp}
        />
      </mesh>
    </>
  );
}

/** A ring marking where the pour channel will meet the part. */
function SpareMarker({
  position,
  bodies,
}: {
  position: [number, number, number];
  bodies: LoadedBody[];
}) {
  const size = useMemo(() => {
    const box = new THREE.Box3();
    for (const b of bodies) {
      b.geometry.computeBoundingBox();
      if (b.geometry.boundingBox) box.union(b.geometry.boundingBox);
    }
    const s = box.getSize(new THREE.Vector3());
    return Math.max(s.x, s.y, s.z) || 50;
  }, [bodies]);

  const r = size * 0.055;

  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[r * 0.35, 12, 12]} />
        <meshBasicMaterial color="#2f81f7" depthTest={false} transparent opacity={0.95} />
      </mesh>
      <mesh>
        <torusGeometry args={[r, r * 0.12, 8, 32]} />
        <meshBasicMaterial color="#2f81f7" depthTest={false} transparent opacity={0.8} />
      </mesh>
    </group>
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

    camera.position.set(center.x + radius * 1.9, center.y - radius * 2.2, center.z + radius * 1.5);
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


function Scene() {
  const regen = useStore((s) => s.regen);
  const display = useStore((s) => s.display);
  const showHeatmap = useStore((s) => s.showHeatmap);
  const explode = useStore((s) => s.explode);
  const selection = useStore((s) => s.selection);
  const hidden = useStore((s) => s.hidden);
  const isolated = useStore((s) => s.isolated);
  const tab = useStore((s) => s.tab);
  const section = useStore((s) => s.section);
  const picking = useStore((s) => s.picking);
  const features = useStore((s) => s.features);
  const select = useStore((s) => s.select);
  const pickedPoint = useStore((s) => s.pickedPoint);
  const clearSelection = useStore((s) => s.clearSelection);

  /**
   * A click on a body either selects it, or -- if a dialog field is armed -- fills
   * that field with where you clicked.
   */
  const handlePick = (id: string, additive: boolean, point: THREE.Vector3) => {
    if (picking === 'spare') {
      pickedPoint(point.x, point.y, point.z);
      return;
    }
    select(id, additive);
  };

  // Where the pour spare currently sits, so it is not an invisible setting.
  const sparePos = useMemo(() => {
    const spare = features.find((f) => f.type === 'spare');
    const p = spare?.params.sparePosition as [number, number, number] | null | undefined;
    return p ?? null;
  }, [features]);

  const bodies = useGlbBodies(regen?.glb ?? null);
  const meta = useMemo(
    () => new Map((regen?.bodies ?? []).map((b) => [b.id, b])),
    [regen],
  );

  // Explode travel is proportional to the model, so it reads the same on a thimble
  // and on a garden pot. Kept modest deliberately: the camera frames the assembled
  // mold, and a generous explode simply throws the pieces off screen.
  const scale = useMemo(() => {
    const box = new THREE.Box3();
    for (const b of bodies) {
      b.geometry.computeBoundingBox();
      if (b.geometry.boundingBox) box.union(b.geometry.boundingBox);
    }
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z) * 0.22 || 20;
  }, [bodies]);

  /**
   * Which bodies a tab shows by default.
   *
   * Without this, opening a document greets you with two opaque blue trays parked
   * in front of everything, and the undercut heatmap -- the one thing that tells
   * you whether your part can be cast at all -- is buried inside them. The Part
   * Studio is about the part; the Mold tab is about the mold.
   *
   * It is a default, not a rule: the Parts List eyeballs still override it.
   */
  const shownByTab = (category: string | undefined): boolean => {
    if (tab === 'part-studio') return category === 'part';
    if (tab === 'mold') return category === 'plaster' || category === 'printable';
    return true;
  };

  const visible = bodies.filter((b) => {
    if (isolated) return b.id === isolated;
    if (hidden.has(b.id)) return false;
    return shownByTab(meta.get(b.id)?.category);
  });

  /**
   * The section plane, positioned against the model's own bounds so the slider
   * sweeps the part rather than empty space.
   */
  const plane = useMemo(() => {
    const box = new THREE.Box3();
    for (const b of visible) {
      b.geometry.computeBoundingBox();
      if (b.geometry.boundingBox) box.union(b.geometry.boundingBox);
    }
    if (box.isEmpty()) return null;

    const normal = new THREE.Vector3(
      section.axis === 'x' ? 1 : 0,
      section.axis === 'y' ? 1 : 0,
      section.axis === 'z' ? 1 : 0,
    );
    if (section.flip) normal.negate();

    const lo = box.min[section.axis];
    const hi = box.max[section.axis];
    // Pad a little so the extremes of the slider clear the model entirely.
    const span = hi - lo;
    const at = lo - span * 0.02 + span * 1.04 * section.position;

    // A plane keeps whatever lies on the NEGATIVE side of its normal, so the
    // constant is the negated signed distance from the origin.
    return new THREE.Plane(normal, -at * (section.flip ? -1 : 1));
  }, [visible, section.axis, section.position, section.flip]);

  const clip = section.enabled && plane ? [plane] : [];
  const visibleIds = useMemo(() => new Set(visible.map((b) => b.id)), [visible]);

  return (
    <>
      <AutoFrame bodies={bodies} />

      {section.enabled && plane && (
        <SectionCaps plane={plane} bodies={visible} visible={visibleIds} scale={scale} />
      )}

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
          clip={clip}
          onPick={handlePick}
        />
      ))}

      {/* Where the pour spare will go. Without this the position is an invisible
          setting, and you cannot check by eye that the click landed where you meant. */}
      {tab === 'part-studio' && sparePos && bodies.length > 0 && (
        <SpareMarker position={sparePos} bodies={visible} />
      )}

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
  clip,
  onPick,
}: {
  body: LoadedBody;
  scale: number;
  explode: number;
  meta?: { category: string; explode: [number, number, number] };
  display: string;
  showHeatmap: boolean;
  selected: boolean;
  clip: THREE.Plane[];
  onPick: (id: string, additive: boolean, point: THREE.Vector3) => void;
}) {
  const direction = meta?.explode ?? [0, 0, 0];
  const target = useMemo(
    () =>
      new THREE.Vector3(direction[0], direction[1], direction[2]).multiplyScalar(
        explode * scale,
      ),
    [direction, explode, scale],
  );

  return (
    <Body
      id={body.id}
      geometry={body.geometry}
      color={CATEGORY_COLOR[meta?.category ?? 'part'] ?? '#8b93a1'}
      selected={selected}
      showEdges={display === 'shaded-edges'}
      translucent={display === 'translucent'}
      useVertexColors={showHeatmap && body.id === 'master'}
      target={target}
      clip={clip}
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
        // The section caps are drawn with the stencil buffer, which has to be asked
        // for explicitly -- three.js does not allocate one by default.
        gl={{ antialias: true, stencil: true, localClippingEnabled: true }}
      >
        <color attach="background" args={['#0d0f13']} />
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
    </div>
  );
}
