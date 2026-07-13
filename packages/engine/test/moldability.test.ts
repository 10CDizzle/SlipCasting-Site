import { describe, expect, it } from 'vitest';
import { findPullDirections, findPartingPlane, moldabilityAt } from '../src/analysis.js';
import { cup, handledMug, sphere } from '../src/fixtures.js';
import { buildMold, planMold } from '../src/mold.js';
import { boundingBox } from '../src/mesh.js';
import { DEFAULT_PARAMS, type Vec3 } from '../src/types.js';

const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

const align = (a: Vec3, b: Vec3) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);

/**
 * A two-part mold is only openable if the parting PLANE separates the two
 * reachability sets.
 *
 * Every face above the plane is touched by the upper half and must therefore be
 * reachable from +d; every face below is touched by the lower half and must be
 * reachable from -d. Checking only that each face is reachable from +d OR -d is
 * necessary but NOT sufficient: it passes molds whose halves each contain surfaces
 * they can never release, which physically will not open.
 *
 * That gap is what let the mug's seam land 26 degrees off its plane of symmetry,
 * putting the whole handle inside one half with its hole trapped.
 */
describe('a mold has to actually open', () => {
  it('parts a mug on its plane of symmetry, not somewhere near it', async () => {
    const mug = await handledMug();
    const [best] = findPullDirections(mug, { minDraft: DEFAULT_PARAMS.minDraft });

    // The handle loop lies in the XZ plane, so the mug is mirror-symmetric about
    // y = 0. That plane, and only that plane, is where a pottery puts the seam --
    // it bisects the handle so each half releases its own side of it.
    expect(align(best!.direction, Y)).toBeGreaterThan(0.98);
  });

  it('leaves no face trapped on the wrong side of the parting plane', async () => {
    const mug = await handledMug();
    const [best] = findPullDirections(mug, { minDraft: DEFAULT_PARAMS.minDraft });

    const plane = findPartingPlane(mug, best!.direction, { minDraft: 2 });
    const check = moldabilityAt(mug, best!.direction, plane, 2);

    // Zero, judged against the plane -- not merely "each face can see one pole".
    expect(check.area.undercut).toBe(0);
    expect(check.moldable).toBe(true);
  });

  it('splits the handle between the two halves', async () => {
    // The handle straddles the symmetry plane, so each half must contain part of it.
    // A handle wholly inside one half is a handle that half can never let go of.
    const mug = await handledMug();
    const plan = planMold(mug, DEFAULT_PARAMS);

    const p = plan.master.positions;
    let above = 0;
    let below = 0;

    // In the aligned frame the parting plane is z = partingZ. Count vertices of the
    // handle -- the part that sticks out furthest from the mug's axis.
    for (let i = 0; i < p.length; i += 3) {
      const z = p[i + 2]!;
      if (z > plan.partingZ + 1) above++;
      else if (z < plan.partingZ - 1) below++;
    }

    expect(above).toBeGreaterThan(0);
    expect(below).toBeGreaterThan(0);
    // And roughly balanced: a symmetric part cut on its symmetry plane splits evenly.
    const ratio = Math.min(above, below) / Math.max(above, below);
    expect(ratio).toBeGreaterThan(0.8);
  });

  it('still parts a cup across its axis', async () => {
    // The fix must not break the simple case: a cup parts perpendicular to its own
    // axis, at the rim.
    const [best] = findPullDirections(cup(), { minDraft: DEFAULT_PARAMS.minDraft });
    expect(align(best!.direction, Z)).toBeGreaterThan(0.95);
  });

  it('still parts a sphere at its equator', () => {
    const plane = findPartingPlane(sphere(20), Z, { minDraft: 2 });
    expect(plane).toBeCloseTo(0, 0);
  });
});

/**
 * A one-piece mold is a mold with an open MOUTH, not a sealed box.
 *
 * The block is cut off at the parting plane and the part lifts straight out of what
 * is left. Build the block over the top of the part instead and you have entombed it:
 * a sphere cannot be extracted from a closed lump of plaster, and neither can a cup.
 *
 * The engine used to do exactly that, and report it as moldable, because it only ever
 * asked whether each face could see a pole -- never whether the mold could get out of
 * its own way.
 */
describe('a one-piece mold is open at the top', () => {
  it('does not entomb a sphere', async () => {
    // Cast in an open mold cut at the equator, a sphere lifts straight out.
    const mold = await buildMold(sphere(20), { ...DEFAULT_PARAMS, split: false });
    expect(mold.plan.analysis.moldable).toBe(true);
  });

  it('cuts the block off at the parting plane, leaving no lid', async () => {
    const mold = await buildMold(cup(), { ...DEFAULT_PARAMS, split: false });

    const blockTop = boundingBox(mold.block).max[2];
    const partTop = boundingBox(mold.plan.master).max[2];

    // The plaster stops at the mouth. It does not close over the part.
    expect(blockTop).toBeLessThan(partTop);
    expect(blockTop).toBeCloseTo(mold.plan.partingZ, 1);
  });

  it('still builds a lid for a two-part mold, which is what the upper half IS', async () => {
    const mold = await buildMold(cup(), { ...DEFAULT_PARAMS, split: true });
    const blockTop = boundingBox(mold.block).max[2];
    const partTop = boundingBox(mold.plan.master).max[2];

    expect(blockTop).toBeGreaterThan(partTop);
    expect(mold.plasterUpper).not.toBeNull();
  });
});

/**
 * Which way is UP is not the same question as which way the mold OPENS.
 *
 * A mug's mold opens horizontally -- the halves come apart through the handle -- but
 * it stands upright on the bench and is filled from the rim. Assuming the pour hole
 * belongs at the top of the pull axis puts the spare on the side of the mug, which
 * would empty itself onto the floor.
 */
describe('pouring is not the same axis as pulling', () => {
  it('pours a mug into its rim, not into its side', async () => {
    const mug = await handledMug();
    const plan = planMold(mug, DEFAULT_PARAMS);

    // The mug is modelled upright, so its own +Z is the pour axis. The pull axis is
    // roughly Y. They must be close to perpendicular -- that is the whole point.
    expect(align(plan.pullDirection, plan.pourDirection)).toBeLessThan(0.2);
    expect(align(plan.pourDirection, Z)).toBeGreaterThan(0.95);
  });

  it('pours a cup down its own axis, where pull and pour coincide', async () => {
    const plan = planMold(cup(), DEFAULT_PARAMS);
    // For a simple cup the two axes are the same, and that is fine.
    expect(align(plan.pullDirection, plan.pourDirection)).toBeGreaterThan(0.95);
  });
});
