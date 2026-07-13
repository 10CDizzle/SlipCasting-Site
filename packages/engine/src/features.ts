/**
 * The document model.
 *
 * A document is a small JSON list of features, each one an operation with declared
 * inputs and outputs. That single decision is what makes the whole CAD interface
 * possible: a Feature List you can edit, a Rollback Bar you can drag, features you
 * can reorder and see turn red, and versions you can branch and merge -- because
 * merging a document means diffing a little JSON array, not reconciling two B-reps.
 */
import type { MoldParams, OutputMode, Vec3 } from './types.js';
import { DEFAULT_PARAMS } from './types.js';

export type FeatureType =
  | 'import'
  | 'shrink'
  | 'pullDir'
  | 'block'
  | 'spare'
  | 'split'
  | 'keys'
  | 'output';

export interface Feature {
  id: string;
  type: FeatureType;
  /** User-editable label shown in the Feature List. */
  name: string;
  params: Record<string, unknown>;
  /** Set by the user, not the engine: a suppressed feature is skipped. */
  suppressed?: boolean;
}

export interface FeatureError {
  featureId: string;
  message: string;
}

/**
 * What each feature consumes and produces.
 *
 * This table is the whole reordering story. Drag `split` above `block` and the
 * engine sees that `split` wants a body nothing has produced yet, and marks it in
 * error -- the same thing Onshape does. It does not refuse the drag; it shows you
 * what broke.
 */
export const FEATURE_SPECS: Record<
  FeatureType,
  { consumes: string[]; produces: string[]; label: string }
> = {
  import: { consumes: [], produces: ['part'], label: 'Import' },
  shrink: { consumes: ['part'], produces: ['master'], label: 'Shrink for clay' },
  pullDir: { consumes: ['master'], produces: ['pull'], label: 'Pull direction' },
  block: { consumes: ['master', 'pull'], produces: ['block'], label: 'Mold block' },
  spare: { consumes: ['master', 'block'], produces: ['cavity'], label: 'Pour spare' },
  split: { consumes: ['block', 'cavity'], produces: ['plaster'], label: 'Split' },
  keys: { consumes: ['plaster'], produces: ['keyed'], label: 'Registration keys' },
  output: { consumes: ['keyed'], produces: ['pieces'], label: 'Printable pieces' },
};

/** The feature list a freshly imported part starts with. */
export function defaultFeatures(fileId: string, fileName: string): Feature[] {
  const p = DEFAULT_PARAMS;
  return [
    { id: 'f1', type: 'import', name: fileName, params: { fileId, units: 'mm' } },
    { id: 'f2', type: 'shrink', name: 'Shrink for clay', params: { shrinkage: p.shrinkage } },
    { id: 'f3', type: 'pullDir', name: 'Pull direction', params: { mode: 'auto', minDraft: p.minDraft } },
    {
      id: 'f4',
      type: 'block',
      name: 'Mold block',
      params: { wallThickness: p.wallThickness, blockStyle: p.blockStyle, outerDraft: p.outerDraft },
    },
    {
      id: 'f5',
      type: 'spare',
      name: 'Pour spare',
      params: {
        spareDiameter: p.spareDiameter,
        spareHeight: p.spareHeight,
        sparePosition: p.sparePosition,
      },
    },
    { id: 'f6', type: 'split', name: 'Split', params: { split: p.split } },
    {
      id: 'f7',
      type: 'keys',
      name: 'Registration keys',
      params: { keyCount: p.keyCount, keyDiameter: p.keyDiameter, keyClearance: p.keyClearance },
    },
    { id: 'f8', type: 'output', name: 'Printable pieces', params: { mode: p.mode, shellWall: p.shellWall } },
  ];
}

/**
 * Check a feature list for ordering errors.
 *
 * Walks the list, tracking which bodies exist. A feature that needs a body nobody
 * has made yet is an error; so is everything downstream of it, because it never
 * ran. Returns errors keyed by feature, which is what paints the red badges.
 */
export function validate(features: Feature[]): FeatureError[] {
  const errors: FeatureError[] = [];
  const available = new Set<string>();
  let broken = false;

  for (const feature of features) {
    if (feature.suppressed) continue;

    const spec = FEATURE_SPECS[feature.type];
    if (!spec) {
      errors.push({ featureId: feature.id, message: `Unknown feature type "${feature.type}".` });
      broken = true;
      continue;
    }

    if (broken) {
      errors.push({
        featureId: feature.id,
        message: 'Skipped: an earlier feature failed.',
      });
      continue;
    }

    const missing = spec.consumes.filter((body) => !available.has(body));
    if (missing.length > 0) {
      errors.push({
        featureId: feature.id,
        message: `Needs ${missing.join(' and ')}, which nothing has produced yet. Move it after the feature that makes ${missing.length > 1 ? 'them' : 'it'}.`,
      });
      broken = true;
      continue;
    }

    for (const body of spec.produces) available.add(body);
  }

  return errors;
}

/** Collapse the feature list into the flat parameter set the geometry code wants. */
export function paramsFrom(features: Feature[], upTo = features.length): MoldParams {
  const params: MoldParams = { ...DEFAULT_PARAMS };

  for (const feature of features.slice(0, upTo)) {
    if (feature.suppressed) continue;
    for (const [key, value] of Object.entries(feature.params)) {
      if (key in params) {
        (params as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }
  return params;
}

/** The pull axis override, if the user pinned one. */
export function pullOverrideFrom(features: Feature[]): Vec3 | undefined {
  const f = features.find((x) => x.type === 'pullDir' && !x.suppressed);
  if (!f || f.params.mode !== 'manual') return undefined;
  const dir = f.params.direction as Vec3 | undefined;
  return dir && dir.length === 3 ? dir : undefined;
}

export function outputModeFrom(features: Feature[]): OutputMode {
  const f = features.find((x) => x.type === 'output' && !x.suppressed);
  return ((f?.params.mode as OutputMode) ?? 'shells');
}

/**
 * A stable content hash of the first `count` features.
 *
 * Two feature lists with the same prefix hash produce identical geometry, which
 * is what lets the Rollback Bar scrub instantly instead of re-running booleans on
 * every drag frame.
 */
export function prefixHash(features: Feature[], count: number): string {
  const relevant = features.slice(0, count).map((f) => ({
    t: f.type,
    p: f.params,
    s: f.suppressed ?? false,
  }));

  const text = JSON.stringify(relevant);

  // FNV-1a. Not cryptographic, and does not need to be: a collision costs a stale
  // preview, not a wrong file.
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
