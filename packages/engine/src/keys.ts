/**
 * Registration keys, known in a pottery as natches.
 *
 * Cones on the parting face of one half, matching dimples in the other, so the
 * halves seat in exactly one position every time they are strapped together. Get
 * them wrong and every cast carries a stepped seam.
 *
 * Two rules govern placement, and both are tested:
 *   - a key may never touch the cavity, or it fouls the cast;
 *   - male and female must differ by a real clearance, or the halves bind on
 *     plaster that has swollen a hair and never close.
 */
import type { CrossSection, Manifold } from 'manifold-3d';
import { manifold } from './wasm.js';

export interface KeyOptions {
  count: number;
  diameter: number;
  /** Gap between cone and socket, mm. Plaster is not a precision material. */
  clearance: number;
}

export interface KeySet {
  /** Cones to add to the lower half. Caller owns this. */
  males: Manifold | null;
  /** Slightly larger cones to subtract from the upper half. Caller owns this. */
  females: Manifold | null;
  positions: Array<[number, number]>;
}

type Point = [number, number];

/** Even-odd point-in-region test across every contour, holes included. */
function contains(polygons: Point[][], p: Point): boolean {
  let inside = false;
  for (const ring of polygons) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      const straddles = a[1] > p[1] !== b[1] > p[1];
      if (!straddles) continue;
      const x = ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
      if (p[0] < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Choose key centres.
 *
 * Farthest-point sampling: take the candidate furthest from everything chosen so
 * far, repeatedly. Keys bunched on one side of the mold let the halves pivot
 * about them, so spreading them out is the entire point.
 */
function spreadPoints(candidates: Point[], count: number): Point[] {
  if (candidates.length === 0) return [];

  const chosen: Point[] = [];

  // Start from the candidate furthest from the centroid, so the first key lands
  // at an extremity rather than in the middle.
  let cx = 0;
  let cy = 0;
  for (const c of candidates) {
    cx += c[0];
    cy += c[1];
  }
  cx /= candidates.length;
  cy /= candidates.length;

  let seed = candidates[0]!;
  let seedDist = -1;
  for (const c of candidates) {
    const d = Math.hypot(c[0] - cx, c[1] - cy);
    if (d > seedDist) {
      seedDist = d;
      seed = c;
    }
  }
  chosen.push(seed);

  while (chosen.length < count) {
    let best: Point | null = null;
    let bestDist = -1;
    for (const c of candidates) {
      let nearest = Infinity;
      for (const s of chosen) {
        nearest = Math.min(nearest, Math.hypot(c[0] - s[0], c[1] - s[1]));
      }
      if (nearest > bestDist) {
        bestDist = nearest;
        best = c;
      }
    }
    // Everything left overlaps a key we already placed.
    if (!best || bestDist <= 1e-6) break;
    chosen.push(best);
  }

  return chosen;
}

/**
 * Build the keys for a parting plane at `partingZ`.
 *
 * `blockSection` is the plaster's footprint at that height and `cavitySection`
 * is the part's (plus the spare's), both sliced by the caller.
 */
export async function registrationKeys(
  blockSection: CrossSection,
  cavitySection: CrossSection,
  partingZ: number,
  opts: KeyOptions,
): Promise<KeySet> {
  const wasm = await manifold();
  const { Manifold: M } = wasm;

  const radius = opts.diameter / 2;
  // Keep the key's own footprint, plus a margin, clear of the cavity wall.
  const margin = Math.max(2, radius * 0.5);

  const keepOut = cavitySection.offset(margin, 'Round', 2, 16);
  const usable = blockSection.subtract(keepOut);
  // Erode by the key's radius: what remains is exactly the set of centres where
  // a key of this size still fits entirely on plaster.
  const placeable = usable.offset(-(radius + margin), 'Round', 2, 16);

  keepOut.delete();
  usable.delete();

  const polygons = placeable.toPolygons() as Point[][];
  const bounds = placeable.bounds();
  placeable.delete();

  if (polygons.length === 0 || polygons.every((ring) => ring.length === 0)) {
    // The parting face is too small, or the cavity eats all of it. Better no keys
    // than keys that break into the cast.
    return { males: null, females: null, positions: [] };
  }

  // Candidates: the region's own corners, plus a grid over it. The corners matter
  // -- on a rectangular mold face they are the natural, best-spread key spots.
  const candidates: Point[] = [];
  for (const ring of polygons) {
    for (const p of ring) candidates.push([p[0], p[1]]);
  }

  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const p: Point = [
        bounds.min[0] + ((bounds.max[0] - bounds.min[0]) * i) / steps,
        bounds.min[1] + ((bounds.max[1] - bounds.min[1]) * j) / steps,
      ];
      if (contains(polygons, p)) candidates.push(p);
    }
  }

  const positions = spreadPoints(candidates, opts.count);
  if (positions.length === 0) {
    return { males: null, females: null, positions: [] };
  }

  // A truncated cone, not a hemisphere: it seats positively, it lifts straight
  // out of the plaster, and it prints without support.
  const height = radius * 0.9;
  const maleParts: Manifold[] = [];
  const femaleParts: Manifold[] = [];

  for (const [x, y] of positions) {
    maleParts.push(
      M.cylinder(height, radius, radius * 0.6, 32, false).translate([x, y, partingZ]),
    );
    // The socket is the cone grown in every direction by the clearance, and sunk
    // by it too, so there is a gap under the tip as well as around the flanks.
    femaleParts.push(
      M.cylinder(
        height + opts.clearance * 2,
        radius + opts.clearance,
        radius * 0.6 + opts.clearance,
        32,
        false,
      ).translate([x, y, partingZ - opts.clearance]),
    );
  }

  const males = M.union(maleParts);
  const females = M.union(femaleParts);
  for (const m of maleParts) m.delete();
  for (const f of femaleParts) f.delete();

  return { males, females, positions };
}
