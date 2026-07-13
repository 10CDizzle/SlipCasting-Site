# Development

**Everything runs in Docker.** Nothing is installed on your machine — no Node, no
toolchain, no browsers.

## First run

```bash
docker compose run --rm dev npm install
```

## Day to day

```bash
# Vite with hot reload, on http://localhost:5173
docker compose up dev

# The headless geometry suite. No browser, no GUI, no human.
docker compose -f docker-compose.test.yml run --rm test

# End-to-end, in headless Chromium, against the real built app
docker compose -f docker-compose.test.yml run --rm e2e

# A shell in the toolchain
docker compose run --rm dev bash
```

## The CLI

The same engine, without a browser. Useful for batching.

```bash
# Make a test part
docker compose run --rm dev npm run fixture --workspace @slipcast/cli -- cup /tmp/cup.stl

# Generate a mold from it
docker compose run --rm dev npm run cli -- /tmp/cup.stl --mode shells -o /tmp/out
```

```
slipcast <model> [options]

  -o, --out <dir>          Output directory                  (default: ./out)
  --mode <shells|positive>
  --shrinkage <n>          Total clay shrinkage, 0-1         (default: 0.13)
  --wall <mm>              Plaster thickness                 (default: 25)
  --min-draft <deg>        Draft below which faces are flagged
  --keys <n>               Registration keys
  --no-split               One-piece open mold
  --units <mm|cm|m|in>
```

## Self-hosting

The same static bundle GitHub Pages serves, behind nginx. Useful in a studio with no
internet.

```bash
docker compose --profile selfhost up selfhost   # http://localhost:8080
```

## Regenerating the README media

The screenshots and the GIF are **captured from the real app**, by driving it in
headless Chromium. They cannot drift away from the product, and they cannot depict a
workflow that does not work: if the capture run cannot complete the flow, it fails and
there are no images.

```bash
docker compose -f docker-compose.test.yml run --rm -e CAPTURE=1 e2e \
  sh -c 'cd packages/app && npx playwright test capture-media'

docker compose run --rm dev npx tsx scripts/assemble-gif.ts
```

## Where the tests live

| Suite | What it proves |
|---|---|
| `packages/engine/test/` | The geometry invariants: volume conservation, watertightness, undercut detection, the mug parting through its handle. **This is the suite that matters.** |
| `packages/app/e2e/` | The real app in a real browser: WASM loads, the worker generates, the STLs in the ZIP are printable. |

## Repo layout

```
packages/engine/src/
  io.ts          importers            repair.ts     the tiered heal
  analysis.ts    undercuts + pull     block.ts      the plaster body
  spare.ts       pour channel         keys.ts       natches
  split.ts       the golden test      mold.ts       the pipeline
  shells.ts      workflow B           positive.ts   workflow A
  report.ts      plaster + slip       exporters.ts  STL / 3MF / GLB / ZIP
  features.ts    the document         regen.ts      the prefix cache
  versions.ts    branch + merge       fixtures.ts   test parts
```
