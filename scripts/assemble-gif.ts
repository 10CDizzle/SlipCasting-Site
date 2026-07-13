/**
 * Stitches the frames captured from the real app into the README's GIF.
 *
 * Run after the capture spec:
 *   docker compose -f docker-compose.test.yml run --rm -e CAPTURE=1 e2e \
 *     sh -c 'cd packages/app && npx playwright test capture-media'
 *   docker compose run --rm dev npx tsx scripts/assemble-gif.ts
 */
import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
// gifenc ships a CommonJS default export, not named ESM exports.
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;

const MEDIA = join(process.cwd(), 'docs/media');
const FRAMES = join(MEDIA, 'frames');
const OUT = join(MEDIA, 'explode.gif');

/** Box-filter downscale. GitHub renders the GIF at about 800px; anything more is bytes for nothing. */
function downscale(png: PNG, targetWidth: number): { data: Uint8Array; width: number; height: number } {
  const factor = Math.max(1, Math.round(png.width / targetWidth));
  const width = Math.floor(png.width / factor);
  const height = Math.floor(png.height / factor);
  const out = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const sx = x * factor + dx;
          const sy = y * factor + dy;
          if (sx >= png.width || sy >= png.height) continue;
          const i = (sy * png.width + sx) * 4;
          r += png.data[i]!;
          g += png.data[i + 1]!;
          b += png.data[i + 2]!;
          n++;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
}

const files = (await readdir(FRAMES)).filter((f) => f.endsWith('.png')).sort();
if (files.length === 0) throw new Error('No frames. Run the capture spec first.');

const encoder = GIFEncoder();
let size = { width: 0, height: 0 };

for (const [i, file] of files.entries()) {
  const png = PNG.sync.read(await readFile(join(FRAMES, file)));
  const frame = downscale(png, 760);
  size = { width: frame.width, height: frame.height };

  // A shared palette per frame keeps the dark CAD chrome from banding.
  const palette = quantize(frame.data, 128, { format: 'rgb565' });
  const indexed = applyPalette(frame.data, palette, 'rgb565');

  encoder.writeFrame(indexed, frame.width, frame.height, {
    palette,
    delay: i === 0 || i === files.length - 1 ? 500 : 60,
  });
}

encoder.finish();
const bytes = encoder.bytes();

await writeFile(OUT, bytes);
await rm(FRAMES, { recursive: true, force: true });

console.log(
  `Wrote ${OUT} -- ${size.width}x${size.height}, ${files.length} frames, ${(bytes.length / 1024 / 1024).toFixed(2)} MB`,
);
