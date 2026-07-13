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
 * Classify every triangle against a pull axis.
 *
 * `direction` and its negation describe the same two-part mold, so the result is
 * symmetric under d -> -d.
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

/** Evenly distributed directions over a hemisphere (d and -d are equivalent). */
export function candidateDirections(count = 128): Vec3[] {
  const dirs: Vec3[] = [
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0],
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
  const dirs = candidateDirections(samples);

  const totalArea = Math.max(1e-9, surfaceAreaOf(data));
  const partVolume = Math.max(1e-9, Math.abs(approxVolume(data)));

  const scored: PullCandidate[] = dirs.map((direction) => {
    const analysis = classifyFaces(data, direction, minDraft, bvh);
    const blockVolume = blockVolumeFor(data, direction);

    const undercutFraction = analysis.area.undercut / totalArea;
    const shallowFraction = analysis.area.shallow / totalArea;
    const seam = 1 - oneSidedness(data, direction); // 0 = one-piece, 0.5 = split mid-part

    return {
      direction,
      undercutArea: analysis.area.undercut,
      blockVolume,
      score:
        undercutFraction * 1000 +
        seam * 10 +
        // Deliberately light. Draft quality is a finishing concern, and if it is
        // weighted heavily it starts *choosing the parting axis* -- tilting the
        // pull a few degrees off a part's natural axis purely to give its flat
        // top and bottom some draft. That trades a clean, clampable seam on the
        // symmetry plane for a diagonal one, which is a bad bargain at the bench.
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
 * The parting plane should sit at the part's silhouette: the height along the
 * pull axis where the cross-section is widest. Cut anywhere else and the mold
 * half above the cut has to travel past a wider part of the model to escape --
 * which is an undercut created purely by a bad parting plane.
 */
export function findPartingPlane(data: MeshData, direction: Vec3): number {
  const d = normalize(direction);
  const p = data.positions;

  let minD = Infinity;
  let maxD = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const h = p[i]! * d[0] + p[i + 1]! * d[1] + p[i + 2]! * d[2];
    if (h < minD) minD = h;
    if (h > maxD) maxD = h;
  }

  // Cross-sectional area is expensive to compute exactly at every height, and we
  // do not need it: the widest silhouette is where the part's perimeter is
  // furthest from the pull axis. Bucket the vertices by height and track the
  // greatest radial distance from the axis in each bucket.
  const buckets = 128;
  const span = maxD - minD || 1;
  const spread = new Float64Array(buckets);

  for (let i = 0; i < p.length; i += 3) {
    const pt: Vec3 = [p[i]!, p[i + 1]!, p[i + 2]!];
    const h = dot(pt, d);
    const along: Vec3 = [d[0] * h, d[1] * h, d[2] * h];
    const radial = Math.hypot(pt[0] - along[0], pt[1] - along[1], pt[2] - along[2]);

    const b = Math.min(buckets - 1, Math.floor(((h - minD) / span) * buckets));
    if (radial > spread[b]!) spread[b] = radial;
  }

  let best = 0;
  let bestRadial = -Infinity;
  for (let b = 0; b < buckets; b++) {
    if (spread[b]! > bestRadial) {
      bestRadial = spread[b]!;
      best = b;
    }
  }

  return minD + ((best + 0.5) / buckets) * span;
}

/** Rotation that carries `direction` onto +Z, so the rest of the engine can assume it. */
export function alignToZ(direction: Vec3): THREE.Matrix4 {
  const from = new THREE.Vector3(...normalize(direction));
  const to = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(from, to);
  return new THREE.Matrix4().makeRotationFromQuaternion(q);
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
