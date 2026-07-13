import { describe, expect, it } from 'vitest';
import {
  cubeWithBoss,
  cup,
  cylinder,
  handledMug,
  hollowSphere,
  sphere,
  torus,
} from '../src/fixtures.js';
import { isClosed, signedVolume, volume } from '../src/mesh.js';
import type { MeshData } from '../src/types.js';

/**
 * Every fixture must be a closed solid wound outward. This is not busywork: an
 * inside-out mesh has negative signed volume, and Manifold reads it as a void.
 * A handle wound backwards does not fail loudly -- it gets *subtracted*, carving
 * a channel into the part, and the resulting groove then shows up as a wall of
 * undercuts that look like a bug in the analysis code rather than in the fixture.
 */
describe('fixture sanity', () => {
  const solids: Array<[string, () => MeshData | Promise<MeshData>]> = [
    ['cylinder', () => cylinder()],
    ['sphere', () => sphere()],
    ['cup', () => cup()],
    ['cubeWithBoss', () => cubeWithBoss()],
    ['torus', () => torus()],
    ['handledMug', () => handledMug()],
    ['hollowSphere', () => hollowSphere()],
  ];

  for (const [name, build] of solids) {
    it(`${name} is closed and wound outward`, async () => {
      const mesh = await build();
      expect(isClosed(mesh), `${name} is not watertight`).toBe(true);
      expect(signedVolume(mesh), `${name} is inside-out`).toBeGreaterThan(0);
    });
  }

  // A faceted solid is always slightly smaller than the smooth one it approximates,
  // so these are relative-error checks rather than absolute ones -- the point is
  // that the volume is *right*, not that faceting has magically vanished.
  const withinPercent = (actual: number, expected: number, percent: number) => {
    expect(Math.abs(actual - expected) / expected).toBeLessThan(percent / 100);
  };

  it('a cylinder matches its analytic volume', () => {
    const r = 20;
    const h = 40;
    withinPercent(volume(cylinder(r, h, 128)), Math.PI * r * r * h, 0.1);
  });

  it('a sphere matches its analytic volume', () => {
    const r = 20;
    withinPercent(volume(sphere(r, 96)), (4 / 3) * Math.PI * r ** 3, 0.5);
  });

  it('adding a handle makes a mug bigger than its body', async () => {
    // The check that would have caught the reflected winding immediately: a
    // union can only add material.
    const body = cup({ radius: 32, height: 80, segments: 48 });
    const mug = await handledMug();
    expect(volume(mug)).toBeGreaterThan(volume(body));
  });

  it('hollowing a sphere makes it smaller, and leaves a void', async () => {
    const outer = 25;
    const inner = 15;
    const shell = await hollowSphere(outer, inner, 48);

    expect(volume(shell)).toBeLessThan(volume(sphere(outer, 48)));
    // The void is real: shell volume is the difference of the two spheres.
    const expected = (4 / 3) * Math.PI * (outer ** 3 - inner ** 3);
    withinPercent(volume(shell), expected, 2);
  });
});
