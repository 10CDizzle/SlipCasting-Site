import { describe, expect, it } from 'vitest';
import { generate } from '../src/generate.js';
import { buildMold } from '../src/mold.js';
import { cup } from '../src/fixtures.js';
import { volume } from '../src/mesh.js';
import { DEFAULT_PARAMS } from '../src/types.js';

/**
 * Does the mold actually carry keys, and do they survive all the way into the files
 * you print? Asserting it in the engine beats squinting at a screenshot.
 */
describe('keys, end to end', () => {
  it('places keys on the parting face', async () => {
    const mold = await buildMold(cup(), DEFAULT_PARAMS);
    expect(mold.plan.keyPositions.length).toBe(4);
  });

  it('carries the keys into the printed trays, not just the plaster', async () => {
    // The trays are cut as (box - plaster), so whatever the plaster carries, the tray
    // carries the negative of. If keys existed only on the plaster halves and never
    // reached the print, they would be a lie told by the viewport.
    const withKeys = await generate(cup(), { ...DEFAULT_PARAMS, keyCount: 4 });
    const without = await generate(cup(), { ...DEFAULT_PARAMS, keyCount: 0 });

    const tray = (r: typeof withKeys, name: string) =>
      r.bodies.find((b) => b.name.includes(name))!;

    // Tray A holds the upper half, whose parting face has SOCKETS -- so the tray's
    // floor must grow bumps, and the tray gets bigger.
    expect(volume(tray(withKeys, 'Tray A').mesh)).toBeGreaterThan(
      volume(tray(without, 'Tray A').mesh),
    );

    // Tray B holds the lower half, whose parting face has CONES -- so the tray's floor
    // must be dimpled, and the tray gets smaller. If both moved the same way, one of
    // the halves is getting the wrong sex of key and the mold will not close.
    expect(volume(tray(withKeys, 'Tray B').mesh)).toBeLessThan(
      volume(tray(without, 'Tray B').mesh),
    );
  });
});
