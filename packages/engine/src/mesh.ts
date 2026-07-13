/**
 * Conversions between plain MeshData and Manifold solids, plus the geometric
 * measurements the rest of the engine and the UI need.
 */
import type { Manifold, Mesh } from 'manifold-3d';
import { manifold } from './wasm.js';
import type { Box, MeshData, Vec3 } from './types.js';

/** Wrap raw triangles as a Manifold Mesh (no validation, no welding). */
export async function toManifoldMesh(data: MeshData): Promise<Mesh> {
  const wasm = await manifold();
  return new wasm.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(data.positions),
    triVerts: new Uint32Array(data.indices),
  });
}

/** Extract plain triangles from a Manifold solid. */
export function fromManifold(solid: Manifold): MeshData {
  const mesh = solid.getMesh();
  const numProp = mesh.numProp;

  if (numProp === 3) {
    return {
      positions: new Float32Array(mesh.vertProperties),
      indices: new Uint32Array(mesh.triVerts),
    };
  }

  // Manifold interleaves extra vertex properties after xyz; strip them out.
  const vertCount = mesh.vertProperties.length / numProp;
  const positions = new Float32Array(vertCount * 3);
  for (let v = 0; v < vertCount; v++) {
    positions[v * 3 + 0] = mesh.vertProperties[v * numProp + 0]!;
    positions[v * 3 + 1] = mesh.vertProperties[v * numProp + 1]!;
    positions[v * 3 + 2] = mesh.vertProperties[v * numProp + 2]!;
  }
  return { positions, indices: new Uint32Array(mesh.triVerts) };
}

export function boundingBox(data: MeshData): Box {
  const p = data.positions;
  if (p.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = p[i + a]!;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  }
  return { min, max };
}

export function boxSize(box: Box): Vec3 {
  return [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
}

export function boxCenter(box: Box): Vec3 {
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
}

/**
 * Signed volume via the divergence theorem (sum of signed tetrahedra from the
 * origin). Works on any closed mesh regardless of where it sits in space, and a
 * negative result means the triangles are wound inside-out -- which is exactly
 * how `repair` detects flipped normals.
 */
export function signedVolume(data: MeshData): number {
  const { positions: p, indices: idx } = data;
  let total = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3;
    const b = idx[t + 1]! * 3;
    const c = idx[t + 2]! * 3;
    const ax = p[a]!, ay = p[a + 1]!, az = p[a + 2]!;
    const bx = p[b]!, by = p[b + 1]!, bz = p[b + 2]!;
    const cx = p[c]!, cy = p[c + 1]!, cz = p[c + 2]!;
    total +=
      ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return total / 6;
}

export function volume(data: MeshData): number {
  return Math.abs(signedVolume(data));
}

export function surfaceArea(data: MeshData): number {
  const { positions: p, indices: idx } = data;
  let total = 0;
  for (let t = 0; t < idx.length; t += 3) {
    total += triangleArea(p, idx[t]!, idx[t + 1]!, idx[t + 2]!);
  }
  return total;
}

export function triangleArea(p: Float32Array, i0: number, i1: number, i2: number): number {
  const a = i0 * 3, b = i1 * 3, c = i2 * 3;
  const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
  const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return Math.hypot(cx, cy, cz) / 2;
}

/** Unit normal of triangle `t` (a triangle index, not a vertex index). */
export function triangleNormal(data: MeshData, t: number): Vec3 {
  const { positions: p, indices: idx } = data;
  const a = idx[t * 3]! * 3, b = idx[t * 3 + 1]! * 3, c = idx[t * 3 + 2]! * 3;
  const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
  const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function triangleCentroid(data: MeshData, t: number): Vec3 {
  const { positions: p, indices: idx } = data;
  const a = idx[t * 3]! * 3, b = idx[t * 3 + 1]! * 3, c = idx[t * 3 + 2]! * 3;
  return [
    (p[a]! + p[b]! + p[c]!) / 3,
    (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3,
    (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3,
  ];
}

export function triangleCount(data: MeshData): number {
  return data.indices.length / 3;
}

/**
 * Closed means every edge is shared by exactly two triangles. This is the
 * cheap, definitive watertightness test, and it runs on raw triangles before
 * Manifold ever sees them -- which is what lets `repair` explain *why* a mesh
 * failed instead of just reporting an empty solid.
 */
export function isClosed(data: MeshData): boolean {
  return openEdgeCount(data) === 0;
}

/** Number of edges not shared by exactly two triangles. 0 == watertight. */
export function openEdgeCount(data: MeshData): number {
  const counts = new Map<string, number>();
  const idx = data.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!;
      const b = tri[(e + 1) % 3]!;
      // Undirected key: an edge is the same edge from either triangle.
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const n of counts.values()) {
    if (n !== 2) bad++;
  }
  return bad;
}
