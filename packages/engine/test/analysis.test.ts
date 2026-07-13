import { describe, expect, it } from 'vitest';
import {
  classifyFaces,
  findPartingPlane,
  findPullDirections,
} from '../src/analysis.js';
import {
  cubeWithBoss,
  cup,
  cylinder,
  handledMug,
  hollowSphere,
  rotateMesh,
  sphere,
  torus,
} from '../src/fixtures.js';
import type { Vec3 } from '../src/types.js';

const Z: Vec3 = [0, 0, 1];
const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];

/** How parallel two axes are, ignoring sign: 1 = same axis, 0 = perpendicular. */
function axisAlignment(a: Vec3, b: Vec3): number {
  return Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

describe('classifyFaces', () => {
  it('finds no undercuts on a tapered cup pulled along its axis', () => {
    const analysis = classifyFaces(cup(), Z, 2);
    expect(analysis.moldable).toBe(true);
    expect(analysis.area.undercut).toBe(0);
  });

  it('calls a straight-walled cylinder shallow, not clean', () => {
    // A wall parallel to the pull axis has zero draft. It will release, but it
    // drags against the plaster the whole way out -- the user needs to be told.
    const analysis = classifyFaces(cylinder(20, 40), Z, 2);
    expect(analysis.moldable).toBe(true);
    expect(analysis.area.shallow).toBeGreaterThan(0);
  });

  it('flags the flat faces of a cube as shallow', () => {
    const analysis = classifyFaces(cubeWithBoss(), Z, 2);
    expect(analysis.area.shallow).toBeGreaterThan(0);
    expect(analysis.moldable).toBe(true);
  });

  it('parts a torus at its equator but not across its hole', () => {
    // Cut a donut at the equator and each half is a ring bump: no undercuts.
    expect(classifyFaces(torus(), Z, 2).moldable).toBe(true);
    // Cut it across the hole and the hole becomes a through-undercut.
    expect(classifyFaces(torus(), X, 2).moldable).toBe(false);
  });

  it('cannot mold a handled mug along its own axis', async () => {
    // The obvious guess, and the wrong one: the handle's inner surface is
    // occluded from both above and below.
    const analysis = classifyFaces(await handledMug(), Z, 2);
    expect(analysis.moldable).toBe(false);
    expect(analysis.area.undercut).toBeGreaterThan(0);
  });

  it('molds a handled mug perpendicular to the handle loop', async () => {
    // Straight through the handle's hole. This is where a pottery actually
    // puts the seam on a mug mold.
    const analysis = classifyFaces(await handledMug(), Y, 2);
    expect(analysis.moldable).toBe(true);
    expect(analysis.area.undercut).toBe(0);
  });

  it('never molds an enclosed void, from any direction', async () => {
    const part = await hollowSphere();
    for (const dir of [Z, X, Y, [0.577, 0.577, 0.577] as Vec3]) {
      expect(classifyFaces(part, dir, 2).moldable).toBe(false);
    }
  });

  it('is symmetric under reversing the pull axis', () => {
    // +d and -d describe the same two-part mold, so they must agree.
    const forward = classifyFaces(cup(), Z, 2);
    const backward = classifyFaces(cup(), [0, 0, -1], 2);
    expect(backward.area.undercut).toBeCloseTo(forward.area.undercut, 6);
    expect(backward.moldable).toBe(forward.moldable);
  });
});

describe('findPullDirections', () => {
  it('recovers the axis of a cup', () => {
    const [best] = findPullDirections(cup(), { samples: 64 });
    expect(axisAlignment(best!.direction, Z)).toBeGreaterThan(0.95);
    expect(best!.undercutArea).toBe(0);
  });

  it('finds the same axis when the part arrives rotated', () => {
    // Nobody exports their model conveniently aligned. Rotating the part must
    // rotate the answer, not change it.
    const tilted = rotateMesh(cup(), [1, 0, 0], 35);
    const [best] = findPullDirections(tilted, { samples: 96 });

    const expected: Vec3 = [0, -Math.sin((35 * Math.PI) / 180), Math.cos((35 * Math.PI) / 180)];
    expect(axisAlignment(best!.direction, expected)).toBeGreaterThan(0.93);
    expect(best!.undercutArea).toBe(0);
  });

  it('finds the seam a potter would use on a mug', async () => {
    // The headline result. Left to the obvious guess -- the mug's own axis -- the
    // handle is a hopeless undercut. The search has to reject that and pull
    // through the handle's hole instead, which is where a pottery actually puts
    // the seam on a mug mold.
    const [best] = findPullDirections(await handledMug(), { samples: 128 });

    // It found a genuinely moldable axis, not a least-bad compromise.
    expect(best!.undercutArea).toBe(0);
    // Essentially straight through the handle's hole.
    expect(axisAlignment(best!.direction, Y)).toBeGreaterThan(0.9);
    // And decisively not the mug's own axis: this is >60 degrees away from Z.
    expect(axisAlignment(best!.direction, Z)).toBeLessThan(0.5);
  });

  it('reports undercuts from every direction for an impossible part', async () => {
    const candidates = findPullDirections(await hollowSphere(), { samples: 64 });
    for (const candidate of candidates) {
      expect(candidate.undercutArea).toBeGreaterThan(0);
    }
  });

  it('returns distinct axes, not near-duplicates of one', () => {
    const candidates = findPullDirections(cup(), { samples: 64, keep: 3 });
    expect(candidates.length).toBeGreaterThan(1);
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        expect(
          axisAlignment(candidates[i]!.direction, candidates[j]!.direction),
        ).toBeLessThan(0.96);
      }
    }
  });
});

describe('findPartingPlane', () => {
  it('cuts a sphere at its equator', () => {
    const r = 20;
    expect(findPartingPlane(sphere(r), Z)).toBeCloseTo(0, 0);
  });

  it('cuts a cup at its widest point, near the rim', () => {
    const height = 90;
    const plane = findPartingPlane(cup({ height }), Z);
    // The cup flares outward, so the silhouette is widest just below the rim.
    expect(plane).toBeGreaterThan(height * 0.6);
    expect(plane).toBeLessThanOrEqual(height);
  });

  it('cuts a torus at its equator', () => {
    expect(findPartingPlane(torus(30, 10), Z)).toBeCloseTo(0, 0);
  });
});
