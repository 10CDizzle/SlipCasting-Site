import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { bundle, generate } from '../src/generate.js';
import { plasterMix, slipEstimate, checkBed, PRINT_BEDS } from '../src/report.js';
import { cup, explodeToSoup, hollowSphere } from '../src/fixtures.js';
import { parseSTL } from '../src/io.js';
import { isClosed, volume } from '../src/mesh.js';
import { repair } from '../src/repair.js';
import { DEFAULT_PARAMS, type MoldParams } from '../src/types.js';

const params = (over: Partial<MoldParams> = {}): MoldParams => ({ ...DEFAULT_PARAMS, ...over });

describe('plasterMix', () => {
  it('turns a volume into a weighing-scale reading', () => {
    // Plaster is mixed by weight to a consistency, never by eye. One litre of
    // mold at consistency 70 needs about 0.88 kg of plaster and 0.62 L of water.
    const mix = plasterMix(1e6, 70); // 1 litre, before the excess allowance
    expect(mix.volumeLitres).toBeCloseTo(1.1, 2); // 10% excess
    expect(mix.plasterKg).toBeCloseTo(0.97, 1);
    expect(mix.waterLitres).toBeCloseTo(0.68, 1);
  });

  it('uses more water at a looser consistency', () => {
    // Higher consistency = more water per unit plaster = a softer, more absorbent
    // mold. It is the single most consequential number in mold making.
    const stiff = plasterMix(1e6, 60);
    const loose = plasterMix(1e6, 80);
    expect(loose.waterLitres / loose.plasterKg).toBeGreaterThan(
      stiff.waterLitres / stiff.plasterKg,
    );
  });

  it('scales linearly with mold size', () => {
    expect(plasterMix(2e6).plasterKg).toBeCloseTo(plasterMix(1e6).plasterKg * 2, 5);
  });
});

describe('slipEstimate', () => {
  it('needs the full cavity even for a drained cast', () => {
    // Drain casting pours the mold FULL and tips most of it back out. You still
    // have to have that much slip mixed and ready.
    const est = slipEstimate(500_000, 30_000, 4);
    expect(est.fillLitres).toBeCloseTo(0.5, 3);
    expect(est.drainedKg).toBeLessThan(est.solidKg);
  });

  it('never claims a drained cast is heavier than a solid one', () => {
    // For a part too thin to hollow, the shell estimate must clamp to the solid.
    const est = slipEstimate(1000, 10_000, 50);
    expect(est.drainedKg).toBeLessThanOrEqual(est.solidKg);
  });
});

describe('checkBed', () => {
  it('lets a part be rotated on the bed', () => {
    // A 240 x 100 piece fits a 256 x 256 bed either way round.
    const mesh = { positions: new Float32Array([0, 0, 0, 240, 100, 50]), indices: new Uint32Array([0, 0, 0]) };
    expect(checkBed(mesh, PRINT_BEDS['Bambu X1C / P1S']!).fits).toBe(true);
  });

  it('fails a part that is genuinely too tall', () => {
    const mesh = { positions: new Float32Array([0, 0, 0, 100, 100, 400]), indices: new Uint32Array([0, 0, 0]) };
    expect(checkBed(mesh, PRINT_BEDS['Ender 3']!).fits).toBe(false);
  });
});

describe('generate', () => {
  it('produces printable shells from a raw STL-style soup', async () => {
    const result = await generate(explodeToSoup(cup()), params({ mode: 'shells' }));

    expect(result.repair.ok).toBe(true);
    const trays = result.bodies.filter((b) => b.printable);
    expect(trays.length).toBe(2);
    for (const tray of trays) {
      expect(isClosed(tray.mesh)).toBe(true);
      expect(volume(tray.mesh)).toBeGreaterThan(0);
    }
  });

  it('produces a positive, a bed plate, and a cottle in positive mode', async () => {
    const result = await generate(cup(), params({ mode: 'positive' }));
    const names = result.bodies.filter((b) => b.printable).map((b) => b.name);

    expect(names).toContain('Positive (part + spare)');
    expect(names).toContain('Parting bed plate');
    expect(names).toContain('Cottle');
  });

  it('writes instructions with the real numbers in them', async () => {
    const result = await generate(cup(), params({ shrinkage: 0.13 }));

    expect(result.instructions).toContain('13.0%');
    // The enlargement, not the shrinkage: 1/0.87 = 1.149, so +14.9%.
    expect(result.instructions).toContain('14.9%');
    expect(result.instructions).toMatch(/Dry plaster \| \*\*\d+\.\d+ kg\*\*/);
  });

  it('bundles STLs that re-import as watertight solids', async () => {
    // The end-to-end promise: what comes out of the ZIP is actually printable.
    const result = await generate(cup(), params({ mode: 'shells' }));
    const zip = unzipSync(bundle(result));

    const stls = Object.keys(zip).filter((f) => f.endsWith('.stl'));
    expect(stls.length).toBeGreaterThan(0);

    for (const name of stls) {
      const healed = await repair(parseSTL(zip[name]!));
      expect(healed.report.ok, `${name} did not re-import as a solid`).toBe(true);
      expect(volume(healed.mesh)).toBeGreaterThan(0);
    }

    expect(strFromU8(zip['INSTRUCTIONS.md']!)).toContain('Plaster');
    expect(Object.keys(zip)).toContain('slipcast-mold.3mf');
  });

  it('refuses an impossible part before writing a single file', async () => {
    await expect(generate(await hollowSphere(), params())).rejects.toThrow(/undercut/i);
  });

  it('warns about shallow draft without blocking the mold', async () => {
    const result = await generate(cup(), params({ minDraft: 15 }));
    expect(result.warnings.join(' ')).toMatch(/draft/i);
    expect(result.bodies.length).toBeGreaterThan(0);
  });
});
