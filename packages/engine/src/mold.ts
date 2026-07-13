/**
 * The pipeline: a repaired part in, mold geometry out.
 *
 * Order matters and is not arbitrary. Shrinkage is applied first, because every
 * dimension downstream -- cavity, block, keys, spare -- has to be in the scaled
 * world. Then the part is rotated so the pull axis is +Z, which lets every later
 * module speak in plain "up" and "down" instead of carrying a direction vector
 * around. The mold is built in that frame and rotated back at the very end.
 */
import * as THREE from 'three';
import type { Manifold } from 'manifold-3d';
import { manifold, Scope } from './wasm.js';
import {
  findPartingPlane,
  findPullDirections,
  moldabilityAt,
  moldFrame,
  rotateVec,
  transformMesh,
} from './analysis.js';
import { moldBlock } from './block.js';
import { spareSolid } from './spare.js';
import { registrationKeys } from './keys.js';
import { splitAtZ } from './split.js';
import { boundingBox, fromManifold, toManifoldMesh, volume } from './mesh.js';
import type { DraftAnalysis, MeshData, MoldParams, Vec3 } from './types.js';

export interface MoldPlan {
  /** The part, scaled for shrinkage and rotated into the mold frame. */
  master: MeshData;
  /** The axis the mold OPENS along, in the original frame. */
  pullDirection: Vec3;
  /** The axis the mold is FILLED along -- which way is up on the bench. Original frame. */
  pourDirection: Vec3;
  /** The pour axis expressed in the mold frame. Always in the XZ plane. */
  pourInFrame: Vec3;
  /** Height of the parting plane along +Z, in the mold frame. */
  partingZ: number;
  analysis: DraftAnalysis;
  /** Where each key landed on the parting face. */
  keyPositions: Array<[number, number]>;
  /** Rotation from the original frame into the mold frame. */
  alignment: THREE.Matrix4;
}

export interface MoldGeometry {
  plan: MoldPlan;
  /** The scaled part fused with the spare: the void in the finished plaster. */
  cavity: MeshData;
  /** The plaster, before it is cut. */
  block: MeshData;
  /** The plaster halves, keyed. `lower` is the whole mold when not split. */
  plasterUpper: MeshData | null;
  plasterLower: MeshData;
  /** Volumes in mm^3, for the plaster and slip calculator. */
  volumes: {
    part: number;
    cavity: number;
    block: number;
    plaster: number;
  };
}

/**
 * Scale for shrinkage.
 *
 * Clay shrinks as it dries and again as it fires, so the mold must be cut OVER
 * size by exactly the amount the finished piece will lose. 13% shrinkage means
 * the fired pot is 87% of the mold, so the mold is 1/0.87 = 1.149x the drawing --
 * not 1.13x, which is the mistake that produces pots a size too small.
 */
export function shrinkageScale(shrinkage: number): number {
  if (shrinkage < 0 || shrinkage >= 1) {
    throw new Error(`shrinkage must be between 0 and 1, got ${shrinkage}`);
  }
  return 1 / (1 - shrinkage);
}

export function scaleMesh(data: MeshData, factor: number): MeshData {
  const positions = new Float32Array(data.positions.length);
  for (let i = 0; i < data.positions.length; i++) {
    positions[i] = data.positions[i]! * factor;
  }
  return { positions, indices: new Uint32Array(data.indices) };
}

/** Work out both axes, the parting height, and the scaled master in the mold frame. */
export function planMold(
  part: MeshData,
  params: MoldParams,
  pullOverride?: Vec3,
): MoldPlan {
  const scaled = scaleMesh(part, shrinkageScale(params.shrinkage));

  const pullDirection =
    pullOverride ?? findPullDirections(scaled, { minDraft: params.minDraft })[0]!.direction;

  // Which way is up on the bench. People model pots standing upright, so the part's
  // own +Z is the right default -- and it is a completely separate question from
  // which way the mold comes apart.
  const pourDirection: Vec3 = params.pourDirection ?? [0, 0, 1];

  const alignment = moldFrame(pullDirection, pourDirection);
  const master = transformMesh(scaled, alignment);
  const pourInFrame = rotateVec(pourDirection, alignment);

  // The parting plane is chosen the same way whether or not the mold is split. For a
  // one-piece mold it is the mold's open MOUTH -- the block is cut off there, and the
  // part lifts straight out. Putting it at the top of the part instead would seal the
  // part inside a closed box, which is not a mold, it is a paperweight.
  const partingZ = findPartingPlane(master, [0, 0, 1], {
    minDraft: params.minDraft,
    split: params.split,
  });

  // Judged against the plane we are actually going to cut, not merely against the
  // poles of the pull axis.
  const analysis = moldabilityAt(master, [0, 0, 1], partingZ, params.minDraft, params.split);

  return {
    master,
    pullDirection,
    pourDirection,
    pourInFrame,
    partingZ,
    analysis,
    keyPositions: [],
    alignment,
  };
}

/**
 * Build the mold.
 *
 * Throws if the part has undercuts: there is no such thing as a mold that
 * *mostly* comes off, and producing geometry anyway would hand someone a
 * confident-looking file for a part that cannot be cast.
 */
export async function buildMold(part: MeshData, params: MoldParams, pullOverride?: Vec3): Promise<MoldGeometry> {
  const plan = planMold(part, params, pullOverride);

  if (!plan.analysis.moldable) {
    throw new Error(
      `This part has undercuts along every usable axis (${plan.analysis.area.undercut.toFixed(0)} mm² ` +
        'of surface is trapped). A two-part mold physically cannot release it. ' +
        'Try a different pull direction, or split the part into pieces that can each be cast.',
    );
  }

  const wasm = await manifold();
  const { Manifold: M } = wasm;
  const scope = new Scope();

  try {
    const master = scope.keep(M.ofMesh(await toManifoldMesh(plan.master)));

    let block = scope.keep(await moldBlock(master, plan.master, {
      wallThickness: params.wallThickness,
      style: params.blockStyle,
      outerDraft: params.outerDraft,
    }));

    if (!params.split) {
      // A one-piece mold is OPEN at the parting plane. Trim the block there, or the
      // part is sealed under a plaster lid and can never come out -- which is exactly
      // what the engine used to build, and used to call moldable.
      block = scope.keep(block.trimByPlane([0, 0, -1], -plan.partingZ));
    }

    const blockBox = block.boundingBox();

    const spare = scope.keep(
      await spareSolid(plan.master, blockBox, {
        diameter: params.spareDiameter,
        height: params.spareHeight,
        pour: plan.pourInFrame,
        position: params.sparePosition,
      }),
    );

    // The cavity is the part AND its pour channel: both are voids in the plaster.
    const cavity = scope.keep(master.add(spare));

    // Guard the failure that would otherwise ship silently: if the spare misses
    // the part, the mold has a pour hole that dead-ends and a cavity sealed
    // inside solid plaster. It looks perfect until you try to use it.
    const junction = scope.keep(master.intersect(spare));
    if (junction.isEmpty() || junction.volume() <= 0) {
      throw new Error('The spare does not reach the part; the cavity would be sealed inside the plaster.');
    }

    const plaster = scope.keep(block.subtract(cavity));

    let plasterUpper: MeshData | null = null;
    let plasterLower: MeshData;
    let keyPositions: Array<[number, number]> = [];

    if (params.split) {
      const halves = splitAtZ(plaster, plan.partingZ);
      scope.keep(halves.upper);
      scope.keep(halves.lower);

      const blockSection = scope.keep(block.slice(plan.partingZ));
      const cavitySection = scope.keep(cavity.slice(plan.partingZ));

      const keys = await registrationKeys(blockSection, cavitySection, plan.partingZ, {
        count: params.keyCount,
        diameter: params.keyDiameter,
        clearance: params.keyClearance,
      });
      keyPositions = keys.positions;

      let upper = halves.upper;
      let lower = halves.lower;

      if (keys.males && keys.females) {
        scope.keep(keys.males);
        scope.keep(keys.females);
        // Cones stand proud of the lower half; sockets are cut from the upper.
        lower = scope.keep(lower.add(keys.males));
        upper = scope.keep(upper.subtract(keys.females));
      }

      plasterUpper = fromManifold(upper);
      plasterLower = fromManifold(lower);
    } else {
      plasterLower = fromManifold(plaster);
    }

    return {
      plan: { ...plan, keyPositions },
      cavity: fromManifold(cavity),
      block: fromManifold(block),
      plasterUpper,
      plasterLower,
      volumes: {
        part: master.volume(),
        cavity: cavity.volume(),
        block: block.volume(),
        plaster: plaster.volume(),
      },
    };
  } finally {
    scope.dispose();
  }
}

/** Volume of a mesh, re-exported so callers need not reach into mesh.ts. */
export { volume };
