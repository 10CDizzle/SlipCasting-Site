/**
 * The spare: the funnel and reservoir you pour slip into.
 *
 * It is not decoration. Slip shrinks as the plaster draws water out of it, and the
 * level in the mold drops; the spare is the head of extra slip that keeps feeding
 * the cast so the rim does not come out starved. It also has to actually *reach*
 * the cavity and actually *breach* the outside of the block -- a spare that
 * connects to neither is the quietest, most expensive failure this engine could
 * ship, so both are asserted in the tests.
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Manifold } from 'manifold-3d';
import { manifold } from './wasm.js';
import type { MeshData } from './types.js';
import { boundingBox } from './mesh.js';

export interface SpareOptions {
  /** Bore of the pour channel, mm. */
  diameter: number;
  /** How far the funnel stands proud of the block's top face, mm. */
  height: number;
  /**
   * Where the channel meets the part, in the pull frame. Null puts it over the
   * part's summit.
   */
  position?: [number, number] | null;
}

/**
 * Build the spare for an already-aligned part (pull axis = +Z).
 *
 * Returns a solid to be UNIONED with the master before the cavity is subtracted
 * from the block: the spare is a void in the finished plaster, not an object.
 */
export async function spareSolid(
  part: MeshData,
  blockTopZ: number,
  opts: SpareOptions,
): Promise<Manifold> {
  const wasm = await manifold();
  const { Manifold: M } = wasm;

  const box = boundingBox(part);
  const height = box.max[2] - box.min[2];

  const [cx, cy] = opts.position ?? summit(part, box.max[2], height);

  /**
   * The height of the part's surface directly beneath the chosen spot -- NOT the
   * part's global maximum.
   *
   * Those coincide only when the spare sits on the summit. Anywhere else, starting
   * the channel at the global maximum leaves it hanging in mid-air above the point
   * the user actually picked, connected to nothing. The mold then has a pour hole
   * that dead-ends and a cavity sealed inside solid plaster -- and it looks perfect
   * until it has been printed, poured, and left to cure.
   */
  const surfaceZ = surfaceHeightAt(part, cx, cy);
  if (surfaceZ === null) {
    throw new Error(
      'The pour spare has to sit over the part. Nothing lies beneath the point you picked, ' +
        'so the channel would never reach the cavity.',
    );
  }

  const r = opts.diameter / 2;

  // Start the channel *below* the surface. Beginning exactly at it leaves the two
  // solids touching on a single tangent plane, which a boolean is entitled to call
  // no overlap at all.
  const overlap = Math.max(1, r * 0.25);
  const baseZ = surfaceZ - overlap;

  // Run it clear through the top face and out into the funnel above.
  const channelTop = blockTopZ + opts.height * 0.35;
  const channelHeight = channelTop - baseZ;

  if (channelHeight <= 0) {
    throw new Error('The pour spare would not reach the outside of the mold.');
  }

  const channel = M.cylinder(channelHeight, r, r * 1.08, 48, false).translate([cx, cy, baseZ]);

  // A cone-shaped basin on top: somewhere to pour into without slopping slip down
  // the outside of the mold.
  const basinHeight = opts.height * 0.65;
  const basin = M.cylinder(basinHeight, r * 1.08, r * 2.1, 48, false).translate([
    cx,
    cy,
    channelTop,
  ]);

  const combined = channel.add(basin);
  channel.delete();
  basin.delete();
  return combined;
}

/**
 * Where the part's surface is, straight down from high above (x, y).
 *
 * Returns null when the ray misses the part entirely -- i.e. the user picked a spot
 * that is not over the model at all.
 */
export function surfaceHeightAt(part: MeshData, x: number, y: number): number | null {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(part.positions), 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(part.indices), 1));
  const bvh = new MeshBVH(geom);

  const box = boundingBox(part);
  const above = box.max[2] + Math.max(1, (box.max[2] - box.min[2]) * 0.1);

  const ray = new THREE.Ray(
    new THREE.Vector3(x, y, above),
    new THREE.Vector3(0, 0, -1),
  );

  // DoubleSide: we want the first surface we meet coming down, whichever way its
  // triangles happen to be wound.
  const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
  return hit ? hit.point.z : null;
}

/**
 * Where the part is highest, in plan view.
 *
 * Not the single topmost vertex -- that is one facet's corner, and on a curved
 * summit it wanders with the tessellation. Instead, average the vertices within a
 * thin band below the top, which lands the channel on the middle of the high region
 * and stays put when the mesh is re-triangulated.
 */
function summit(part: MeshData, topZ: number, height: number): [number, number] {
  const band = Math.max(height * 0.02, 1e-6);
  const p = part.positions;

  let sx = 0;
  let sy = 0;
  let n = 0;

  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 2]! >= topZ - band) {
      sx += p[i]!;
      sy += p[i + 1]!;
      n++;
    }
  }

  if (n === 0) {
    const box = boundingBox(part);
    return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2];
  }
  return [sx / n, sy / n];
}
