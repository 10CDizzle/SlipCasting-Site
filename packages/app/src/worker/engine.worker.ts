/**
 * The geometry engine, off the main thread.
 *
 * Manifold's WASM is single-threaded and a boolean on a heavy part takes seconds.
 * Run that on the main thread and the viewport freezes mid-drag, which in a CAD
 * tool reads as "broken" long before it reads as "busy". Here it runs in a worker,
 * the UI stays live, and progress is reported as it goes.
 *
 * Meshes cross the boundary as transferable ArrayBuffers -- copying a few hundred
 * thousand triangles per keystroke would undo the point of the worker.
 */
import * as Comlink from 'comlink';
import {
  RegenEngine,
  bundle,
  loadModel,
  toGLB,
  type Feature,
  type GenerateResult,
  type MeshData,
  type Unit,
  type Vec3,
} from '@slipcast/engine';

/** What the UI needs to draw a body. Meshes are already GLB-encoded. */
export interface BodyView {
  id: string;
  name: string;
  category: string;
  printable: boolean;
  explode: Vec3;
  triangles: number;
  volumeMm3: number;
}

export interface RegenView {
  ok: boolean;
  errors: Array<{ featureId: string; message: string }>;
  cached: boolean;
  /** Null when rolled back before any mold exists, or when the list is in error. */
  glb: ArrayBuffer | null;
  bodies: BodyView[];
  warnings: string[];
  instructions: string;
  moldable: boolean;
  pullDirection: Vec3 | null;
  partingZ: number | null;
  volumes: { plasterMm3: number; cavityMm3: number } | null;
  draftArea: { ok: number; shallow: number; undercut: number } | null;
}

const regen = new RegenEngine();

/** The imported parts, kept in the worker so meshes are not shipped back and forth. */
const parts = new Map<string, MeshData>();
/** The last successful result, so export does not have to recompute it. */
let lastResult: GenerateResult | null = null;

const api = {
  async importModel(
    fileId: string,
    filename: string,
    bytes: ArrayBuffer,
    unit: Unit,
  ): Promise<{ triangles: number; unitWarning?: string; glb: ArrayBuffer }> {
    const loaded = await loadModel(filename, new Uint8Array(bytes), unit);
    parts.set(fileId, loaded.mesh);

    const glb = toGLB([{ name: filename, mesh: loaded.mesh }]);
    const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;

    return Comlink.transfer(
      {
        triangles: loaded.mesh.indices.length / 3,
        unitWarning: loaded.unitWarning,
        glb: buffer,
      },
      [buffer],
    );
  },

  async regenerate(features: Feature[], fileId: string, rollbackTo?: number): Promise<RegenView> {
    const part = parts.get(fileId);
    if (!part) throw new Error('That model is no longer loaded. Re-import it.');

    try {
      const result = await regen.run({ features, part, rollbackTo });

      if (!result.geometry) {
        return {
          ok: result.errors.length === 0,
          errors: result.errors,
          cached: result.cached,
          glb: null,
          bodies: [],
          warnings: [],
          instructions: '',
          moldable: true,
          pullDirection: null,
          partingZ: null,
          volumes: null,
          draftArea: null,
        };
      }

      lastResult = result.geometry;
      const g = result.geometry;

      // The master carries the undercut heatmap as vertex colours; every other
      // body is drawn plain. Sending colours the UI would otherwise have to
      // re-derive is how the viewport and the analysis stay in agreement.
      const glbBytes = toGLB(
        g.bodies.map((b) =>
          b.id === 'master'
            ? { name: b.id, mesh: b.mesh, colors: g.heatmap }
            : { name: b.id, mesh: b.mesh },
        ),
      );
      const buffer = glbBytes.buffer.slice(
        glbBytes.byteOffset,
        glbBytes.byteOffset + glbBytes.byteLength,
      ) as ArrayBuffer;

      const view: RegenView = {
        ok: true,
        errors: [],
        cached: result.cached,
        glb: buffer,
        bodies: g.bodies.map((b) => ({
          id: b.id,
          name: b.name,
          category: b.category,
          printable: b.printable,
          explode: b.explode,
          triangles: b.mesh.indices.length / 3,
          volumeMm3: 0,
        })),
        warnings: g.warnings,
        instructions: g.instructions,
        moldable: g.mold.plan.analysis.moldable,
        pullDirection: g.mold.plan.pullDirection,
        partingZ: g.mold.plan.partingZ,
        volumes: {
          plasterMm3: g.mold.volumes.plaster,
          cavityMm3: g.mold.volumes.cavity,
        },
        draftArea: g.mold.plan.analysis.area,
      };

      return Comlink.transfer(view, [buffer]);
    } catch (err) {
      // A refusal -- "this part has undercuts" -- is a legitimate answer, not a
      // crash. It travels back as a message the UI shows, not a stack trace.
      return {
        ok: false,
        errors: [{ featureId: '', message: (err as Error).message }],
        cached: false,
        glb: null,
        bodies: [],
        warnings: [],
        instructions: '',
        moldable: false,
        pullDirection: null,
        partingZ: null,
        volumes: null,
        draftArea: null,
      };
    }
  },

  /** The download. Uses the last regenerated result, so nothing is computed twice. */
  async exportZip(): Promise<ArrayBuffer> {
    if (!lastResult) throw new Error('Nothing to export yet.');
    const zip = bundle(lastResult);
    const buffer = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
    return Comlink.transfer(buffer, [buffer]);
  },
};

export type EngineApi = typeof api;

Comlink.expose(api);
