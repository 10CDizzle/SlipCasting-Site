/** Write a fixture part to disk, so the CLI and the e2e run have something to chew on. */
import { writeFile } from 'node:fs/promises';
import { fixtures, toSTL } from '@slipcast/engine';

const which = process.argv[2] ?? 'cup';
const out = process.argv[3] ?? `${which}.stl`;

const builders: Record<string, () => Promise<Float32Array | unknown> | unknown> = {
  cup: () => fixtures.cup(),
  mug: () => fixtures.handledMug(),
  cylinder: () => fixtures.cylinder(),
  sphere: () => fixtures.sphere(),
  torus: () => fixtures.torus(),
};

const build = builders[which];
if (!build) throw new Error(`Unknown fixture "${which}". Try: ${Object.keys(builders).join(', ')}`);

const mesh = (await build()) as { positions: Float32Array; indices: Uint32Array };
await writeFile(out, toSTL(mesh));
console.log(`Wrote ${out}`);
