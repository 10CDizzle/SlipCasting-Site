# Architecture

## There is no server

The entire geometry engine runs in your browser. Nothing is uploaded.

That is not a limitation dressed up as a virtue. It is why you can drop a proprietary
part file into this tool, and it is why the whole thing hosts free on GitHub Pages
forever, with no cold start and no bill.

```
packages/
  engine/   Pure TypeScript geometry. No DOM, no React. Runs in the browser AND in Node.
  app/      React + Vite. The Onshape-style workspace. Ships as static files.
  cli/      The same engine, from a terminal.
```

The engine being plain TypeScript with no browser dependencies is the load-bearing
decision: **the test suite exercises the exact code the browser runs.** There is no
second implementation to drift.

## The WASM

| Module | What it does | Size |
|---|---|---|
| `manifold-3d` | The boolean kernel. Every union, difference and split. | 541 KB (206 KB gzipped) |
| `three-mesh-bvh` | Ray casting for the undercut tests. Pure JS. | — |
| `occt-import-js` | OpenCascade, for STEP and IGES. **Lazily loaded** — it only downloads if you actually drop a STEP file. | ~10 MB |

Manifold's WASM build is **single-threaded**, and that is precisely what makes free
static hosting possible. Threaded WASM needs `SharedArrayBuffer`, which needs COOP and
COEP response headers, which GitHub Pages **cannot set**. Staying serial costs some
speed on very heavy meshes and buys free hosting forever.

## The worker

The engine runs in a Web Worker. A boolean on a heavy part takes seconds; on the main
thread the viewport would freeze mid-drag, and in a CAD tool that reads as *broken*
long before it reads as *busy*.

Meshes cross the boundary as transferable `ArrayBuffer`s — copying a few hundred
thousand triangles per keystroke would undo the point of having a worker at all.

## The document model

A document is a **short JSON list of features**, each an operation with declared inputs
and outputs.

```jsonc
{ "features": [
  { "id": "f1", "type": "import",  "params": { "fileId": "…", "units": "mm" } },
  { "id": "f2", "type": "shrink",  "params": { "shrinkage": 0.13 } },
  { "id": "f3", "type": "pullDir", "params": { "mode": "auto" } },
  { "id": "f4", "type": "block",   "params": { "wallThickness": 25 } }
]}
```

That single decision is what makes the CAD interface affordable:

- **The Feature List** is just the array.
- **The Rollback Bar** evaluates a prefix of it.
- **Reordering** is a topological check over each feature's `consumes` and `produces`.
  Drag `split` above `block` and the engine sees it wants a body nothing has produced
  yet, marks it red, and rolls the failure downstream — exactly as Onshape does. It
  does not *refuse* the drag; it shows you what broke.
- **Merging two versions** is a three-way diff over a small JSON array — not a
  reconciliation of two solid models, which nobody knows how to do.

## The regen cache

Every prefix of the feature list is hashed by content. Scrubbing the Rollback Bar or
dragging a slider replays states that have already been computed, instead of re-running
booleans on every frame.

Renaming a feature does **not** invalidate the cache: a label is not geometry.

A feature list in error serves **no** geometry rather than the last good result. The
user has to see that the screen no longer matches what they asked for.

## Persistence

IndexedDB, via Dexie. Documents, feature trees, version graphs and source meshes all
live in the browser. No accounts, no database. Survives a restart; per-browser.
