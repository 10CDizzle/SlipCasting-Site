import { describe, expect, it } from 'vitest';
import { repair, weld, fillHoles } from '../src/repair.js';
import {
  cup,
  cylinder,
  explodeToSoup,
  flipWinding,
  punchHoles,
  sphere,
} from '../src/fixtures.js';
import { isClosed, openEdgeCount, signedVolume, volume } from '../src/mesh.js';

describe('repair', () => {
  it('leaves an already-clean mesh alone', async () => {
    const input = cylinder(20, 40);
    const { mesh, report } = await repair(input);

    expect(report.ok).toBe(true);
    expect(report.tier).toBe('clean');
    expect(report.windingFlipped).toBe(false);
    expect(isClosed(mesh)).toBe(true);
    expect(volume(mesh)).toBeCloseTo(volume(input), 3);
  });

  it('welds unwelded triangle soup back into a solid', async () => {
    // This is what an STL actually contains: every triangle carries its own
    // three vertex copies, so nothing is shared and every edge reads as open.
    const clean = cup();
    const soup = explodeToSoup(clean);

    expect(openEdgeCount(soup)).toBeGreaterThan(0);
    expect(isClosed(soup)).toBe(false);

    const { mesh, report } = await repair(soup);

    expect(report.ok).toBe(true);
    expect(report.tier).toBe('welded');
    expect(report.verticesWelded).toBeGreaterThan(0);
    expect(isClosed(mesh)).toBe(true);
    // Welding must not move geometry: the volume is preserved exactly.
    expect(volume(mesh)).toBeCloseTo(volume(clean), 2);
  });

  it('corrects an inside-out mesh', async () => {
    const flipped = flipWinding(cylinder(15, 30));
    expect(signedVolume(flipped)).toBeLessThan(0);

    const { mesh, report } = await repair(flipped);

    expect(report.ok).toBe(true);
    expect(report.windingFlipped).toBe(true);
    // Positive signed volume == the triangles face outward == a solid, not a void.
    expect(signedVolume(mesh)).toBeGreaterThan(0);
    expect(report.manifoldStatus).toBe('NoError');
  });

  it('fills holes punched in the surface', async () => {
    const clean = sphere(20);
    const holed = punchHoles(clean, 4);

    expect(isClosed(holed)).toBe(false);

    const { mesh, report } = await repair(holed, { allowRemesh: false });

    expect(report.ok).toBe(true);
    expect(report.tier).toBe('holes-filled');
    expect(isClosed(mesh)).toBe(true);
    expect(report.openEdgesAfter).toBe(0);
    // Capping 4 small holes should barely change the volume.
    expect(volume(mesh)).toBeCloseTo(volume(clean), -1);
  });

  it('handles soup that is also holed and also inside-out', async () => {
    const wrecked = explodeToSoup(flipWinding(punchHoles(cup(), 3)));
    const { mesh, report } = await repair(wrecked);

    expect(report.ok).toBe(true);
    expect(isClosed(mesh)).toBe(true);
    expect(signedVolume(mesh)).toBeGreaterThan(0);
    expect(report.manifoldStatus).toBe('NoError');
  });

  it('refuses a hopeless mesh instead of silently "fixing" it', async () => {
    // Two triangles floating in space: not a solid, not repairable, and no
    // amount of welding or capping will make it one.
    const hopeless = {
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 50, 50, 50, 60, 50, 50, 50, 60, 50]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };

    const { report } = await repair(hopeless, { allowRemesh: false });

    expect(report.ok).toBe(false);
    expect(report.tier).toBe('failed');
    expect(report.messages.join(' ')).toContain('could not be made watertight');
  });

  it('refuses a closed-but-hollow sheet (the silent-garbage case)', async () => {
    // A flat square of two triangles. Hole-filling will happily cap its boundary
    // loop, producing a mesh that is *topologically watertight* but encloses zero
    // volume. Closed is not the same as solid, and a mold cut from a zero-volume
    // "solid" is nonsense that looks like success -- so this must be refused.
    const sheet = {
      positions: new Float32Array([0, 0, 0, 50, 0, 0, 50, 50, 0, 0, 50, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };

    const { report } = await repair(sheet, { allowRemesh: false });

    expect(report.ok).toBe(false);
    expect(report.messages.join(' ')).toContain('encloses no volume');
  });

  it('reports every action it took, for the UI to show verbatim', async () => {
    const { report } = await repair(explodeToSoup(cup()));
    expect(report.messages.length).toBeGreaterThan(0);
    expect(report.messages.join(' ')).toMatch(/[Ww]elded/);
  });
});

describe('weld', () => {
  it('is order-independent and collapses only true duplicates', () => {
    const original = cylinder(10, 20);
    const welded = weld(explodeToSoup(original), 1e-4);

    expect(welded.positions.length / 3).toBe(original.positions.length / 3);
    expect(volume(welded)).toBeCloseTo(volume(original), 4);
  });

  it('drops slivers that collapse to a line', () => {
    // Two coincident corners: after welding this triangle has no area.
    const sliver = {
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 10, 0, 0]),
      indices: new Uint32Array([0, 1, 2]),
    };
    expect(weld(sliver, 1e-4).indices.length).toBe(0);
  });
});

describe('fillHoles', () => {
  it('caps a boundary loop and leaves a closed mesh', () => {
    const holed = punchHoles(sphere(15), 2);
    expect(isClosed(holed)).toBe(false);

    const filled = fillHoles(holed);
    expect(isClosed(filled)).toBe(true);
    // The cap must face the same way as the shell it patches, or the volume
    // would come out inverted.
    expect(signedVolume(filled)).toBeGreaterThan(0);
  });
});
