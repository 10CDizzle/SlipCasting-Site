#!/usr/bin/env node
/**
 * Headless mold generation.
 *
 * The same engine the browser runs, driven from a terminal. Used by CI, by the
 * media capture script, and by anyone who wants to batch a hundred molds without
 * clicking anything.
 *
 *   slipcast cup.stl --mode shells --shrinkage 0.13 -o out/
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  bundle,
  generate,
  loadModel,
  DEFAULT_PARAMS,
  type MoldParams,
  type Unit,
} from '@slipcast/engine';

interface Options {
  input: string;
  out: string;
  params: MoldParams;
  unit: Unit;
}

const USAGE = `
slipcast -- turn a solid model into a printable slip-casting mold

  slipcast <model> [options]

  <model>                 STL, OBJ, PLY, 3MF, STEP, or IGES

Options
  -o, --out <dir>         Output directory                    (default: ./out)
  --mode <shells|positive>
                          shells:   print trays, pour plaster IN  (default)
                          positive: print the part, pour plaster AROUND it
  --shrinkage <n>         Total clay shrinkage, 0-1               (default: 0.13)
  --wall <mm>             Plaster thickness around the part       (default: 25)
  --min-draft <deg>       Draft below which a face is flagged     (default: 2)
  --keys <n>              Registration keys on the parting face   (default: 4)
  --no-split              One-piece open mold
  --units <mm|cm|m|in>    Units of the input file                 (default: mm)
  -h, --help
`;

function parseArgs(argv: string[]): Options | null {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) return null;

  const params: MoldParams = { ...DEFAULT_PARAMS };
  let input = '';
  let out = 'out';
  let unit: Unit = 'mm';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => argv[++i]!;

    switch (arg) {
      case '-o':
      case '--out':
        out = next();
        break;
      case '--mode':
        params.mode = next() as MoldParams['mode'];
        break;
      case '--shrinkage':
        params.shrinkage = Number(next());
        break;
      case '--wall':
        params.wallThickness = Number(next());
        break;
      case '--min-draft':
        params.minDraft = Number(next());
        break;
      case '--keys':
        params.keyCount = Number(next());
        break;
      case '--no-split':
        params.split = false;
        break;
      case '--units':
        unit = next() as Unit;
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}`);
        input = arg;
    }
  }

  if (!input) return null;
  return { input, out, params, unit };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    console.log(USAGE);
    process.exit(process.argv.length > 2 ? 0 : 1);
  }

  const bytes = new Uint8Array(await readFile(opts.input));
  const loaded = await loadModel(basename(opts.input), bytes, opts.unit);

  if (loaded.unitWarning) console.warn(`warning: ${loaded.unitWarning}`);

  console.log(`Generating a ${opts.params.mode} mold from ${basename(opts.input)}...`);

  const result = await generate(loaded.mesh, opts.params);

  await mkdir(opts.out, { recursive: true });
  await writeFile(join(opts.out, 'slipcast-mold.zip'), bundle(result));
  await writeFile(join(opts.out, 'INSTRUCTIONS.md'), result.instructions);

  const [x, y, z] = result.mold.plan.pullDirection;
  console.log(`\n  Pull direction   ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`);
  console.log(`  Plaster          ${(result.mold.volumes.plaster / 1e6).toFixed(2)} L`);
  console.log(`  Pieces to print  ${result.bodies.filter((b) => b.printable).length}`);

  for (const warning of result.warnings) console.log(`  ! ${warning}`);

  console.log(`\nWrote ${join(opts.out, 'slipcast-mold.zip')}`);
}

main().catch((err: Error) => {
  // A refusal is a legitimate outcome here, not a crash: some parts genuinely
  // cannot be molded, and saying so is the whole point.
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
