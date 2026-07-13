/**
 * Regeneration: evaluate a feature list into geometry, with a cache.
 *
 * The cache is keyed by a hash of the feature prefix, which means dragging the
 * Rollback Bar back and forth, or scrubbing a preview slider, replays states that
 * have already been computed instead of re-running booleans on every frame. That
 * is the difference between a CAD tool and a form with a Submit button.
 */
import { generate, type GenerateResult } from './generate.js';
import {
  paramsFrom,
  prefixHash,
  pullOverrideFrom,
  validate,
  type Feature,
  type FeatureError,
} from './features.js';
import type { MeshData } from './types.js';

export interface RegenRequest {
  features: Feature[];
  /** Evaluate only the first N features. Defaults to all of them. */
  rollbackTo?: number;
  /** The imported mesh, resolved by the caller from the import feature's fileId. */
  part: MeshData;
}

export interface RegenResult {
  /** Null when the list is in error, or rolled back before any geometry exists. */
  geometry: GenerateResult | null;
  errors: FeatureError[];
  /** True when this came back from cache without touching the geometry kernel. */
  cached: boolean;
  hash: string;
  /** How far the Rollback Bar was when this was produced. */
  rolledBackTo: number;
}

/** Which feature has to have run before there is anything at all to look at. */
const FIRST_GEOMETRY_FEATURE = 'block';

export class RegenEngine {
  #cache = new Map<string, GenerateResult>();
  #maxEntries: number;

  constructor(maxEntries = 24) {
    this.#maxEntries = maxEntries;
  }

  get size(): number {
    return this.#cache.size;
  }

  clear(): void {
    this.#cache.clear();
  }

  async run(request: RegenRequest): Promise<RegenResult> {
    const { features, part } = request;
    const rollbackTo = request.rollbackTo ?? features.length;

    const errors = validate(features.slice(0, rollbackTo));
    const hash = prefixHash(features, rollbackTo);

    if (errors.length > 0) {
      // A broken list must not quietly serve the last good geometry: the user
      // needs to see that what is on screen no longer matches what they asked for.
      return { geometry: null, errors, cached: false, hash, rolledBackTo: rollbackTo };
    }

    const active = features.slice(0, rollbackTo).filter((f) => !f.suppressed);
    const hasGeometry = active.some((f) => f.type === FIRST_GEOMETRY_FEATURE);
    if (!hasGeometry) {
      // Rolled back past the point where a mold exists. Not an error -- the user
      // is looking at the part alone, which is a legitimate thing to want.
      return { geometry: null, errors: [], cached: false, hash, rolledBackTo: rollbackTo };
    }

    const hit = this.#cache.get(hash);
    if (hit) {
      return { geometry: hit, errors: [], cached: true, hash, rolledBackTo: rollbackTo };
    }

    const params = paramsFrom(features, rollbackTo);
    const geometry = await generate(part, params, pullOverrideFrom(features.slice(0, rollbackTo)));

    this.#remember(hash, geometry);

    return { geometry, errors: [], cached: false, hash, rolledBackTo: rollbackTo };
  }

  #remember(hash: string, geometry: GenerateResult): void {
    if (this.#cache.size >= this.#maxEntries) {
      // Plain FIFO. Mold geometry is large, and holding a dozen of them is already
      // generous; a smarter policy would not earn its complexity here.
      const oldest = this.#cache.keys().next().value;
      if (oldest !== undefined) this.#cache.delete(oldest);
    }
    this.#cache.set(hash, geometry);
  }
}
