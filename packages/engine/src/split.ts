/**
 * Cutting the plaster in two.
 *
 * The identity this module must preserve, and which the golden test asserts:
 *
 *     vol(upper) + vol(lower) + vol(block AND cavity) == vol(block)
 *
 * Plaster plus the space the part occupies equals the block it was cut from.
 * Nothing vanishes and nothing is created. Almost every way a boolean pipeline
 * can be wrong -- an inverted operand, a missed intersection, a solid silently
 * emptied -- shows up as a violation of that one line.
 */
import type { Manifold } from 'manifold-3d';

export interface SplitResult {
  upper: Manifold;
  lower: Manifold;
}

/**
 * Split a solid by the horizontal plane z = `partingZ`.
 *
 * Manifold's `splitByPlane` does not document which side comes back first, and
 * guessing would silently swap the mold halves -- so the halves are identified
 * by where they actually sit rather than by trusting the argument order.
 */
export function splitAtZ(solid: Manifold, partingZ: number): SplitResult {
  const [a, b] = solid.splitByPlane([0, 0, 1], partingZ);

  const aBox = a.boundingBox();
  const bBox = b.boundingBox();
  const aCentre = (aBox.min[2] + aBox.max[2]) / 2;
  const bCentre = (bBox.min[2] + bBox.max[2]) / 2;

  // An empty half has a degenerate box; fall back to the other one's position.
  if (a.isEmpty()) return bCentre >= partingZ ? { upper: b, lower: a } : { upper: a, lower: b };
  if (b.isEmpty()) return aCentre >= partingZ ? { upper: a, lower: b } : { upper: b, lower: a };

  return aCentre >= bCentre ? { upper: a, lower: b } : { upper: b, lower: a };
}
