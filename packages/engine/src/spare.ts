/**
 * The spare: the funnel and reservoir you pour slip into.
 *
 * It is not decoration. Slip shrinks as the plaster draws water out of it and the
 * level in the mold drops; the spare is the head of extra slip that keeps feeding
 * the cast so the rim does not come out starved.
 *
 * It runs along the POUR axis -- which way is up when the mold stands on the bench --
 * and NOT along the pull axis, which is merely the direction the mold comes apart.
 * For a plain cup those are the same and the distinction never surfaces. For a mug
 * they are perpendicular: the mold opens sideways through the handle but is filled
 * from the rim. Run the channel up the pull axis there and the pour hole ends up on
 * the SIDE of the mug, where slip would run straight back out onto the bench.
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Box, Manifold } from 'manifold-3d';
import { manifold } from './wasm.js';
import type { MeshData, Vec3 } from './types.js';
import { boundingBox } from './mesh.js';

export interface SpareOptions {
  /** Bore of the pour channel, mm. */
  diameter: number;
  /** How far the funnel stands proud of the block, mm. */
  height: number;
  /** Which way is up, in the mold frame. Always in the XZ plane. */
  pour: Vec3;
  /**
   * A point on the part, in the mold frame -- exactly what a click in the viewport
   * gives you. Only its component ACROSS the pour axis matters; the channel then
   * comes straight down the pour axis onto the part.
   *
   * Null puts it over the part's highest point along the pour axis: the rim.
   */
  position?: Vec3 | null;
}

/**
 * Build the spare.
 *
 * Returns a solid to be UNIONED with the master before the cavity is subtracted from
 * the block: the spare is a void in the finished plaster, not an object.
 */
export async function spareSolid(
  part: MeshData,
  block: Box,
  opts: SpareOptions,
): Promise<Manifold> {
  const wasm = await manifold();
  const { Manifold: M } = wasm;

  const up = new THREE.Vector3(...opts.pour).normalize();

  // Drop the picked point onto the plane through the origin perpendicular to the pour
  // axis: only its position ACROSS that axis matters, because the channel comes down
  // the axis onto the part from wherever it is.
  const anchor = opts.position
    ? (() => {
        const p = new THREE.Vector3(...opts.position!);
        return p.clone().addScaledVector(up, -p.dot(up));
      })()
    : summit(part, up);

  /**
   * The surface of the part directly "below" the chosen spot, measured down the pour
   * axis -- NOT the part's global extreme.
   *
   * Those coincide only at the summit. Anywhere else, starting the channel at the
   * global extreme leaves it hanging in mid-air above the point the user picked,
   * connected to nothing. The mold then has a pour hole that dead-ends and a cavity
   * sealed inside solid plaster, and it looks perfect until it has been printed,
   * poured, and left to cure.
   */
  const surface = surfaceAlong(part, anchor, up);
  if (surface === null) {
    throw new Error(
      'The pour spare has to sit over the part. Nothing lies beneath the point you picked, ' +
        'so the channel would never reach the cavity.',
    );
  }

  const r = opts.diameter / 2;

  // Start below the surface. Beginning exactly at it leaves the two solids touching
  // on a single tangent plane, which a boolean is entitled to call no overlap at all.
  const overlap = Math.max(1, r * 0.25);
  const start = surface.clone().addScaledVector(up, -overlap);

  // Run it clear out through the block, whichever face the pour axis points at.
  //
  // A ONE-PIECE mold is open at its mouth, so the spare may well start above the
  // plaster and have nothing to punch through. That is not an error -- the mouth IS
  // the pour opening -- so the channel simply becomes a short funnel above the rim
  // rather than a bore through solid plaster.
  const exit = exitDistance(block, start, up) ?? 0;
  const channelLength = Math.max(exit, 0) + overlap + opts.height * 0.35;
  const basinHeight = opts.height * 0.65;

  // Manifold builds cylinders along +Z; rotate them onto the pour axis.
  const toUp = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
  const rot = new THREE.Euler().setFromQuaternion(toUp);
  const degrees: Vec3 = [
    (rot.x * 180) / Math.PI,
    (rot.y * 180) / Math.PI,
    (rot.z * 180) / Math.PI,
  ];

  const channel = M.cylinder(channelLength, r, r * 1.08, 48, false)
    .rotate(degrees)
    .translate([start.x, start.y, start.z]);

  // A cone-shaped basin on top: somewhere to pour into without slopping slip down
  // the outside of the mold.
  const basinBase = start.clone().addScaledVector(up, channelLength);
  const basin = M.cylinder(basinHeight, r * 1.08, r * 2.1, 48, false)
    .rotate(degrees)
    .translate([basinBase.x, basinBase.y, basinBase.z]);

  const combined = channel.add(basin);
  channel.delete();
  basin.delete();
  return combined;
}

/** How far from `from` along `dir` you leave the block's bounding box. */
function exitDistance(box: Box, from: THREE.Vector3, dir: THREE.Vector3): number | null {
  const min = [box.min[0], box.min[1], box.min[2]];
  const max = [box.max[0], box.max[1], box.max[2]];
  const o = [from.x, from.y, from.z];
  const d = [dir.x, dir.y, dir.z];

  // Slab method, taking the nearest exit across the three axes.
  let exit = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]!) < 1e-9) continue;
    const t1 = (min[a]! - o[a]!) / d[a]!;
    const t2 = (max[a]! - o[a]!) / d[a]!;
    const tFar = Math.max(t1, t2);
    if (tFar < exit) exit = tFar;
  }

  return Number.isFinite(exit) ? exit : null;
}

/**
 * Where the part's surface is, coming down the pour axis onto `anchor`.
 *
 * Null when the ray misses the part entirely -- the spot is not over the model.
 */
function surfaceAlong(
  part: MeshData,
  anchor: THREE.Vector3,
  up: THREE.Vector3,
): THREE.Vector3 | null {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(part.positions), 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(part.indices), 1));
  const bvh = new MeshBVH(geom);

  const box = boundingBox(part);
  const diagonal = Math.hypot(
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  );

  // Start well clear of the part and come back down onto it.
  const origin = anchor.clone().addScaledVector(up, diagonal);
  const ray = new THREE.Ray(origin, up.clone().negate());

  const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
  return hit ? hit.point.clone() : null;
}

/**
 * The centre of the part's high ground, measured up the pour axis.
 *
 * Not the single topmost vertex -- that is one facet's corner, and on a curved summit
 * it wanders with the tessellation. Average the vertices in a thin band below the
 * top, which lands the channel on the middle of the high region and stays put when
 * the mesh is re-triangulated. On a cup or a mug, that is the rim.
 */
export function summit(part: MeshData, up: THREE.Vector3): THREE.Vector3 {
  const p = part.positions;

  let top = -Infinity;
  let low = Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const h = p[i]! * up.x + p[i + 1]! * up.y + p[i + 2]! * up.z;
    if (h > top) top = h;
    if (h < low) low = h;
  }

  const band = Math.max((top - low) * 0.02, 1e-6);

  const centre = new THREE.Vector3();
  let n = 0;

  for (let i = 0; i < p.length; i += 3) {
    const h = p[i]! * up.x + p[i + 1]! * up.y + p[i + 2]! * up.z;
    if (h < top - band) continue;
    centre.add(new THREE.Vector3(p[i]!, p[i + 1]!, p[i + 2]!));
    n++;
  }

  if (n === 0) return new THREE.Vector3();
  centre.divideScalar(n);

  // Flatten onto the plane across the pour axis: only the sideways position matters.
  return centre.addScaledVector(up, -centre.dot(up));
}

/** Kept for the tests: the surface height straight down -Z onto (x, y). */
export function surfaceHeightAt(part: MeshData, x: number, y: number): number | null {
  const hit = surfaceAlong(
    part,
    new THREE.Vector3(x, y, 0),
    new THREE.Vector3(0, 0, 1),
  );
  return hit ? hit.z : null;
}
