/**
 * Mesh healing.
 *
 * This is the highest-risk module in the engine. Real STLs from real CAD tools
 * are frequently not solids: STL has no shared-vertex concept, exporters leak
 * holes, and normals get flipped. Everything downstream -- every boolean, every
 * volume, every mold -- assumes a watertight solid. So this module either
 * produces one or says plainly that it could not.
 *
 * The tiers, cheapest first:
 *   1. WELD      Fuse coincident vertices. STL stores unwelded triangle soup, so
 *                for the overwhelming majority of real files, welding IS the fix.
 *   2. FILL      Chain the remaining open edges into boundary loops and cap them.
 *   3. REMESH    Rebuild the surface from a signed-distance field sampled off a
 *                BVH. Slow and lossy, but it will heal input that tiers 1-2 can't.
 *   4. REFUSE    Report the failure. Never emit a mold from a mesh we don't trust.
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { manifold, withScope } from './wasm.js';
import {
  boundingBox,
  boxSize,
  fromManifold,
  isClosed,
  openEdgeCount,
  signedVolume,
  toManifoldMesh,
  triangleCount,
  volume,
} from './mesh.js';
import type { MeshData } from './types.js';

export type RepairTier = 'clean' | 'welded' | 'holes-filled' | 'remeshed' | 'failed';

export interface RepairReport {
  /** False means: do not build a mold from this. */
  ok: boolean;
  tier: RepairTier;
  openEdgesBefore: number;
  openEdgesAfter: number;
  /** The mesh was inside-out and we corrected it. */
  windingFlipped: boolean;
  verticesWelded: number;
  trianglesRemoved: number;
  /** Manifold's own verdict on the final mesh. */
  manifoldStatus: string;
  /** Plain-language notes, surfaced verbatim in the UI. */
  messages: string[];
}

export interface RepairResult {
  mesh: MeshData;
  report: RepairReport;
}

export interface RepairOptions {
  /**
   * Vertex merge distance. Defaults to 1e-5 of the bounding-box diagonal, which
   * is tight enough to preserve detail and loose enough to catch the float error
   * an STL exporter introduces when it writes the same corner three times.
   */
  weldTolerance?: number;
  /** Allow the expensive SDF rebuild. Off in tests that assert cheaper tiers. */
  allowRemesh?: boolean;
  /** Voxels along the longest axis when remeshing. Higher = truer but slower. */
  remeshResolution?: number;
}

export async function repair(input: MeshData, opts: RepairOptions = {}): Promise<RepairResult> {
  const messages: string[] = [];
  const openEdgesBefore = openEdgeCount(input);

  const box = boundingBox(input);
  const size = boxSize(box);
  const diagonal = Math.hypot(size[0], size[1], size[2]) || 1;
  const weldTolerance = opts.weldTolerance ?? diagonal * 1e-5;

  // --- Tier 0: drop garbage triangles -------------------------------------
  const cleaned = dropDegenerate(input);
  const trianglesRemoved = triangleCount(input) - triangleCount(cleaned);
  if (trianglesRemoved > 0) {
    messages.push(`Removed ${trianglesRemoved} degenerate or non-finite triangle(s).`);
  }

  // --- Tier 1: weld -------------------------------------------------------
  const welded = weld(cleaned, weldTolerance);
  const verticesWelded = cleaned.positions.length / 3 - welded.positions.length / 3;
  if (verticesWelded > 0) {
    messages.push(
      `Welded ${verticesWelded} duplicate vertices (STL stores unshared triangle corners).`,
    );
  }

  let mesh = welded;
  let tier: RepairTier = openEdgesBefore === 0 && verticesWelded === 0 ? 'clean' : 'welded';

  // --- Tier 2: fill holes -------------------------------------------------
  if (!isClosed(mesh)) {
    const before = openEdgeCount(mesh);
    const filled = fillHoles(mesh);
    if (isClosed(filled)) {
      mesh = filled;
      tier = 'holes-filled';
      messages.push(`Filled ${before} open edge(s) by capping boundary loops.`);
    } else {
      messages.push(
        `${openEdgeCount(filled)} open edge(s) survived hole filling; falling back to a surface rebuild.`,
      );
      mesh = filled;
    }
  }

  // --- Winding ------------------------------------------------------------
  // A closed mesh wound inside-out has negative signed volume. Manifold would
  // read it as a void rather than a solid, and every later boolean would invert.
  let windingFlipped = false;
  if (isClosed(mesh) && signedVolume(mesh) < 0) {
    mesh = flipWinding(mesh);
    windingFlipped = true;
    messages.push('Mesh was inside-out; reversed triangle winding.');
  }

  // --- Verify with Manifold itself ----------------------------------------
  let status = await manifoldStatus(mesh);

  // --- Tier 3: SDF rebuild ------------------------------------------------
  if (status !== 'NoError' && (opts.allowRemesh ?? true)) {
    messages.push(
      `Manifold rejected the mesh (${status}); rebuilding the surface from a distance field.`,
    );
    try {
      mesh = await remesh(mesh, opts.remeshResolution ?? 96);
      tier = 'remeshed';
      status = await manifoldStatus(mesh);
      if (status === 'NoError') {
        messages.push('Surface rebuild succeeded. Fine detail may have been softened.');
      }
    } catch (err) {
      messages.push(`Surface rebuild failed: ${(err as Error).message}`);
    }
  }

  // --- The solidity gate --------------------------------------------------
  // Closed is not the same as solid. Cap a loose triangle with a centroid fan
  // and you get a mesh that is topologically watertight yet encloses nothing --
  // and a mold cut from a zero-volume "solid" is silent nonsense. Surface models
  // exported as sheets land here too, which is a mistake worth naming out loud.
  const enclosed = volume(mesh);
  const minimumVolume = Math.pow(diagonal, 3) * 1e-6;
  const isSolid = enclosed > minimumVolume;
  if (!isSolid) {
    messages.push(
      'This mesh encloses no volume -- it is a surface or a sheet, not a solid. ' +
        'Check that you exported a closed solid body rather than open surfaces.',
    );
  }

  const ok = status === 'NoError' && isClosed(mesh) && isSolid;
  if (!ok) {
    tier = 'failed';
    messages.push(
      'This mesh could not be made watertight. A mold built from it would be wrong, ' +
        'so nothing has been generated. Repair it in your CAD tool (check for holes, ' +
        'self-intersections, and loose shells) and re-import.',
    );
  }

  return {
    mesh,
    report: {
      ok,
      tier,
      openEdgesBefore,
      openEdgesAfter: openEdgeCount(mesh),
      windingFlipped,
      verticesWelded: Math.max(0, verticesWelded),
      trianglesRemoved,
      manifoldStatus: status,
      messages,
    },
  };
}

/** Ask Manifold whether it can turn this mesh into a solid, and why not. */
async function manifoldStatus(data: MeshData): Promise<string> {
  return withScope(async (s) => {
    const wasm = await manifold();
    const mesh = await toManifoldMesh(data);
    // Manifold's own weld pass, on top of ours: it merges verts along open edges.
    mesh.merge();
    const solid = s.keep(wasm.Manifold.ofMesh(mesh));
    return solid.status();
  });
}

/** Remove non-finite and zero-area triangles. */
function dropDegenerate(data: MeshData): MeshData {
  const { positions, indices } = data;
  const kept: number[] = [];

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!, b = indices[t + 1]!, c = indices[t + 2]!;
    if (a === b || b === c || a === c) continue;

    let finite = true;
    for (const v of [a, b, c]) {
      for (let k = 0; k < 3; k++) {
        if (!Number.isFinite(positions[v * 3 + k]!)) finite = false;
      }
    }
    if (!finite) continue;

    kept.push(a, b, c);
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(kept) };
}

/**
 * Fuse vertices that occupy the same point. Quantising to a grid of `tolerance`
 * makes this exact and order-independent; two points that round to the same cell
 * are the same vertex. Vertices left unreferenced are dropped.
 */
export function weld(data: MeshData, tolerance: number): MeshData {
  const inv = 1 / Math.max(tolerance, 1e-12);
  const map = new Map<string, number>();
  const positions: number[] = [];
  const remap = new Uint32Array(data.positions.length / 3);

  for (let v = 0; v < data.positions.length / 3; v++) {
    const x = data.positions[v * 3]!;
    const y = data.positions[v * 3 + 1]!;
    const z = data.positions[v * 3 + 2]!;
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;

    let idx = map.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      map.set(key, idx);
      positions.push(x, y, z);
    }
    remap[v] = idx;
  }

  const indices: number[] = [];
  for (let t = 0; t < data.indices.length; t += 3) {
    const a = remap[data.indices[t]!]!;
    const b = remap[data.indices[t + 1]!]!;
    const c = remap[data.indices[t + 2]!]!;
    // Welding can collapse a sliver triangle to a line. Drop it.
    if (a === b || b === c || a === c) continue;
    indices.push(a, b, c);
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/**
 * Cap holes. Boundary edges (used by exactly one triangle) are chained into
 * loops and each loop is fanned from its centroid. A centroid fan is not the
 * minimal-area patch, but it is watertight and it never self-intersects for the
 * near-planar loops that exporter holes actually produce.
 */
export function fillHoles(data: MeshData): MeshData {
  const boundary = boundaryEdges(data);
  if (boundary.size === 0) return data;

  const positions = Array.from(data.positions);
  const indices = Array.from(data.indices);

  for (const loop of chainLoops(boundary)) {
    if (loop.length < 3) continue;

    let cx = 0, cy = 0, cz = 0;
    for (const v of loop) {
      cx += data.positions[v * 3]!;
      cy += data.positions[v * 3 + 1]!;
      cz += data.positions[v * 3 + 2]!;
    }
    const n = loop.length;
    const center = positions.length / 3;
    positions.push(cx / n, cy / n, cz / n);

    // The loop is traversed along the boundary's directed edges, which point
    // opposite the surface's winding -- so fan with (center, next, cur) to keep
    // the patch's normals consistent with the rest of the shell.
    for (let i = 0; i < n; i++) {
      const cur = loop[i]!;
      const next = loop[(i + 1) % n]!;
      indices.push(center, next, cur);
    }
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** Directed edges that belong to exactly one triangle -- i.e. the mesh's rim. */
function boundaryEdges(data: MeshData): Map<number, number> {
  const seen = new Map<string, number>();
  const idx = data.indices;

  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!;
      const b = tri[(e + 1) % 3]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }

  // Re-walk to recover direction for the edges that turned out to be unshared.
  const directed = new Map<number, number>();
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!;
      const b = tri[(e + 1) % 3]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (seen.get(key) === 1) directed.set(a, b);
    }
  }
  return directed;
}

/** Walk directed boundary edges into closed loops. */
function chainLoops(edges: Map<number, number>): number[][] {
  const remaining = new Map(edges);
  const loops: number[][] = [];

  while (remaining.size > 0) {
    const start = remaining.keys().next().value as number;
    const loop: number[] = [];
    let cur: number | undefined = start;

    while (cur !== undefined && remaining.has(cur)) {
      loop.push(cur);
      const next: number | undefined = remaining.get(cur);
      remaining.delete(cur);
      cur = next;
      if (cur === start) break;
    }

    if (loop.length >= 3) loops.push(loop);
  }

  return loops;
}

export function flipWinding(data: MeshData): MeshData {
  const indices = new Uint32Array(data.indices);
  for (let t = 0; t < indices.length; t += 3) {
    const tmp = indices[t + 1]!;
    indices[t + 1] = indices[t + 2]!;
    indices[t + 2] = tmp;
  }
  return { positions: new Float32Array(data.positions), indices };
}

/**
 * Last resort: resample the shape as a signed-distance field and re-extract a
 * surface from it. The output is guaranteed watertight because a level set of a
 * scalar field always is -- the shape just gets rounded off at the voxel scale.
 *
 * Distance comes from a BVH (exact, cheap). Sign is the hard part: simple ray
 * parity is exactly what fails on a mesh with holes, since a ray through a hole
 * flips the answer. Instead we estimate the winding number along several rays --
 * counting +1 for each back-face crossing and -1 for each front-face crossing --
 * and average. A hole corrupts individual rays, but the average still lands on
 * the right side of 0.5, which is the property we need.
 */
export async function remesh(data: MeshData, resolution: number): Promise<MeshData> {
  const wasm = await manifold();

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.positions), 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(data.indices), 1));
  const bvh = new MeshBVH(geom);

  const box = boundingBox(data);
  const size = boxSize(box);
  const longest = Math.max(size[0], size[1], size[2]) || 1;
  const edgeLength = longest / resolution;

  // Pad so the level set has room to close around the surface.
  const pad = edgeLength * 3;
  const bounds = {
    min: [box.min[0] - pad, box.min[1] - pad, box.min[2] - pad] as [number, number, number],
    max: [box.max[0] + pad, box.max[1] + pad, box.max[2] + pad] as [number, number, number],
  };

  const target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const point = new THREE.Vector3();
  const ray = new THREE.Ray();

  // Deliberately irrational directions: no ray runs parallel to an axis, so
  // none of them graze a coplanar face and produce a degenerate crossing count.
  const directions = [
    new THREE.Vector3(0.5257, 0.8507, 0.0).normalize(),
    new THREE.Vector3(-0.8507, 0.0, 0.5257).normalize(),
    new THREE.Vector3(0.0, 0.5257, -0.8507).normalize(),
    new THREE.Vector3(0.577, -0.577, 0.577).normalize(),
    new THREE.Vector3(-0.3574, 0.9342, 0.0).normalize(),
  ];

  const inside = (p: THREE.Vector3): boolean => {
    let sum = 0;
    for (const dir of directions) {
      ray.set(p, dir);
      const hits = bvh.raycast(ray, THREE.DoubleSide);
      let winding = 0;
      for (const hit of hits) {
        if (!hit.face) continue;
        // Ray leaving the solid crosses a front face; entering crosses a back face.
        winding += hit.face.normal.dot(dir) > 0 ? 1 : -1;
      }
      sum += winding;
    }
    return sum / directions.length > 0.5;
  };

  const sdf = (p: [number, number, number]): number => {
    point.set(p[0], p[1], p[2]);
    const hit = bvh.closestPointToPoint(point, target);
    const distance = hit ? hit.distance : Infinity;
    // Manifold's convention for a level set: positive inside the solid.
    return inside(point) ? distance : -distance;
  };

  return withScope((s) => {
    const solid = s.keep(wasm.Manifold.levelSet(sdf, bounds, edgeLength, 0));
    if (solid.isEmpty()) {
      throw new Error('the distance field produced no surface');
    }
    return fromManifold(solid);
  });
}
