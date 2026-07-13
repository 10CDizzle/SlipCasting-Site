/**
 * The spare: the funnel and reservoir you pour slip into.
 *
 * It is not decoration. Slip shrinks as the plaster draws water out of it, and
 * the level in the mold drops; the spare is the head of extra slip that keeps
 * feeding the cast so the rim does not come out starved. It also has to actually
 * *reach* the cavity and actually *breach* the outside of the block -- a spare
 * that connects to neither is the quietest, most expensive failure this engine
 * could ship, so both are asserted in the tests.
 */
import type { Manifold } from 'manifold-3d';
import { manifold } from './wasm.js';
import type { MeshData } from './types.js';
import { boundingBox } from './mesh.js';

export interface SpareOptions {
  /** Bore of the pour channel, mm. */
  diameter: number;
  /** How far the funnel stands proud of the block's top face, mm. */
  height: number;
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
  const partTopZ = box.max[2];

  // Sit the channel over the part's SUMMIT, not over the centre of its bounding
  // box. Those coincide for an upright cup and diverge completely for anything
  // else: a mug parts through its handle, so the pipeline lays it on its side,
  // and directly above the bbox centre there is nothing but air. A channel dropped
  // there never meets the part, and you get a mold with a pour hole that dead-ends
  // and a cavity sealed inside solid plaster -- which looks perfect until it is
  // printed, poured, and cured.
  const [cx, cy] = summit(part, partTopZ, box.max[2] - box.min[2]);

  const r = opts.diameter / 2;

  // Start the channel *below* the surface. Beginning exactly at it leaves the two
  // solids touching on a single tangent plane, which a boolean is entitled to call
  // no overlap at all.
  const overlap = Math.max(1, r * 0.25);
  const baseZ = partTopZ - overlap;

  // Run it clear through the top face and out into the funnel above.
  const channelTop = blockTopZ + opts.height * 0.35;
  const channelHeight = channelTop - baseZ;

  const channel = M.cylinder(channelHeight, r, r * 1.08, 48, false).translate([cx, cy, baseZ]);

  // A cone-shaped basin on top: somewhere to pour into without slopping slip
  // down the outside of the mold.
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
 * Where the part is highest, in plan view.
 *
 * Not the single topmost vertex -- that is one facet's corner, and on a curved
 * summit it wanders with the tessellation. Instead, average the vertices within a
 * thin band below the top, which lands the channel on the middle of the high
 * region and stays put when the mesh is re-triangulated.
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
