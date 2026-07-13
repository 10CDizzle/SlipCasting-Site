/**
 * Moldability analysis: can a two-part mold actually come off this part, and
 * along which axis?
 *
 * The criterion is *global accessibility*, not the sign of a face's normal. A
 * mold half pulled along +d can be removed if and only if every surface it
 * touches is visible from +d -- nothing of the part may lie in the way. So a
 * face is an undercut when it is occluded from +d AND from -d: no half of a
 * two-part mold could ever release it, and no amount of moving the parting plane
 * changes that.
 *
 * This distinction matters, and it is not academic. A donut has no undercuts
 * when parted at its equator. A mug's handle is a hopeless undercut along the
 * mug's own axis, yet parts cleanly perpendicular to the handle's loop -- which
 * is precisely where a pottery puts the seam. Judging by normals alone gets both
 * of those backwards.
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import {
  boundingBox,
  boxSize,
  signedVolume as approxVolume,
  surfaceArea as surfaceAreaOf,
  triangleArea,
  triangleCentroid,
  triangleCount,
  triangleNormal,
} from './mesh.js';
import type { DraftAnalysis, FaceClass, MeshData, PullCandidate, Vec3 } from './types.js';

const CLASS_CODE: Record<FaceClass, number> = { ok: 0, shallow: 1, undercut: 2 };
export const FACE_CLASS_BY_CODE: FaceClass[] = ['ok', 'shallow', 'undercut'];

function buildBVH(data: MeshData): MeshBVH {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.positions), 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(data.indices), 1));
  return new MeshBVH(geom);
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * What each face can see, and where it sits along the pull axis.
 *
 * Computed once per direction, then re-used for every candidate parting plane --
 * which is what makes searching the plane affordable at all.
 */
export interface Reachability {
  /** 1 where the face is reachable from +d. */
  up: Uint8Array;
  /** 1 where the face is reachable from -d. */
  down: Uint8Array;
  /** Signed height of the face's centroid along d. */
  height: Float64Array;
  area: Float64Array;
  /** |n . d| -- the sine of the face's draft angle. */
  draftSin: Float64Array;
  totalArea: number;
  minHeight: number;
  maxHeight: number;
}

/**
 * Classify every triangle against a pull axis.
 *
 * `direction` and its negation describe the same two-part mold, so the result is
 * symmetric under d -> -d.
 *
 * NOTE: this reports whether each face can be reached from EITHER pole. That is a
 * necessary condition for moldability but not a sufficient one -- see moldabilityAt,
 * which is the test that actually decides whether a mold opens.
 */
export function classifyFaces(
  data: MeshData,
  direction: Vec3,
  minDraft: number,
  bvh?: MeshBVH,
): DraftAnalysis {
  const d = normalize(direction);
  const tree = bvh ?? buildBVH(data);
  const count = triangleCount(data);
  const faceClass = new Uint8Array(count);
  const area: Record<FaceClass, number> = { ok: 0, shallow: 0, undercut: 0 };

  const size = boxSize(boundingBox(data));
  const diagonal = Math.hypot(size[0], size[1], size[2]) || 1;
  // Lift the ray origin clear of the face it starts on, or it hits itself.
  const epsilon = diagonal * 1e-4;
  // Ignore any obstruction closer than this. Boolean seams throw off near-tangent
  // sliver triangles whose rays graze immediately-adjacent geometry, and those
  // grazes read as undercuts that aren't there. The cutoff is physical, not just
  // numerical: plaster cannot form a wall this thin, so a gap smaller than this
  // is not a mold feature under any circumstances.
  const grazeDistance = diagonal * 1e-3;
  const minDraftSin = Math.sin((minDraft * Math.PI) / 180);

  const origin = new THREE.Vector3();
  const ray = new THREE.Ray();
  const up = new THREE.Vector3(d[0], d[1], d[2]);
  const down = new THREE.Vector3(-d[0], -d[1], -d[2]);

  // "Entering" is defined by triangle winding, so an inside-out mesh inverts the
  // whole test. repair() guarantees outward winding; this keeps a caller that
  // skipped it from getting a confidently wrong answer.
  const enteringSide = approxVolume(data) < 0 ? THREE.BackSide : THREE.FrontSide;

  /**
   * Is the path from this face along `dir` blocked by the part itself?
   *
   * Only *entering* hits count -- FrontSide, meaning the ray strikes a face whose
   * normal opposes it. That qualifier is doing real work, not decoration.
   *
   * A triangle's centroid on a curved surface sits slightly inside the true
   * surface, an artifact of faceting. So a ray fired nearly tangent to the
   * surface -- which is every face along the silhouette, where the normal is
   * perpendicular to the pull axis -- starts a hair inside the solid and
   * immediately strikes the solid's own *exit* face. Counting that as an
   * obstruction condemns the entire silhouette band of every part as undercut.
   *
   * Leaving through your own back face means you started inside. Entering another
   * piece of solid is what actually blocks a mold from coming off.
   */
  const occluded = (centroid: Vec3, normal: Vec3, dir: THREE.Vector3): boolean => {
    origin.set(
      centroid[0] + normal[0] * epsilon,
      centroid[1] + normal[1] * epsilon,
      centroid[2] + normal[2] * epsilon,
    );
    ray.set(origin, dir);
    return tree.raycastFirst(ray, enteringSide, grazeDistance, Infinity) !== null;
  };

  for (let t = 0; t < count; t++) {
    const n = triangleNormal(data, t);
    const c = triangleCentroid(data, t);
    const a = triangleArea(
      data.positions,
      data.indices[t * 3]!,
      data.indices[t * 3 + 1]!,
      data.indices[t * 3 + 2]!,
    );

    const s = dot(n, d);

    // Check the half this face naturally belongs to first: a face whose normal
    // points along +d is served by the +d half. Only if that half cannot reach
    // it do we ask whether the other half can.
    const preferUp = s >= 0;
    const first = preferUp ? up : down;
    const second = preferUp ? down : up;

    let reachable = !occluded(c, n, first);
    let pullSign = preferUp ? 1 : -1;

    if (!reachable) {
      reachable = !occluded(c, n, second);
      pullSign = preferUp ? -1 : 1;
    }

    let cls: FaceClass;
    if (!reachable) {
      cls = 'undercut';
    } else {
      // Draft is the angle between the face and the pull axis's perpendicular
      // plane: sin(draft) = |n . pull|. A wall parallel to the pull axis has
      // zero draft -- it releases, but it drags the whole way out.
      const draftSin = Math.abs(dot(n, d)) * (pullSign === 0 ? 1 : 1);
      cls = draftSin < minDraftSin ? 'shallow' : 'ok';
    }

    faceClass[t] = CLASS_CODE[cls];
    area[cls] += a;
  }

  return { faceClass, area, moldable: area.undercut === 0 };
}

/** Reachability of every face from both poles of the pull axis. */
export function reachability(data: MeshData, direction: Vec3, bvh?: MeshBVH): Reachability {
  const d = normalize(direction);
  const tree = bvh ?? buildBVH(data);
  const count = triangleCount(data);

  const up = new Uint8Array(count);
  const down = new Uint8Array(count);
  const height = new Float64Array(count);
  const area = new Float64Array(count);
  const draftSin = new Float64Array(count);

  const size = boxSize(boundingBox(data));
  const diagonal = Math.hypot(size[0], size[1], size[2]) || 1;
  const epsilon = diagonal * 1e-4;
  const grazeDistance = diagonal * 1e-3;

  const origin = new THREE.Vector3();
  const ray = new THREE.Ray();
  const upDir = new THREE.Vector3(d[0], d[1], d[2]);
  const downDir = new THREE.Vector3(-d[0], -d[1], -d[2]);

  const enteringSide = approxVolume(data) < 0 ? THREE.BackSide : THREE.FrontSide;

  const blocked = (c: Vec3, n: Vec3, dir: THREE.Vector3): boolean => {
    origin.set(c[0] + n[0] * epsilon, c[1] + n[1] * epsilon, c[2] + n[2] * epsilon);
    ray.set(origin, dir);
    return tree.raycastFirst(ray, enteringSide, grazeDistance, Infinity) !== null;
  };

  let totalArea = 0;
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  // A face whose normal points AGAINST the pull cannot be released that way, full
  // stop -- mold material resting on it would have to travel through the part. That
  // is the LOCAL condition, and it is independent of what else is in the way.
  //
  // Leaving it out and relying on rays alone was a real bug: the ray from a cup's flat
  // top, fired downward, re-enters the solid immediately -- and "immediately" is inside
  // the graze tolerance that exists to swallow boolean slivers. So the tolerance ate
  // the evidence, and a cup's lid read as reachable from underneath, which is nonsense.
  // Local first, then the ray for what is globally in the way.
  const facingTolerance = Math.sin((0.5 * Math.PI) / 180);

  for (let t = 0; t < count; t++) {
    const n = triangleNormal(data, t);
    const c = triangleCentroid(data, t);

    const a = triangleArea(
      data.positions,
      data.indices[t * 3]!,
      data.indices[t * 3 + 1]!,
      data.indices[t * 3 + 2]!,
    );

    const h = dot(c, d);
    const s = dot(n, d);

    const facesUp = s >= -facingTolerance;
    const facesDown = s <= facingTolerance;

    up[t] = facesUp && !blocked(c, n, upDir) ? 1 : 0;
    down[t] = facesDown && !blocked(c, n, downDir) ? 1 : 0;

    height[t] = h;
    area[t] = a;
    draftSin[t] = Math.abs(s);

    totalArea += a;
    if (h < minHeight) minHeight = h;
    if (h > maxHeight) maxHeight = h;
  }

  return { up, down, height, area, draftSin, totalArea, minHeight, maxHeight };
}

/**
 * Is this mold openable, with the parting plane HERE?
 *
 * The upper half of the mold occupies everything above the plane, and it comes off
 * by travelling along +d. It touches exactly those faces of the part that lie above
 * the plane -- so every one of them has to be reachable from +d, or the half is
 * gripping a surface it can never let go of. Symmetrically below.
 *
 * This is the criterion my first attempt got wrong. I checked only that each face
 * could see +d OR -d, which is necessary but not sufficient: it happily passes a
 * mold whose halves each clamp around geometry they cannot release. On a mug it let
 * the seam settle 26 degrees off the plane of symmetry, which puts the entire handle
 * inside one half with its hole trapped -- a mold that cannot open, reported green.
 */
export function moldabilityFrom(
  reach: Reachability,
  partingHeight: number,
  minDraft: number,
  split = true,
): DraftAnalysis {
  const minDraftSin = Math.sin((minDraft * Math.PI) / 180);
  const count = reach.height.length;

  const faceClass = new Uint8Array(count);
  const area: Record<FaceClass, number> = { ok: 0, shallow: 0, undercut: 0 };

  for (let t = 0; t < count; t++) {
    const above = reach.height[t]! > partingHeight;

    // A ONE-PIECE mold has no upper half. Everything above the parting plane is not
    // molded at all -- it is the mold's open mouth, which is where you pour. Those
    // faces constrain nothing.
    //
    // Getting this wrong meant building a lid over the part and calling it a mold. A
    // sphere sealed inside a closed block cannot come out of it, and the engine was
    // cheerfully reporting that it could.
    if (!split && above) {
      faceClass[t] = CLASS_CODE.ok;
      area.ok += reach.area[t]!;
      continue;
    }

    const reachable = above ? reach.up[t] === 1 : reach.down[t] === 1;

    let cls: FaceClass;
    if (!reachable) {
      cls = 'undercut';
    } else {
      cls = reach.draftSin[t]! < minDraftSin ? 'shallow' : 'ok';
    }

    faceClass[t] = CLASS_CODE[cls];
    area[cls] += reach.area[t]!;
  }

  return { faceClass, area, moldable: area.undercut === 0 };
}

/** Convenience: reachability plus moldability at a given plane, in one call. */
export function moldabilityAt(
  data: MeshData,
  direction: Vec3,
  partingHeight: number,
  minDraft: number,
  split = true,
  bvh?: MeshBVH,
): DraftAnalysis {
  return moldabilityFrom(reachability(data, direction, bvh), partingHeight, minDraft, split);
}

export interface PlaneChoice {
  height: number;
  undercutArea: number;
  shallowArea: number;
}

/**
 * Sweep the parting plane and take the height that traps the least surface.
 *
 * There is usually a wide band of heights that trap nothing at all -- for a mug,
 * anywhere through the symmetry plane works -- so among the ties we prefer the plane
 * at the part's widest silhouette, which is where a mold-maker would put it.
 */
export function bestPartingPlane(
  reach: Reachability,
  minDraft: number,
  split = true,
  steps = 96,
): PlaneChoice {
  const minDraftSin = Math.sin((minDraft * Math.PI) / 180);
  const span = reach.maxHeight - reach.minHeight;

  if (span <= 0) {
    return { height: reach.minHeight, undercutArea: 0, shallowArea: 0 };
  }

  let best: PlaneChoice = { height: reach.minHeight, undercutArea: Infinity, shallowArea: Infinity };

  for (let i = 0; i <= steps; i++) {
    const h = reach.minHeight + (span * i) / steps;

    let undercut = 0;
    let shallow = 0;

    for (let t = 0; t < reach.height.length; t++) {
      const above = reach.height[t]! > h;

      // A one-piece mold has no upper half, so what lies above the plane is simply
      // the open mouth and constrains nothing.
      if (!split && above) continue;

      const reachable = above ? reach.up[t] === 1 : reach.down[t] === 1;

      if (!reachable) undercut += reach.area[t]!;
      else if (reach.draftSin[t]! < minDraftSin) shallow += reach.area[t]!;
    }

    // Undercut decides. Then, for a one-piece mold, HIGHER is better: the mouth wants
    // to be as high as the geometry allows, so the plaster wraps as much of the part
    // as it can still let go of. `>=` on the tie means a later, higher plane wins.
    const better =
      undercut < best.undercutArea - 1e-9 ||
      (Math.abs(undercut - best.undercutArea) <= 1e-9 &&
        (!split || shallow < best.shallowArea - 1e-9));

    if (better) {
      best = { height: h, undercutArea: undercut, shallowArea: shallow };
    }
  }

  return best;
}

/**
 * The part's own principal axes, from the area-weighted covariance of its surface.
 *
 * These matter enormously as search seeds. A fixed sample grid will never contain the
 * exact axis of a part that arrives rotated -- and "nearly the axis" is not good
 * enough, because a pull a few degrees off a surface of revolution turns its walls
 * into undercuts. Nobody exports their model conveniently aligned, so the search has
 * to be able to find an axis the sampler cannot see.
 */
export function principalAxes(data: MeshData): Vec3[] {
  const p = data.positions;
  const n = p.length / 3;
  if (n === 0) return [];

  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < p.length; i += 3) {
    cx += p[i]!;
    cy += p[i + 1]!;
    cz += p[i + 2]!;
  }
  cx /= n;
  cy /= n;
  cz /= n;

  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i]! - cx;
    const dy = p[i + 1]! - cy;
    const dz = p[i + 2]! - cz;
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  }

  return jacobiEigenvectors([
    [xx / n, xy / n, xz / n],
    [xy / n, yy / n, yz / n],
    [xz / n, yz / n, zz / n],
  ]);
}

/** Eigenvectors of a symmetric 3x3, by cyclic Jacobi rotations. */
function jacobiEigenvectors(a: number[][]): Vec3[] {
  const m = a.map((row) => [...row]);
  let v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) off += m[i]![j]! * m[i]![j]!;
    }
    if (off < 1e-18) break;

    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(m[p]![q]!) < 1e-15) continue;

        const theta = (m[q]![q]! - m[p]![p]!) / (2 * m[p]![q]!);
        const t =
          Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        const rotate = (mat: number[][]) => {
          for (let k = 0; k < 3; k++) {
            const kp = mat[k]![p]!;
            const kq = mat[k]![q]!;
            mat[k]![p] = c * kp - s * kq;
            mat[k]![q] = s * kp + c * kq;
          }
        };

        rotate(m);
        // Symmetric: apply from the other side too.
        for (let k = 0; k < 3; k++) {
          const pk = m[p]![k]!;
          const qk = m[q]![k]!;
          m[p]![k] = c * pk - s * qk;
          m[q]![k] = s * pk + c * qk;
        }
        rotate(v);
      }
    }
  }

  v = v;
  return [
    normalize([v[0]![0]!, v[1]![0]!, v[2]![0]!]),
    normalize([v[0]![1]!, v[1]![1]!, v[2]![1]!]),
    normalize([v[0]![2]!, v[1]![2]!, v[2]![2]!]),
  ];
}

/** Evenly distributed directions over a hemisphere (d and -d are equivalent). */
export function candidateDirections(count = 128, seeds: Vec3[] = []): Vec3[] {
  const dirs: Vec3[] = [
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0],
    ...seeds,
  ];

  // Fibonacci hemisphere: near-uniform coverage without clustering at the poles.
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const z = 1 - (i + 0.5) / count; // hemisphere: z in (0, 1]
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const theta = golden * i;
    dirs.push([Math.cos(theta) * r, Math.sin(theta) * r, z]);
  }
  return dirs.map(normalize);
}

/**
 * The bounding volume of the mold block for a given pull axis. Used only as a
 * tie-breaker: among directions that are all moldable, prefer the one that needs
 * the least plaster.
 */
function blockVolumeFor(data: MeshData, direction: Vec3): number {
  const d = normalize(direction);
  // Build an orthonormal frame with d as the third axis.
  const helper: Vec3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(helper, d));
  const v = cross(d, u);

  let minU = Infinity, maxU = -Infinity;
  let minV = Infinity, maxV = -Infinity;
  let minD = Infinity, maxD = -Infinity;

  const p = data.positions;
  for (let i = 0; i < p.length; i += 3) {
    const pt: Vec3 = [p[i]!, p[i + 1]!, p[i + 2]!];
    const a = dot(pt, u), b = dot(pt, v), c = dot(pt, d);
    if (a < minU) minU = a;
    if (a > maxU) maxU = a;
    if (b < minV) minV = b;
    if (b > maxV) maxV = b;
    if (c < minD) minD = c;
    if (c > maxD) maxD = c;
  }
  return (maxU - minU) * (maxV - minV) * (maxD - minD);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export interface PullSearchOptions {
  minDraft?: number;
  /** How many hemisphere directions to try. */
  samples?: number;
  /** How many ranked candidates to return. */
  keep?: number;
}

/**
 * How far the parting plane sits from the middle of the part, along `d`.
 *
 * 1.0 means the plane lands at the very top or bottom of the part -- everything
 * is on one side of it, so the mold is effectively a single open piece. 0.5 means
 * it cuts through the middle, needing two halves.
 */
function oneSidedness(data: MeshData, direction: Vec3): number {
  const d = normalize(direction);
  const p = data.positions;

  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const h = p[i]! * d[0] + p[i + 1]! * d[1] + p[i + 2]! * d[2];
    if (h < low) low = h;
    if (h > high) high = h;
  }
  const span = high - low;
  if (span <= 0) return 1;

  const plane = findPartingPlane(data, d);
  const t = (plane - low) / span;
  return Math.max(t, 1 - t);
}

/**
 * Search for a pull axis that leaves no undercuts.
 *
 * The ranking, in strict order of what actually matters at the bench:
 *
 *  1. Undercuts. A direction with any undercut is disqualified outright -- the
 *     mold physically will not come off, and no other virtue compensates.
 *  2. Where the seam lands. Prefer a parting plane at an extreme of the part,
 *     because that yields a single open mold rather than two halves to clamp,
 *     align, and clean a seam off. This is the term that makes a cup part at its
 *     rim -- exactly where a potter would put it.
 *  3. Shallow draft, which drags against the plaster on the way out.
 *  4. Block volume, i.e. how much plaster the mold burns.
 *
 * Scoring on *fractions* rather than raw areas keeps the weights meaningful
 * regardless of whether the part is a thimble or a garden pot.
 *
 * Without term 2, this search prefers to part a cup *sideways*: a sideways pull
 * gives most of a surface of revolution generous draft and leaves only a narrow
 * shallow band, so it wins on draft alone. It is a real answer to the wrong
 * question -- nobody molds a cup that way.
 */
export function findPullDirections(
  data: MeshData,
  opts: PullSearchOptions = {},
): PullCandidate[] {
  const minDraft = opts.minDraft ?? 2;
  const samples = opts.samples ?? 128;
  const keep = opts.keep ?? 3;

  const bvh = buildBVH(data);
  // Seed with the part's own principal axes: a fixed grid never contains the exact
  // axis of a part that arrived rotated, and "nearly the axis" is not good enough.
  const dirs = candidateDirections(samples, principalAxes(data));

  const totalArea = Math.max(1e-9, surfaceAreaOf(data));
  const partVolume = Math.max(1e-9, Math.abs(approxVolume(data)));

  const scored: PullCandidate[] = dirs.map((direction) => {
    const reach = reachability(data, direction, bvh);

    // Score the direction on its BEST possible parting plane. A direction is only
    // as good as the best seam you can cut with it, and judging it without choosing
    // a plane is what let an unopenable mold pass as clean.
    const plane = bestPartingPlane(reach, minDraft);
    const blockVolume = blockVolumeFor(data, direction);

    const undercutFraction = plane.undercutArea / totalArea;
    const shallowFraction = plane.shallowArea / totalArea;

    const span = reach.maxHeight - reach.minHeight || 1;
    const t = (plane.height - reach.minHeight) / span;
    const seam = 1 - Math.max(t, 1 - t); // 0 = one-piece, 0.5 = split through the middle

    return {
      direction,
      undercutArea: plane.undercutArea,
      blockVolume,
      score:
        // An undercut is disqualifying. There is no such thing as a mold that
        // mostly comes off, so nothing else can buy its way past this term.
        undercutFraction * 1000 +
        seam * 10 +
        // Deliberately light. Draft quality is a finishing concern, and weighted
        // heavily it starts *choosing the parting axis* -- tilting the pull a few
        // degrees off a part's natural axis purely to give its flat top and bottom
        // some draft. That trades a clean, clampable seam on the plane of symmetry
        // for a diagonal one, which is a bad bargain at the bench.
        shallowFraction * 0.3 +
        (blockVolume / partVolume) * 0.01,
    };
  });

  scored.sort((a, b) => a.score - b.score);

  // Suppress near-duplicate axes so the three suggestions are genuinely distinct.
  const distinct: PullCandidate[] = [];
  for (const candidate of scored) {
    const tooClose = distinct.some(
      (chosen) => Math.abs(dot(chosen.direction, candidate.direction)) > 0.95,
    );
    if (!tooClose) distinct.push(candidate);
    if (distinct.length >= keep) break;
  }
  return distinct;
}

/**
 * Where to cut, given a pull axis.
 *
 * Chosen by minimising the surface the mold would trap. Among the (usually many)
 * heights that trap nothing, the widest silhouette wins -- that is where a
 * mold-maker would put the seam, and cutting anywhere else forces a mold half to
 * travel past a wider part of the model to escape.
 */
export function findPartingPlane(
  data: MeshData,
  direction: Vec3,
  opts: { minDraft?: number; split?: boolean; bvh?: MeshBVH } = {},
): number {
  const minDraft = opts.minDraft ?? 2;
  const split = opts.split ?? true;

  const reach = reachability(data, direction, opts.bvh);
  const chosen = bestPartingPlane(reach, minDraft, split);

  // A one-piece mold's plane is its mouth: take the highest clean one and stop.
  if (!split) return chosen.height;

  // If several heights are equally clean, prefer the widest silhouette among them.
  const span = reach.maxHeight - reach.minHeight;
  if (span <= 0) return chosen.height;

  const d = normalize(direction);
  const p = data.positions;
  const buckets = 96;
  const spread = new Float64Array(buckets);

  for (let i = 0; i < p.length; i += 3) {
    const pt: Vec3 = [p[i]!, p[i + 1]!, p[i + 2]!];
    const h = dot(pt, d);
    const along: Vec3 = [d[0] * h, d[1] * h, d[2] * h];
    const radial = Math.hypot(pt[0] - along[0], pt[1] - along[1], pt[2] - along[2]);

    const b = Math.min(buckets - 1, Math.floor(((h - reach.minHeight) / span) * buckets));
    if (radial > spread[b]!) spread[b] = radial;
  }

  const minDraftSin = Math.sin((minDraft * Math.PI) / 180);
  void minDraftSin;

  let best = chosen.height;
  let bestRadial = -Infinity;

  for (let b = 0; b < buckets; b++) {
    const h = reach.minHeight + ((b + 0.5) / buckets) * span;

    let undercut = 0;
    for (let t = 0; t < reach.height.length; t++) {
      const above = reach.height[t]! > h;
      const reachable = above ? reach.up[t] === 1 : reach.down[t] === 1;
      if (!reachable) undercut += reach.area[t]!;
    }

    // Only consider heights that are as clean as the best we found.
    if (undercut > chosen.undercutArea + 1e-6) continue;

    // >= so that when the silhouette is constant -- a plain cylinder, say -- the seam
    // settles at the top rim rather than at the very bottom of the part.
    if (spread[b]! >= bestRadial) {
      bestRadial = spread[b]!;
      best = h;
    }
  }

  return best;
}

/** Rotation that carries `direction` onto +Z, so the rest of the engine can assume it. */
export function alignToZ(direction: Vec3): THREE.Matrix4 {
  const from = new THREE.Vector3(...normalize(direction));
  const to = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(from, to);
  return new THREE.Matrix4().makeRotationFromQuaternion(q);
}

/**
 * The mold frame: pull axis onto +Z, pour axis into the +XZ half-plane.
 *
 * Two axes matter, and they are not the same. The mold OPENS along the pull axis --
 * that is +Z here, so the parting plane is horizontal and everything downstream can
 * talk about "above" and "below". The mold is FILLED along the pour axis, which is
 * whichever way is up when it stands on the bench.
 *
 * For a cup those coincide. For a mug they are perpendicular: it opens sideways
 * through the handle and fills from the rim. Pinning the pour axis into the XZ plane
 * means the pour channel always runs along a face of the block rather than stabbing
 * out through a corner of it.
 */
export function moldFrame(pull: Vec3, pour: Vec3): THREE.Matrix4 {
  const z = new THREE.Vector3(...normalize(pull));
  const p = new THREE.Vector3(...normalize(pour));

  // The part of the pour axis that is perpendicular to the pull axis becomes +X.
  const x = p.clone().sub(z.clone().multiplyScalar(p.dot(z)));

  if (x.lengthSq() < 1e-10) {
    // Pour is parallel to pull (a plain cup). Any perpendicular will do for X.
    const helper = Math.abs(z.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    x.copy(helper.cross(z));
  }
  x.normalize();

  const y = new THREE.Vector3().crossVectors(z, x).normalize();

  // Rows of the rotation are the new basis vectors, so a world vector projects onto
  // (x, y, z) -- which is exactly "express this in the mold's frame".
  return new THREE.Matrix4().set(
    x.x, x.y, x.z, 0,
    y.x, y.y, y.z, 0,
    z.x, z.y, z.z, 0,
    0, 0, 0, 1,
  );
}

/** Apply a rotation to a direction. */
export function rotateVec(v: Vec3, m: THREE.Matrix4): Vec3 {
  const out = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(
    new THREE.Matrix4().extractRotation(m),
  );
  return [out.x, out.y, out.z];
}

/** Apply a 4x4 to a mesh, returning a new mesh. */
export function transformMesh(data: MeshData, m: THREE.Matrix4): MeshData {
  const v = new THREE.Vector3();
  const positions = new Float32Array(data.positions.length);
  for (let i = 0; i < data.positions.length; i += 3) {
    v.set(data.positions[i]!, data.positions[i + 1]!, data.positions[i + 2]!);
    v.applyMatrix4(m);
    positions[i] = v.x;
    positions[i + 1] = v.y;
    positions[i + 2] = v.z;
  }
  return { positions, indices: new Uint32Array(data.indices) };
}
