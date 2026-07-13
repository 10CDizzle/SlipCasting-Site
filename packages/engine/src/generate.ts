/**
 * The one call that takes a file and gives back everything a user needs.
 * The CLI, the Web Worker, and the tests all come through here.
 */
import { repair, type RepairReport } from './repair.js';
import { buildMold, type MoldGeometry } from './mold.js';
import { buildShells } from './shells.js';
import { buildPositive } from './positive.js';
import { instructions } from './report.js';
import { heatmapColors, toZip } from './exporters.js';
import { surfaceArea } from './mesh.js';
import type { Body, MeshData, MoldParams, Vec3 } from './types.js';

export interface GenerateResult {
  repair: RepairReport;
  mold: MoldGeometry;
  /** Every solid the user can see, hide, and export. */
  bodies: Body[];
  /** Per-vertex colours for the undercut heatmap on the master. */
  heatmap: Float32Array;
  instructions: string;
  warnings: string[];
}

export async function generate(
  part: MeshData,
  params: MoldParams,
  pullOverride?: Vec3,
): Promise<GenerateResult> {
  const healed = await repair(part);
  if (!healed.report.ok) {
    throw new Error(healed.report.messages.join(' '));
  }

  const mold = await buildMold(healed.mesh, params, pullOverride);

  const printable =
    params.mode === 'shells'
      ? await buildShells(mold, params)
      : await buildPositive(mold, params);

  const bodies: Body[] = [
    {
      id: 'master',
      name: 'Master (scaled part)',
      category: 'part',
      mesh: mold.plan.master,
      explode: [0, 0, 0],
      printable: false,
    },
    {
      id: 'plaster-lower',
      name: mold.plasterUpper ? 'Plaster: lower half' : 'Plaster: one-piece mold',
      category: 'plaster',
      mesh: mold.plasterLower,
      explode: [0, 0, -1],
      printable: false,
    },
    ...(mold.plasterUpper
      ? [
          {
            id: 'plaster-upper',
            name: 'Plaster: upper half',
            category: 'plaster' as const,
            mesh: mold.plasterUpper,
            explode: [0, 0, 1] as Vec3,
            printable: false,
          },
        ]
      : []),
    ...printable,
  ];

  const warnings: string[] = [...healed.report.messages];
  if (mold.plan.analysis.area.shallow > 0) {
    const pct = (
      (mold.plan.analysis.area.shallow /
        (mold.plan.analysis.area.ok + mold.plan.analysis.area.shallow)) *
      100
    ).toFixed(0);
    warnings.push(
      `${pct}% of the surface has less draft than you asked for. It will still release, but it will drag on the plaster -- consider adding a degree or two of taper in CAD.`,
    );
  }

  const text = instructions({
    mode: params.mode,
    params,
    plasterMm3: mold.volumes.plaster,
    cavityMm3: mold.volumes.cavity,
    cavityAreaMm2: surfaceArea(mold.cavity),
    pieces: bodies.map((b) => ({ name: b.name, mesh: b.mesh, printable: b.printable })),
    warnings,
  });

  const heatmap = heatmapColors(
    mold.plan.analysis.faceClass,
    mold.plan.master.positions.length / 3,
    mold.plan.master.indices,
  );

  return { repair: healed.report, mold, bodies, heatmap, instructions: text, warnings };
}

/** Zip up the printable pieces and the instructions. */
export function bundle(result: GenerateResult): Uint8Array {
  return toZip({ bodies: result.bodies, instructions: result.instructions });
}
