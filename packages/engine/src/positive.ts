/**
 * Mode A: print the part, pour plaster around it.
 *
 * This is the workflow a potter already knows -- bed the model in clay to the
 * parting line, build a cottle around it, pour one half, flip, soap, pour the
 * other -- with the worst step removed. Bedding a model in clay by hand is slow,
 * messy, and only as accurate as your thumbs, and every error in it shows up as a
 * misaligned seam on every pot the mold ever makes.
 *
 * The bed plate replaces it: a printed plate with the part's exact silhouette cut
 * through it, so the model can only sit at the parting plane, at exactly the right
 * height, every time. The registration cones are printed onto it, so the natches
 * are placed by the same geometry that placed the parting line.
 */
import type { Manifold } from 'manifold-3d';
import { manifold, Scope } from './wasm.js';
import { fromManifold, toManifoldMesh } from './mesh.js';
import type { Body, MeshData, MoldParams } from './types.js';
import type { MoldGeometry } from './mold.js';

export interface PositiveOptions {
  /** Thickness of the printed bed plate, mm. */
  plateThickness: number;
  /** Thickness of the printed cottle walls, mm. */
  cottleWall: number;
}

export async function buildPositive(
  mold: MoldGeometry,
  params: MoldParams,
  opts: PositiveOptions = { plateThickness: 6, cottleWall: 4 },
): Promise<Body[]> {
  const wasm = await manifold();
  const { Manifold: M } = wasm;
  const scope = new Scope();

  try {
    const bodies: Body[] = [];
    const emit = (
      name: string,
      mesh: MeshData,
      explode: [number, number, number],
    ) => {
      bodies.push({
        id: name.toLowerCase().replace(/\s+/g, '-'),
        name,
        category: 'printable',
        mesh,
        explode,
        printable: true,
      });
    };

    // 1. The positive itself: the part plus its pour channel, already scaled for
    //    shrinkage. This is the thing plaster is cast around.
    emit('Positive (part + spare)', mold.cavity, [0, 0, 0]);

    if (!mold.plasterUpper) {
      // A one-piece mold needs no bed plate: there is no parting line to hold.
      const cottle = scope.keep(await cottleFor(M, mold, opts, scope));
      emit('Cottle', fromManifold(cottle), [0, 0, -1]);
      return bodies;
    }

    const block = scope.keep(M.ofMesh(await toManifoldMesh(mold.block)));
    const cavity = scope.keep(M.ofMesh(await toManifoldMesh(mold.cavity)));
    const z = mold.plan.partingZ;

    // 2. The bed plate: the block's footprint at the parting plane, with the
    //    part's silhouette cut clean through it so the model drops into place and
    //    can sit nowhere else.
    const blockSection = scope.keep(block.slice(z));
    const cavitySection = scope.keep(cavity.slice(z));

    const plateProfile = scope.keep(blockSection.subtract(cavitySection));
    const plate = scope.keep(
      plateProfile.extrude(opts.plateThickness, 1, 0, [1, 1], false).translate([
        0,
        0,
        z - opts.plateThickness,
      ]),
    );

    // 3. Registration cones on the plate's upper face. They imprint sockets into
    //    the first plaster half; the second half then casts cones into those
    //    sockets, and the two halves can only ever meet one way.
    const cones: Manifold[] = [];
    for (const [x, y] of mold.plan.keyPositions) {
      const r = params.keyDiameter / 2;
      cones.push(
        scope.keep(
          M.cylinder(r * 0.9, r, r * 0.6, 32, false).translate([x, y, z]),
        ),
      );
    }

    const plateWithKeys = cones.length
      ? scope.keep(plate.add(scope.keep(M.union(cones))))
      : plate;

    emit('Parting bed plate', fromManifold(plateWithKeys), [1, 0, 0]);

    // 4. The cottle: the walls plaster is poured inside.
    const cottle = scope.keep(await cottleFor(M, mold, opts, scope));
    emit('Cottle', fromManifold(cottle), [0, 0, -1]);

    return bodies;
  } finally {
    scope.dispose();
  }
}

/**
 * The cottle: a bottomless box around the block, with a lip the bed plate sits on.
 *
 * Printed as a single ring rather than four boards. Loose boards have to be
 * clamped and clayed at every joint, and a leaking cottle at 11pm with plaster
 * going off in the bucket is a bad evening.
 */
async function cottleFor(
  M: typeof import('manifold-3d').Manifold,
  mold: MoldGeometry,
  opts: PositiveOptions,
  scope: Scope,
): Promise<Manifold> {
  const block = scope.keep(M.ofMesh(await toManifoldMesh(mold.block)));
  const box = block.boundingBox();

  const t = opts.cottleWall;
  const width = box.max[0] - box.min[0];
  const depth = box.max[1] - box.min[1];
  const height = box.max[2] - box.min[2];

  // Clearance so the printed walls actually slide over the block's drafted sides
  // instead of jamming on them.
  const gap = 0.4;

  const outer = scope.keep(
    M.cube([width + 2 * (t + gap), depth + 2 * (t + gap), height + t], false).translate([
      box.min[0] - t - gap,
      box.min[1] - t - gap,
      box.min[2] - t,
    ]),
  );

  const inner = scope.keep(
    M.cube([width + 2 * gap, depth + 2 * gap, height + t], false).translate([
      box.min[0] - gap,
      box.min[1] - gap,
      box.min[2],
    ]),
  );

  return outer.subtract(inner);
}
