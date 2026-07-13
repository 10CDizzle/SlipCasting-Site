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
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = (box.min[1] + box.max[1]) / 2;

  const r = opts.diameter / 2;

  // Start the channel *below* the part's highest point. Beginning exactly at the
  // surface leaves the two solids touching on a single tangent plane, which a
  // boolean is entitled to treat as not overlapping at all -- and then the pour
  // channel dead-ends in plaster with the cavity sealed behind it.
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
