import { describe, expect, it } from 'vitest';
import { generate } from '../src/generate.js';
import { planMold } from '../src/mold.js';
import { classifyFaces, findPullDirections } from '../src/analysis.js';
import { cup, handledMug } from '../src/fixtures.js';
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
