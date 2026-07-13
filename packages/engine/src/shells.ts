/**
 * Mode B: print the trays, pour plaster into them.
 *
 * A tray is simply the negative of a plaster half: a box with the plaster's shape
 * hollowed out of it, open on one face so you can pour. The part shows up as a
 * raised core on the tray's floor and the plaster sets around it.
 *
 * The one idea that makes this work is which way up each half is cast. Both are
 * poured with their PARTING FACE DOWN, against the flat floor of the tray. That
 * face is the one that has to be dead flat and precisely keyed, and forming it
 * against printed plastic gets you that for free -- no bedding a model in clay, no
 * screeding the critical face, no carving natches with a coin.
 *
 * The lower half therefore has to be flipped before its tray is cut, because its
 * parting face points up in the mold's own frame. Miss that and its registration
 * cones are simply sliced off by the pour opening, and the halves have nothing to
 * locate on.
 */
import type { Manifold } from 'manifold-3d';
import { manifold, Scope } from './wasm.js';
import { fromManifold, toManifoldMesh } from './mesh.js';
import type { Body, MeshData, MoldParams } from './types.js';
import type { MoldGeometry } from './mold.js';

export interface ShellOptions {
  /** Printed wall thickness of the tray, mm. */
  wall: number;
}

/**
 * Cut a tray around one plaster half.
 *
 * `plaster` must already be oriented with its parting face down. The tray is open
 * at +Z: that opening is where you pour, and the plaster's top face becomes the
 * back of the mold half.
 */
function trayFor(
  M: typeof import('manifold-3d').Manifold,
  plaster: Manifold,
  wall: number,
  scope: Scope,
): Manifold {
  const box = plaster.boundingBox();

  const width = box.max[0] - box.min[0] + wall * 2;
  const depth = box.max[1] - box.min[1] + wall * 2;
  // Floor below, walls up to the pour opening -- and no lid.
  const height = box.max[2] - box.min[2] + wall;

  const shell = scope.keep(
    M.cube([width, depth, height], false).translate([
      box.min[0] - wall,
      box.min[1] - wall,
      box.min[2] - wall,
    ]),
  );

  // Hollow it out with the plaster itself. What is left is the tray: floor, walls,
  // and the part standing proud in the middle as a core.
  return shell.subtract(plaster);
}

/** Mirror a solid about the plane z = `z`, so its parting face ends up down. */
function flipAboutZ(solid: Manifold, z: number): Manifold {
  return solid.translate([0, 0, -z]).mirror([0, 0, 1]).translate([0, 0, z]);
}

export async function buildShells(
  mold: MoldGeometry,
  params: MoldParams,
): Promise<Body[]> {
  const wasm = await manifold();
  const { Manifold: M } = wasm;
  const scope = new Scope();

  try {
    const bodies: Body[] = [];
    const wall = params.shellWall;

    const emit = (name: string, mesh: MeshData, explode: [number, number, number]) => {
      bodies.push({
        id: name.toLowerCase().replace(/\s+/g, '-'),
        name,
        category: 'printable',
        mesh,
        explode,
        printable: true,
      });
    };

    if (mold.plasterUpper) {
      // The upper half's parting face is already its underside: it can be poured
      // as-is. Its sockets become bumps on the tray floor, and the spare runs out
      // through the open top as a rod, which is what forms the pour hole.
      const upper = scope.keep(M.ofMesh(await toManifoldMesh(mold.plasterUpper)));
      const tray = scope.keep(trayFor(M, upper, wall, scope));
      emit('Tray A (upper half)', fromManifold(tray), [0, 0, 1]);

      // The lower half is upside down for casting purposes. Flip it about the
      // parting plane so that face lands on the tray floor -- otherwise its
      // registration cones stick out of the pour opening and get screeded off.
      const lowerRaw = scope.keep(M.ofMesh(await toManifoldMesh(mold.plasterLower)));
      const lower = scope.keep(flipAboutZ(lowerRaw, mold.plan.partingZ));
      const trayB = scope.keep(trayFor(M, lower, wall, scope));
      emit('Tray B (lower half)', fromManifold(trayB), [0, 0, -1]);
    } else {
      // One-piece mold: a single open tray, cast the same way.
      const solid = scope.keep(M.ofMesh(await toManifoldMesh(mold.plasterLower)));
      const tray = scope.keep(trayFor(M, solid, wall, scope));
      emit('Tray (one-piece mold)', fromManifold(tray), [0, 0, -1]);
    }

    return bodies;
  } finally {
    scope.dispose();
  }
}
