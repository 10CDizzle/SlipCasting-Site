/**
 * The vocabulary of the engine. Kept free of Manifold and three.js types so the
 * app, the worker boundary, and the CLI can all speak it without pulling WASM in.
 */

/** A plain triangle mesh. The interchange format at every engine boundary. */
export interface MeshData {
  /** Flat xyz triples. */
  positions: Float32Array;
  /** Flat triangle indices into `positions`. */
  indices: Uint32Array;
}

export type Vec3 = [number, number, number];

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** Millimetres are the engine's internal unit, always. */
export type Unit = 'mm' | 'cm' | 'm' | 'in';

export const UNIT_TO_MM: Record<Unit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

/** How a face behaves with respect to the chosen pull direction. */
export type FaceClass =
  /** Pulls cleanly: draft angle at or above the minimum. */
  | 'ok'
  /** Releases, but with less draft than asked for -- it will drag on the plaster. */
  | 'shallow'
  /** Occluded along its pull direction. The part cannot be molded as-is. */
  | 'undercut';

export interface DraftAnalysis {
  /** One class per triangle, index-aligned with the mesh's triangles. */
  faceClass: Uint8Array;
  /** Surface area in mm^2 per class. */
  area: Record<FaceClass, number>;
  /** True when nothing is undercut -- i.e. this part can actually be molded. */
  moldable: boolean;
}

export interface PullCandidate {
  direction: Vec3;
  /** Undercut area in mm^2. Lower is better; 0 means moldable. */
  undercutArea: number;
  /** Mold block volume in mm^3 for this direction. Tie-breaker: less plaster. */
  blockVolume: number;
  score: number;
}

/** The two physical workflows the app supports. See docs/workflows.md. */
export type OutputMode =
  /** Print the part; pour plaster around it in a printed cottle. */
  | 'positive'
  /** Print trays; pour plaster into them. Better for batching molds. */
  | 'shells';

export interface MoldParams {
  /** Total linear clay shrinkage, drying + firing. 0.13 = 13%. */
  shrinkage: number;
  /** Plaster wall thickness around the part, mm. */
  wallThickness: number;
  /** Minimum acceptable draft angle, degrees. Faces below this are 'shallow'. */
  minDraft: number;
  /** Draft on the mold block's outer walls so printed shells release, degrees. */
  outerDraft: number;
  /** Bounding block, or a hull offset that hugs the part and saves plaster. */
  blockStyle: 'box' | 'conformal';
  /** Split the mold in two, or leave it open (drain-cast bowls need no split). */
  split: boolean;
  /** Registration keys on the parting face. */
  keyCount: number;
  keyDiameter: number;
  /** Gap between male and female keys so the halves actually seat, mm. */
  keyClearance: number;
  /** Pour reservoir. */
  spareDiameter: number;
  spareHeight: number;
  /**
   * Where the pour channel meets the part: a point on the model, in the mold frame.
   *
   * A point, not a pair of coordinates, because a point is what a click gives you.
   * Only its component across the pour axis is used -- the channel then comes down
   * that axis onto the part.
   *
   * Null means "wherever the part is highest, measured up the POUR axis", which is
   * the rim of a cup or a mug. A teapot might want it on the foot instead.
   */
  sparePosition: Vec3 | null;
  /**
   * Which way is UP when the mold stands on the bench being filled.
   *
   * This is NOT the pull axis, and conflating the two is a mistake with real
   * consequences. A mug's mold OPENS horizontally -- the halves come apart through
   * the handle -- but it STANDS UPRIGHT and is filled from the rim. Assume the pour
   * hole belongs at the top of the pull axis and you put the spare on the side of
   * the mug, where slip would simply run out onto the floor.
   *
   * Null means "use the part's own +Z", which is right almost always, because people
   * model pots standing up.
   */
  pourDirection: Vec3 | null;
  /** Printed shell wall thickness (mode 'shells' only), mm. */
  shellWall: number;
  mode: OutputMode;
}

export const DEFAULT_PARAMS: MoldParams = {
  // ShapeCast's default, and a fair middle for stoneware/porcelain (10-15%).
  shrinkage: 0.13,
  wallThickness: 25,
  minDraft: 2,
  outerDraft: 2,
  blockStyle: 'box',
  split: true,
  keyCount: 4,
  keyDiameter: 12,
  keyClearance: 0.3,
  spareDiameter: 30,
  spareHeight: 40,
  sparePosition: null,
  pourDirection: null,
  shellWall: 3,
  mode: 'shells',
};

/** A named solid the user can see, hide, and export. */
export interface Body {
  id: string;
  name: string;
  category: 'part' | 'plaster' | 'printable';
  mesh: MeshData;
  /** Direction to shift this body in the exploded view. */
  explode: Vec3;
  /** Whether this body is meant to be 3D printed. */
  printable: boolean;
}
