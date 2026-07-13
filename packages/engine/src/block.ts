/**
 * The mold block: the lump of plaster the cavity is cut out of.
 *
 * Everything here assumes the part has already been rotated so the pull axis is
 * +Z. `prepare()` in mold.ts is what guarantees that.
 */
import type { Manifold } from 'manifold-3d';
import { manifold } from './wasm.js';
import type { MeshData } from './types.js';
import { boundingBox, boxSize } from './mesh.js';

export interface BlockOptions {
  /** Plaster thickness around the part, mm. */
  wallThickness: number;
  /** A rectangular block, or a hull that hugs the part and saves plaster. */
  style: 'box' | 'conformal';
  /** Taper on the outer walls so a printed shell releases from cured plaster, degrees. */
  outerDraft: number;
}

/**
 * Build the block around an already-aligned part.
 *
 * The caller owns the returned Manifold.
 */
export async function moldBlock(
  master: Manifold,
  part: MeshData,
  opts: BlockOptions,
): Promise<Manifold> {
  const wasm = await manifold();
  const { Manifold: M, CrossSection } = wasm;

  const box = boundingBox(part);
  const size = boxSize(part ? box : box);
  const t = opts.wallThickness;

  if (opts.style === 'conformal') {
    // A hull hugs the part, and a Minkowski sum with a sphere grows it outward by
    // exactly the wall thickness -- a true offset, so the plaster is an even
    // jacket rather than a box with a part rattling around inside it.
    const hull = master.hull();
    const ball = M.sphere(t, 24);
    const grown = hull.minkowskiSum(ball);
    hull.delete();
    ball.delete();
    return grown;
  }

  const width = size[0] + 2 * t;
  const depth = size[1] + 2 * t;
  const height = size[2] + 2 * t;

  // Draft the outer walls by shrinking the top face. A printed shell has to lift
  // off the set plaster; with perfectly vertical walls it suctions and binds.
  const inset = height * Math.tan((opts.outerDraft * Math.PI) / 180);
  const scaleTop: [number, number] = [
    Math.max(0.05, (width - 2 * inset) / width),
    Math.max(0.05, (depth - 2 * inset) / depth),
  ];

  const profile = CrossSection.square([width, depth], true);
  const solid = profile.extrude(height, 1, 0, scaleTop, false);
  profile.delete();

  // Centre it on the part in X and Y, and seat it under the part in Z.
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = (box.min[1] + box.max[1]) / 2;
  const placed = solid.translate([cx, cy, box.min[2] - t]);
  solid.delete();

  return placed;
}
