/**
 * The numbers you actually need at the bench: how much plaster to mix, how much
 * water to mix it with, how much slip to have ready, and whether the printed
 * pieces will fit on your printer.
 *
 * Plaster is mixed by WEIGHT, to a ratio called the consistency: parts water per
 * 100 parts plaster. Pottery plaster is normally run at 70. Eyeballing it gives a
 * mold that is either too soft to survive demolding or too dense to absorb water,
 * and an under-absorbent mold simply will not cast -- so this converts the
 * geometry into a scale reading rather than leaving it as a volume.
 */
import type { MeshData, MoldParams, OutputMode } from './types.js';
import { boundingBox, boxSize } from './mesh.js';

/** Specific gravity of gypsum plaster powder. */
const PLASTER_SG = 2.32;
/** Typical casting slip, g/cm^3. */
const SLIP_DENSITY = 1.75;

export interface PlasterMix {
  /** Volume of set plaster, litres. */
  volumeLitres: number;
  /** Dry plaster to weigh out, kg. */
  plasterKg: number;
  /** Water to measure, litres. */
  waterLitres: number;
  /** Parts water per 100 parts plaster, by weight. */
  consistency: number;
}

/**
 * Convert a mold volume into a plaster recipe.
 *
 * One kilogram of plaster displaces 1/2.32 = 0.431 litres, and at consistency C
 * it is mixed with C/100 litres of water. Set plaster keeps essentially the
 * slurry's volume, so a litre of mold needs 1 / (0.431 + C/100) kg of plaster.
 * A 10% excess is added, because a mold short of plaster is scrap and the
 * leftover costs pennies.
 */
export function plasterMix(volumeMm3: number, consistency = 70): PlasterMix {
  const litres = (volumeMm3 / 1e6) * 1.1;
  const litresPerKg = 1 / PLASTER_SG + consistency / 100;
  const plasterKg = litres / litresPerKg;
  const waterLitres = plasterKg * (consistency / 100);

  return {
    volumeLitres: litres,
    plasterKg,
    waterLitres,
    consistency,
  };
}

export interface SlipEstimate {
  /** Slip needed to fill the cavity and the spare, litres. */
  fillLitres: number;
  /** Wet weight of a solid cast, kg -- the upper bound. */
  solidKg: number;
  /** Wet weight of a drained cast at the given wall thickness, kg. */
  drainedKg: number;
}

/**
 * How much slip to have mixed before you start.
 *
 * A drain cast is poured full, left until the plaster has drawn a wall of the
 * thickness you want, then tipped out -- so you need enough to fill the whole
 * cavity even though most of it comes back.
 */
export function slipEstimate(
  cavityMm3: number,
  surfaceAreaMm2: number,
  wallThicknessMm: number,
): SlipEstimate {
  const fillLitres = cavityMm3 / 1e6;
  const solidKg = (cavityMm3 / 1000) * (SLIP_DENSITY / 1000);

  // A drained cast is a shell: its volume is roughly the wetted area times the
  // wall thickness, capped at the solid volume for parts too thin to hollow.
  const shellMm3 = Math.min(cavityMm3, surfaceAreaMm2 * wallThicknessMm);
  const drainedKg = (shellMm3 / 1000) * (SLIP_DENSITY / 1000);

  return { fillLitres, solidKg, drainedKg };
}

export interface BedCheck {
  name: string;
  size: [number, number, number];
  fits: boolean;
}

/** Common print beds, so "will this fit?" is answered before the slicer says no. */
export const PRINT_BEDS: Record<string, [number, number, number]> = {
  'Bambu X1C / P1S': [256, 256, 256],
  'Prusa MK4': [250, 210, 220],
  'Ender 3': [220, 220, 250],
  'Prusa XL': [360, 360, 360],
};

export function checkBed(mesh: MeshData, bed: [number, number, number]): BedCheck {
  const size = boxSize(boundingBox(mesh));
  // Allow the part to be laid down either way round on the bed.
  const footprint = [size[0], size[1]].sort((a, b) => a - b);
  const bedFootprint = [bed[0], bed[1]].sort((a, b) => a - b);

  const fits =
    footprint[0]! <= bedFootprint[0]! &&
    footprint[1]! <= bedFootprint[1]! &&
    size[2] <= bed[2];

  return { name: '', size, fits };
}

export interface ReportInput {
  mode: OutputMode;
  params: MoldParams;
  plasterMm3: number;
  cavityMm3: number;
  cavityAreaMm2: number;
  pieces: Array<{ name: string; mesh: MeshData; printable: boolean }>;
  warnings: string[];
}

/** The INSTRUCTIONS.md that ships inside the download. */
export function instructions(input: ReportInput): string {
  const mix = plasterMix(input.plasterMm3);
  const slip = slipEstimate(input.cavityMm3, input.cavityAreaMm2, 4);
  const shrinkPct = (input.params.shrinkage * 100).toFixed(1);
  const scale = 1 / (1 - input.params.shrinkage);

  const printable = input.pieces.filter((p) => p.printable);

  const bedRows = Object.entries(PRINT_BEDS).map(([name, bed]) => {
    const allFit = printable.every((p) => checkBed(p.mesh, bed).fits);
    return `| ${name} | ${bed[0]}x${bed[1]}x${bed[2]} | ${allFit ? 'Yes' : 'No -- too large'} |`;
  });

  const pieceRows = printable.map((p) => {
    const s = boxSize(boundingBox(p.mesh));
    return `| ${p.name} | ${s[0].toFixed(0)} x ${s[1].toFixed(0)} x ${s[2].toFixed(0)} mm |`;
  });

  const steps =
    input.mode === 'positive' ? positiveSteps(mix) : shellSteps(mix);

  return `# Slip-cast mold

Generated by SlipCast. Every dimension below is already scaled for clay shrinkage.

## Before you print

The model has been enlarged by **${((scale - 1) * 100).toFixed(1)}%** so that after
**${shrinkPct}%** total shrinkage (drying plus firing) the fired piece comes out at the
size you designed.

If your clay body's shrinkage is not ${shrinkPct}%, regenerate with the right figure.
Getting this wrong does not fail loudly -- it just gives you pots that are quietly
the wrong size, and you will not find out until they come out of the kiln.

## Pieces to print

| Piece | Size |
|---|---|
${pieceRows.join('\n')}

| Printer | Bed | All pieces fit? |
|---|---|---|
${bedRows.join('\n')}

Print in PLA or PETG. Plaster gets warm as it sets -- around 40 C -- which is
survivable for PLA but do not leave a mold curing in a hot car.

## Plaster

| | |
|---|---|
| Set plaster volume | **${mix.volumeLitres.toFixed(2)} L** (includes 10% excess) |
| Dry plaster | **${mix.plasterKg.toFixed(2)} kg** |
| Water | **${mix.waterLitres.toFixed(2)} L** |
| Consistency | ${mix.consistency} parts water : 100 parts plaster, by weight |

Weigh both. Do not judge plaster by eye: too little water and the mold is too dense
to draw water out of the slip, which means it will not cast at all.

Sift the plaster into the water, let it slake for 2-3 minutes, then mix.

${steps}

## Slip

| | |
|---|---|
| To fill the mold | **${slip.fillLitres.toFixed(2)} L** |
| Drained cast, 4 mm wall | ~${(slip.drainedKg * 1000).toFixed(0)} g wet |
| Solid cast | ~${(slip.solidKg * 1000).toFixed(0)} g wet |

Pour full, wait for the wall to build to the thickness you want, then tip the
mold out and let it drain. Thicker walls take longer; check the spare, because the
level dropping is the plaster drinking.

A new plaster mold is wet. Let it dry thoroughly -- days, not hours -- before the
first cast, or it will not absorb.
${input.warnings.length ? `\n## Warnings\n\n${input.warnings.map((w) => `- ${w}`).join('\n')}\n` : ''}`;
}

function positiveSteps(mix: PlasterMix): string {
  return `## Making the mold: printed positive

You print the **part**, and pour plaster **around** it.

1. Print the positive, the parting bed plate, and the cottle walls.
2. Seat the positive through the hole in the bed plate. The plate is the parting
   plane -- it replaces bedding the model in clay by hand, which is the fiddly,
   inaccurate step this is designed to remove.
3. Assemble the cottle walls around the bed plate and seal the joints with clay so
   plaster cannot weep out.
4. Coat every surface plaster will touch -- the print, the plate, the walls -- with
   mold soap or a thin smear of petroleum jelly. Skip this and the plaster keys
   into the print and neither survives separation.
5. Mix ${mix.plasterKg.toFixed(2)} kg of plaster into ${mix.waterLitres.toFixed(2)} L of
   water and pour to fill the upper half. Tap the walls to bring air bubbles up.
6. Wait until it is hard and has stopped feeling warm -- around 45 minutes.
7. Flip the whole assembly, remove the bed plate. The cones it left behind are the
   registration keys.
8. Soap the exposed plaster parting face thoroughly. **This is the step people
   skip, and the two halves then fuse into one useless block.**
9. Pour the second half. Wait, then separate the halves and pull the print out.`;
}

function shellSteps(mix: PlasterMix): string {
  return `## Making the mold: printed shells

You print **trays**, and pour plaster **into** them. Print once, cast as many
plaster molds as you like -- which is the point if you are running a batch.

1. Print both trays. The part appears as a raised core on each tray's floor; the
   plaster is poured around it.
2. Coat the inside of each tray with mold soap or a light release spray. The draft
   on the walls does most of the work, but soap makes it effortless.
3. Mix ${mix.plasterKg.toFixed(2)} kg of plaster into ${mix.waterLitres.toFixed(2)} L of
   water. Pour into each tray until it is proud of the rim.
4. Tap the tray on the bench for a minute. Air bubbles rising against a core turn
   into pits on the face of every pot you ever cast from it.
5. Screed the excess off level with the rim using a straightedge. That face becomes
   the back of the mold half, so it wants to be flat -- the mold will stand on it.
6. Wait until set and cool, then flex the tray away. The parting face comes out
   flat and already keyed, because it formed against the tray's floor.
7. The half with cones and the half with sockets mate one way only.`;
}
