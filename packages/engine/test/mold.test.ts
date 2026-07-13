import { describe, expect, it } from 'vitest';
import { buildMold, shrinkageScale } from '../src/mold.js';
import { manifold, withScope } from '../src/wasm.js';
import { toManifoldMesh } from '../src/mesh.js';
import { cup, cylinder, hollowSphere, sphere } from '../src/fixtures.js';
import { isClosed, volume } from '../src/mesh.js';
import { DEFAULT_PARAMS, type MoldParams } from '../src/types.js';

const params = (over: Partial<MoldParams> = {}): MoldParams => ({ ...DEFAULT_PARAMS, ...over });

describe('shrinkageScale', () => {
  it('scales UP by the reciprocal, not by the percentage', () => {
    // The classic mistake: 13% shrinkage is not a 1.13x mold. The fired pot is
    // 87% of the mold, so the mold must be 1/0.87 = 1.1494x -- and a mold built
    // at 1.13x yields pots that are consistently a size too small.
    expect(shrinkageScale(0.13)).toBeCloseTo(1.14943, 4);
    expect(shrinkageScale(0.13)).not.toBeCloseTo(1.13, 2);
  });

  it('is exact at zero, and rejects the impossible', () => {
    expect(shrinkageScale(0)).toBe(1);
    expect(() => shrinkageScale(1)).toThrow();
    expect(() => shrinkageScale(-0.1)).toThrow();
  });

  it('a mold cut at 13% yields a pot of the intended size', () => {
    const intended = 100;
    const moldSize = intended * shrinkageScale(0.13);
    const fired = moldSize * (1 - 0.13);
    expect(fired).toBeCloseTo(intended, 9);
  });
});

describe('buildMold', () => {
  it('conserves volume: plaster + cavity == block', async () => {
    // THE GOLDEN TEST. Plaster, plus the space the part occupies, equals the
    // block it was cut from. An inverted operand, a missed intersection, a solid
    // silently emptied -- nearly every way this pipeline can break shows up here.
    //
    // Keys are off, because they break this identity ON PURPOSE (see below).
    const mold = await buildMold(cup(), params({ keyCount: 0 }));

    const upper = mold.plasterUpper ? volume(mold.plasterUpper) : 0;
    const lower = volume(mold.plasterLower);

    // The spare pokes out through the top of the block, so only the part of the
    // cavity actually inside the block was carved out of it.
    const carved = await intersectVolume(mold.cavity, mold.block);

    const total = upper + lower + carved;
    // Within 0.01% of the block: the residue is faceting, not lost geometry.
    expect(Math.abs(total - mold.volumes.block) / mold.volumes.block).toBeLessThan(1e-4);
  });

  it('keys break that conservation by exactly the clearance, and only that way', async () => {
    // Sockets are deliberately larger than the cones that seat in them -- that
    // gap is what lets the halves close on plaster that has swollen a hair. So
    // the halves must NOT sum back to the block, and the deficit must be small,
    // positive, and grow with the clearance. If it ever came out negative, the
    // sockets would be tighter than the cones and the mold would never shut.
    const measure = async (clearance: number) => {
      const mold = await buildMold(cup(), params({ keyCount: 4, keyClearance: clearance }));
      const carved = await intersectVolume(mold.cavity, mold.block);
      const total = volume(mold.plasterUpper!) + volume(mold.plasterLower) + carved;
      return mold.volumes.block - total;
    };

    const tight = await measure(0.3);
    const loose = await measure(0.9);

    expect(tight).toBeGreaterThan(0);
    expect(loose).toBeGreaterThan(tight);
  });

  it('produces watertight halves', async () => {
    const mold = await buildMold(cup(), params());
    expect(isClosed(mold.plasterLower)).toBe(true);
    expect(isClosed(mold.plasterUpper!)).toBe(true);
  });

  it('scales the cavity for shrinkage', async () => {
    const part = cylinder(20, 40);
    const mold = await buildMold(part, params({ shrinkage: 0.13, split: false }));

    // The part inside the mold is bigger than the part that was uploaded, by the
    // cube of the linear scale factor.
    const expected = volume(part) * shrinkageScale(0.13) ** 3;
    expect(mold.volumes.part).toBeCloseTo(expected, -2);
  });

  it('cuts a real cavity, not a solid lump', async () => {
    const mold = await buildMold(cup(), params());
    expect(mold.volumes.plaster).toBeLessThan(mold.volumes.block);
    expect(mold.volumes.plaster).toBeGreaterThan(0);
  });

  it('refuses a part it cannot mold rather than emitting a wrong one', async () => {
    // A sealed void cannot be reached from any direction. The only honest output
    // is a refusal -- a mold that quietly ignores geometry it could not see is
    // worse than no mold, because it looks like success.
    await expect(buildMold(await hollowSphere(), params())).rejects.toThrow(/undercut/i);
  });

  it('keys the parting face, clear of the cavity', async () => {
    const mold = await buildMold(cup(), params({ keyCount: 4 }));
    expect(mold.plan.keyPositions.length).toBeGreaterThan(0);
    expect(mold.plan.keyPositions.length).toBeLessThanOrEqual(4);
  });

  it('makes the keyed halves mate: cones on one, sockets in the other', async () => {
    const withKeys = await buildMold(cup(), params({ keyCount: 4, keyClearance: 0.3 }));
    const noKeys = await buildMold(cup(), params({ keyCount: 0 }));

    // Cones ADD plaster to the lower half...
    expect(volume(withKeys.plasterLower)).toBeGreaterThan(volume(noKeys.plasterLower));
    // ...and sockets REMOVE it from the upper. If these ever move the same way,
    // both halves got cones and the mold will not close.
    expect(volume(withKeys.plasterUpper!)).toBeLessThan(volume(noKeys.plasterUpper!));
  });

  it('leaves a one-piece mold unsplit', async () => {
    const mold = await buildMold(cup(), params({ split: false }));
    expect(mold.plasterUpper).toBeNull();
    expect(isClosed(mold.plasterLower)).toBe(true);
  });

  it('cuts more plaster away for a bigger part', async () => {
    const small = await buildMold(sphere(15), params({ split: true }));
    const large = await buildMold(sphere(25), params({ split: true }));
    expect(large.volumes.cavity).toBeGreaterThan(small.volumes.cavity);
  });
});

/** Volume of the overlap of two meshes. */
async function intersectVolume(a: { positions: Float32Array; indices: Uint32Array }, b: typeof a): Promise<number> {
  const wasm = await manifold();
  return withScope(async (s) => {
    const solidA = s.keep(wasm.Manifold.ofMesh(await toManifoldMesh(a)));
    const solidB = s.keep(wasm.Manifold.ofMesh(await toManifoldMesh(b)));
    return s.keep(solidA.intersect(solidB)).volume();
  });
}
