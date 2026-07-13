import { describe, expect, it } from 'vitest';
import { generate } from '../src/generate.js';
import { planMold } from '../src/mold.js';
import { classifyFaces, findPullDirections } from '../src/analysis.js';
import { surfaceHeightAt } from '../src/spare.js';
import { cup, handledMug } from '../src/fixtures.js';
import { boundingBox } from '../src/mesh.js';
import { DEFAULT_PARAMS } from '../src/types.js';

/**
 * The mug is the fixture that most nearly resembles what someone will actually
 * upload, and it exercises the one claim this tool makes that a naive tool would
 * get wrong: that the seam belongs through the handle, not along the mug's axis.
 *
 * The engine's unit tests proved the SEARCH finds that axis. These prove the whole
 * pipeline survives it -- which is a different claim, because the pipeline rotates
 * the part onto that axis and then re-checks it, and a rotation is exactly where a
 * borderline result can flip.
 */
describe('the mug, end to end', () => {
  it('is moldable along the axis the search picks', async () => {
    const mug = await handledMug();
    const [best] = findPullDirections(mug, { minDraft: DEFAULT_PARAMS.minDraft });

    expect(best!.undercutArea).toBe(0);

    // The same check the pipeline makes after rotating the part onto that axis.
    const plan = planMold(mug, DEFAULT_PARAMS);
    expect(plan.analysis.area.undercut).toBe(0);
    expect(plan.analysis.moldable).toBe(true);
  });

  it('generates a full mold without refusing', async () => {
    const result = await generate(await handledMug(), DEFAULT_PARAMS);
    expect(result.bodies.filter((b) => b.printable).length).toBeGreaterThan(0);
  });

  it('lands the spare on the part even when the part is lying on its side', async () => {
    // The bug this pins: the spare used to be dropped over the centre of the
    // bounding box. For an upright cup that is also the summit, so it worked and
    // looked correct. The mug parts through its handle, so the pipeline lays it on
    // its side -- and above the bbox centre there is nothing but air. The channel
    // missed the part entirely, giving a mold with a pour hole that dead-ends and
    // a cavity sealed inside solid plaster: perfect-looking, and useless.
    const mug = await handledMug();
    const plan = planMold(mug, DEFAULT_PARAMS);

    // Confirm the premise -- the pull axis really is off the mug's own axis, so
    // this test would go on protecting nothing if the search ever changed.
    expect(Math.abs(plan.pullDirection[2])).toBeLessThan(0.6);

    // And the geometry survives it. buildMold throws if the spare misses.
    await expect(generate(mug, DEFAULT_PARAMS)).resolves.toBeDefined();
  });

  it('still puts the spare over the top of an upright cup', async () => {
    // The fix must not regress the simple case it was hiding behind.
    const result = await generate(cup(), DEFAULT_PARAMS);
    expect(result.mold.volumes.cavity).toBeGreaterThan(result.mold.volumes.part);
  });
});

/**
 * Where the spare sits, read back out of the finished geometry.
 *
 * Above the part's highest point the only thing left in the cavity is the pour
 * channel, so the average x of those vertices is the channel's centre.
 */
function spareCentreX(result: Awaited<ReturnType<typeof generate>>): number {
  const partTop = boundingBox(result.mold.plan.master).max[2];
  const p = result.mold.cavity.positions;

  let sum = 0;
  let n = 0;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 2]! > partTop + 1) {
      sum += p[i]!;
      n++;
    }
  }
  return n === 0 ? NaN : sum / n;
}

describe('placing the spare by hand', () => {
  it('accepts a spot off the summit and still reaches the part', async () => {
    // A cup is a solid of revolution about the pull axis, so a point 20mm off centre
    // is still over the part -- but its surface there is LOWER than the summit. The
    // channel has to start from the surface beneath the chosen point, not from the
    // part's global maximum, or it hangs in mid-air connected to nothing.
    const offset = await generate(cup(), { ...DEFAULT_PARAMS, sparePosition: [20, 0, 0] });

    // It built, which means the spare-reaches-the-part guard was satisfied.
    expect(offset.mold.volumes.cavity).toBeGreaterThan(offset.mold.volumes.part);
  });

  it('puts the pour hole where you clicked', async () => {
    // The assertion that actually means something. Volume is a poor proxy: nudge the
    // spare a little off-centre on a flat-topped cup and the union volume does not
    // change at all, because the channel is still wholly within the part's top face.
    // Ask instead where the hole IS -- above the part, the only cavity left is the
    // spare, so its centre is the spare's centre.
    const auto = await generate(cup(), DEFAULT_PARAMS);
    const picked = await generate(cup(), { ...DEFAULT_PARAMS, sparePosition: [22, 0, 0] });

    expect(spareCentreX(auto)).toBeCloseTo(0, 0);
    expect(spareCentreX(picked)).toBeCloseTo(22, 0);
  });

  it('refuses a spot that is not over the part at all', async () => {
    // Clicking into thin air must not silently produce a mold whose pour hole ends
    // in solid plaster.
    await expect(
      generate(cup(), { ...DEFAULT_PARAMS, sparePosition: [500, 500, 0] }),
    ).rejects.toThrow(/sit over the part/i);
  });

  it('finds the surface height beneath a point, and nothing beneath empty space', () => {
    const part = cup({ radius: 35, height: 90 });

    // Dead centre: the top of the cup.
    const middle = surfaceHeightAt(part, 0, 0);
    expect(middle).not.toBeNull();
    expect(middle!).toBeCloseTo(90, 0);

    // Well outside its footprint: nothing there.
    expect(surfaceHeightAt(part, 300, 0)).toBeNull();
  });
});
