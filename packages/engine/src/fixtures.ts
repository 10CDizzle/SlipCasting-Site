/**
 * Procedurally generated test parts. Generated rather than committed as binary
 * blobs so they are reviewable, diffable, and parametric.
 *
 * The set is chosen to cover the ways this engine can be wrong:
 *
 *  - `cup`, `cylinder`, `sphere`  Must succeed, with known analytic volumes.
 *  - `cubeWithBoss`               Flat faces with zero draft: must read 'shallow'.
 *  - `torus`                      Moldable, but ONLY along its axis. Split at the
 *                                 equator a donut has no undercuts; split along any
 *                                 in-plane direction it does.
 *  - `handledMug`                 The sharpest test in the suite. It is un-moldable
 *                                 along its own axis -- the naive guess -- because the
 *                                 handle's inner surface is occluded from above and
 *                                 below. It IS moldable perpendicular to the handle's
 *                                 loop, which is exactly how real mug molds are
 *                                 parted. The pull-direction search has to find that.
 *  - `hollowSphere`               Genuinely impossible: an enclosed internal void is
 *                                 invisible from every direction. Nothing can mold it,
 *                                 and the engine must say so rather than guess.
 *  - soup / holed / flipped       Must be repaired, or honestly refused.
 */
import { manifold, withScope } from './wasm.js';
import { fromManifold, toManifoldMesh } from './mesh.js';
import type { MeshData, Vec3 } from './types.js';

interface Builder {
  positions: number[];
  indices: number[];
}

function newBuilder(): Builder {
  return { positions: [], indices: [] };
}

function addVertex(b: Builder, x: number, y: number, z: number): number {
  const i = b.positions.length / 3;
  b.positions.push(x, y, z);
  return i;
}

function addTri(b: Builder, a: number, c: number, d: number): void {
  b.indices.push(a, c, d);
}

function addQuad(b: Builder, a: number, c: number, d: number, e: number): void {
  addTri(b, a, c, d);
  addTri(b, a, d, e);
}

function finish(b: Builder): MeshData {
  return {
    positions: new Float32Array(b.positions),
    indices: new Uint32Array(b.indices),
  };
}

/**
 * Revolve a 2D profile (in the XZ half-plane, x >= 0) around the Z axis.
 * The profile is an open polyline from bottom to top; it is capped automatically
 * where it touches the axis. This is how the cup, cylinder and sphere are built.
 */
export function revolve(profile: Array<[number, number]>, segments = 64): MeshData {
  const b = newBuilder();
  const rings: number[][] = [];

  for (const [r, z] of profile) {
    if (Math.abs(r) < 1e-9) {
      // On the axis: a single pole vertex, not a degenerate ring.
      rings.push([addVertex(b, 0, 0, z)]);
      continue;
    }
    const ring: number[] = [];
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      ring.push(addVertex(b, r * Math.cos(a), r * Math.sin(a), z));
    }
    rings.push(ring);
  }

  for (let i = 0; i < rings.length - 1; i++) {
    const lo = rings[i]!;
    const hi = rings[i + 1]!;

    if (lo.length === 1 && hi.length === 1) continue;

    if (lo.length === 1) {
      // Fan from the bottom pole up to the first real ring.
      for (let s = 0; s < segments; s++) {
        addTri(b, lo[0]!, hi[(s + 1) % segments]!, hi[s]!);
      }
    } else if (hi.length === 1) {
      // Fan from the last real ring up to the top pole.
      for (let s = 0; s < segments; s++) {
        addTri(b, hi[0]!, lo[s]!, lo[(s + 1) % segments]!);
      }
    } else {
      for (let s = 0; s < segments; s++) {
        const n = (s + 1) % segments;
        addQuad(b, lo[s]!, lo[n]!, hi[n]!, hi[s]!);
      }
    }
  }

  return finish(b);
}

/** A closed cylinder, radius r, height h, sitting on z = 0. */
export function cylinder(r = 20, h = 40, segments = 64): MeshData {
  return revolve(
    [
      [0, 0],
      [r, 0],
      [r, h],
      [0, h],
    ],
    segments,
  );
}

/** A sphere centred on the origin. Its parting plane must land at the equator. */
export function sphere(r = 20, segments = 48): MeshData {
  const profile: Array<[number, number]> = [];
  const steps = Math.max(8, Math.floor(segments / 2));
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI;
    profile.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return revolve(profile, segments);
}

/**
 * A drinking cup: a solid, drain-castable vessel form with a slight outward
 * taper, a foot, and a rounded rim. The archetypal slip-cast part and the
 * fixture most of the happy-path tests run against.
 */
export function cup(opts: { radius?: number; height?: number; segments?: number } = {}): MeshData {
  const r = opts.radius ?? 35;
  const h = opts.height ?? 90;
  const seg = opts.segments ?? 64;
  const foot = r * 0.72;

  // Slight taper outward toward the rim: draft, so it releases from plaster.
  return revolve(
    [
      [0, 0],
      [foot, 0],
      [foot + 1.5, 3],
      [r * 0.92, h * 0.35],
      [r, h * 0.8],
      [r * 1.02, h - 3],
      [r * 0.99, h],
      [0, h],
    ],
    seg,
  );
}

/**
 * A cube with a raised cylindrical boss.
 *
 * Its vertical walls have exactly zero draft and its top face is exactly
 * perpendicular to Z, so this is the fixture that pins draft classification:
 * the walls must come back 'shallow' (they release, but they drag), never 'ok'.
 */
export function cubeWithBoss(size = 40, bossR = 10, bossH = 10, segments = 32): MeshData {
  const b = newBuilder();
  const s = size / 2;

  // One shared parametrisation for every ring, so each pair of rings is a clean
  // quad strip and no edge is left unmatched.
  const bottomRing: number[] = [];
  const topRing: number[] = [];
  const holeRing: number[] = [];
  const bossRing: number[] = [];

  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Push the unit circle out onto the square's boundary: the walls stay planar.
    const k = 1 / Math.max(Math.abs(ca), Math.abs(sa));
    const x = s * ca * k;
    const y = s * sa * k;

    bottomRing.push(addVertex(b, x, y, 0));
    topRing.push(addVertex(b, x, y, size));
    holeRing.push(addVertex(b, bossR * ca, bossR * sa, size));
    bossRing.push(addVertex(b, bossR * ca, bossR * sa, size + bossH));
  }

  const bottomCenter = addVertex(b, 0, 0, 0);
  const bossCap = addVertex(b, 0, 0, size + bossH);

  for (let i = 0; i < segments; i++) {
    const n = (i + 1) % segments;
    addTri(b, bottomCenter, bottomRing[n]!, bottomRing[i]!);            // base
    addQuad(b, bottomRing[i]!, bottomRing[n]!, topRing[n]!, topRing[i]!); // walls
    addQuad(b, topRing[i]!, topRing[n]!, holeRing[n]!, holeRing[i]!);     // top annulus
    addQuad(b, holeRing[i]!, holeRing[n]!, bossRing[n]!, bossRing[i]!);   // boss wall
    addTri(b, bossCap, bossRing[i]!, bossRing[n]!);                       // boss cap
  }

  return finish(b);
}

/**
 * A torus lying in the XY plane.
 *
 * Moldable along Z: cut a donut at its equator and each half is a plain ring
 * bump with no undercuts -- which is why real donut molds are two-part. But cut
 * it along any in-plane direction and the hole becomes a through-undercut. It is
 * the fixture that proves pull direction matters.
 */
export function torus(R = 30, r = 10, major = 48, minor = 24): MeshData {
  const b = newBuilder();
  const grid: number[][] = [];
  for (let i = 0; i < major; i++) {
    const u = (i / major) * Math.PI * 2;
    const row: number[] = [];
    for (let j = 0; j < minor; j++) {
      const v = (j / minor) * Math.PI * 2;
      const x = (R + r * Math.cos(v)) * Math.cos(u);
      const y = (R + r * Math.cos(v)) * Math.sin(u);
      const z = r * Math.sin(v);
      row.push(addVertex(b, x, y, z));
    }
    grid.push(row);
  }
  for (let i = 0; i < major; i++) {
    const ni = (i + 1) % major;
    for (let j = 0; j < minor; j++) {
      const nj = (j + 1) % minor;
      addQuad(b, grid[i]![j]!, grid[ni]![j]!, grid[ni]![nj]!, grid[i]![nj]!);
    }
  }
  return finish(b);
}

/**
 * A mug: a cup with a closed-loop handle, the loop lying in the XZ plane.
 *
 * Pull it along Z (the mug's own axis, and the obvious first guess) and the
 * handle's inner surface is occluded both from above and from below -- a true
 * undercut. Pull it along Y instead, straight through the handle's hole, and
 * every surface is reachable.
 *
 * That Y answer is not a quirk of this fixture: it is how mug molds are actually
 * parted in a pottery, on the vertical plane that bisects the handle. If the
 * pull-direction search reproduces that, it has understood the problem.
 */
export async function handledMug(): Promise<MeshData> {
  const body = cup({ radius: 32, height: 80, segments: 48 });
  const handle = handleLoop();
  // A real union, not concatenated triangles. The handle's loop passes through
  // the mug wall, so simply appending the two meshes would leave both surfaces
  // buried inside the solid -- and buried surfaces are invisible from every
  // direction, which makes the part read as hopelessly undercut for reasons that
  // have nothing to do with the handle.
  return booleanUnion(body, handle);
}

/**
 * A sphere with a concentric spherical void sealed inside it.
 *
 * No pull direction can reach an enclosed void, so this part is impossible --
 * full stop, from every angle. It exists to prove the engine refuses rather than
 * quietly producing a mold that ignores the geometry it could not see.
 */
export async function hollowSphere(
  outer = 25,
  inner = 15,
  segments = 32,
): Promise<MeshData> {
  const wasm = await manifold();
  return withScope(async (s) => {
    const shell = s.keep(wasm.Manifold.ofMesh(await toManifoldMesh(sphere(outer, segments))));
    const void_ = s.keep(wasm.Manifold.ofMesh(await toManifoldMesh(sphere(inner, segments))));
    return fromManifold(s.keep(shell.subtract(void_)));
  });
}

/** Boolean union of two meshes, used where overlap would otherwise trap surfaces. */
export async function booleanUnion(a: MeshData, b: MeshData): Promise<MeshData> {
  const wasm = await manifold();
  return withScope(async (s) => {
    const solidA = s.keep(wasm.Manifold.ofMesh(await toManifoldMesh(a)));
    const solidB = s.keep(wasm.Manifold.ofMesh(await toManifoldMesh(b)));
    return fromManifold(s.keep(solidA.add(solidB)));
  });
}

/** A closed torus-arc handle standing off the side of the mug body. */
function handleLoop(): MeshData {
  const b = newBuilder();
  const majorR = 22;      // handle loop radius
  const minorR = 5;       // handle stock radius
  const centerX = 32;     // out at the mug wall
  const centerZ = 45;
  const major = 40;
  const minor = 16;

  const grid: number[][] = [];
  for (let i = 0; i < major; i++) {
    const u = (i / major) * Math.PI * 2;
    // Loop lies in the XZ plane, so it arcs out sideways from the mug.
    const cx = centerX + majorR * Math.cos(u);
    const cz = centerZ + majorR * Math.sin(u);
    // Tangent of the loop, used to orient the circular cross-section.
    const tx = -Math.sin(u);
    const tz = Math.cos(u);
    const row: number[] = [];
    for (let j = 0; j < minor; j++) {
      const v = (j / minor) * Math.PI * 2;
      // Cross-section basis: the loop's normal (in XZ) and the Y axis.
      const nx = tz;
      const nz = -tx;
      row.push(
        addVertex(
          b,
          cx + minorR * Math.cos(v) * nx,
          minorR * Math.sin(v),
          cz + minorR * Math.cos(v) * nz,
        ),
      );
    }
    grid.push(row);
  }
  for (let i = 0; i < major; i++) {
    const ni = (i + 1) % major;
    for (let j = 0; j < minor; j++) {
      const nj = (j + 1) % minor;
      // Reversed relative to torus(): this loop lives in the XZ plane, which is
      // the standard torus with Y and Z swapped. Swapping two axes is a
      // reflection, and a reflection flips orientation -- so the same vertex
      // order that faces outward there faces inward here. Get this wrong and
      // Manifold reads the handle as a void and *subtracts* it, quietly carving
      // a channel into the mug instead of adding a handle.
      addQuad(b, grid[i]![j]!, grid[i]![nj]!, grid[ni]![nj]!, grid[ni]![j]!);
    }
  }
  return finish(b);
}

/** Concatenate two meshes into one (disjoint triangle soup; no boolean). */
export function mergeMeshes(a: MeshData, b: MeshData): MeshData {
  const positions = new Float32Array(a.positions.length + b.positions.length);
  positions.set(a.positions, 0);
  positions.set(b.positions, a.positions.length);

  const offset = a.positions.length / 3;
  const indices = new Uint32Array(a.indices.length + b.indices.length);
  indices.set(a.indices, 0);
  for (let i = 0; i < b.indices.length; i++) {
    indices[a.indices.length + i] = b.indices[i]! + offset;
  }
  return { positions, indices };
}

/**
 * The single most common real-world defect: STL has no concept of a shared
 * vertex, so every triangle carries its own three copies. This explodes a mesh
 * into exactly that -- unwelded triangle soup. Welding is the whole fix, which
 * is why repair tier 1 handles the overwhelming majority of real files.
 */
export function explodeToSoup(data: MeshData): MeshData {
  const triCount = data.indices.length / 3;
  const positions = new Float32Array(triCount * 9);
  const indices = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    for (let c = 0; c < 3; c++) {
      const src = data.indices[t * 3 + c]! * 3;
      const dst = (t * 3 + c) * 3;
      positions[dst] = data.positions[src]!;
      positions[dst + 1] = data.positions[src + 1]!;
      positions[dst + 2] = data.positions[src + 2]!;
      indices[t * 3 + c] = t * 3 + c;
    }
  }
  return { positions, indices };
}

/** Reverse every triangle's winding: a mesh that is inside-out. */
export function flipWinding(data: MeshData): MeshData {
  const indices = new Uint32Array(data.indices);
  for (let t = 0; t < indices.length; t += 3) {
    const tmp = indices[t + 1]!;
    indices[t + 1] = indices[t + 2]!;
    indices[t + 2] = tmp;
  }
  return { positions: new Float32Array(data.positions), indices };
}

/** Delete `count` triangles, leaving holes. Tests the hole-filling tier. */
export function punchHoles(data: MeshData, count = 3): MeshData {
  const triCount = data.indices.length / 3;
  const drop = new Set<number>();
  // Deterministic, evenly spread, and never the same triangle twice.
  for (let i = 0; i < count; i++) {
    drop.add(Math.floor(((i + 1) * triCount) / (count + 1)));
  }
  const indices: number[] = [];
  for (let t = 0; t < triCount; t++) {
    if (drop.has(t)) continue;
    indices.push(data.indices[t * 3]!, data.indices[t * 3 + 1]!, data.indices[t * 3 + 2]!);
  }
  return {
    positions: new Float32Array(data.positions),
    indices: new Uint32Array(indices),
  };
}

/** Scale a mesh about the origin. Used to fabricate metre-scale unit-detection cases. */
export function scaleMesh(data: MeshData, factor: number): MeshData {
  const positions = new Float32Array(data.positions.length);
  for (let i = 0; i < data.positions.length; i++) {
    positions[i] = data.positions[i]! * factor;
  }
  return { positions, indices: new Uint32Array(data.indices) };
}

/** Rotate a mesh by `degrees` about `axis`. Used to prove pull-direction is frame-independent. */
export function rotateMesh(data: MeshData, axis: Vec3, degrees: number): MeshData {
  const [x, y, z] = axis;
  const len = Math.hypot(x, y, z) || 1;
  const ux = x / len, uy = y / len, uz = z / len;
  const th = (degrees * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const t = 1 - c;

  // Rodrigues' rotation, expanded to a matrix.
  const m = [
    t * ux * ux + c,      t * ux * uy - s * uz, t * ux * uz + s * uy,
    t * ux * uy + s * uz, t * uy * uy + c,      t * uy * uz - s * ux,
    t * ux * uz - s * uy, t * uy * uz + s * ux, t * uz * uz + c,
  ];

  const positions = new Float32Array(data.positions.length);
  for (let i = 0; i < data.positions.length; i += 3) {
    const px = data.positions[i]!, py = data.positions[i + 1]!, pz = data.positions[i + 2]!;
    positions[i] = m[0]! * px + m[1]! * py + m[2]! * pz;
    positions[i + 1] = m[3]! * px + m[4]! * py + m[5]! * pz;
    positions[i + 2] = m[6]! * px + m[7]! * py + m[8]! * pz;
  }
  return { positions, indices: new Uint32Array(data.indices) };
}
