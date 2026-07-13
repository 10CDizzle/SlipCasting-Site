/**
 * Versions, branches, and merges.
 *
 * Onshape's branching history graph is one of the things that makes it feel like
 * a real tool rather than a form. It is only affordable here because a document is
 * a short JSON array: merging two designs means diffing a list of features, not
 * reconciling two solid models -- which is a genuinely unsolved problem.
 */
import type { Feature } from './features.js';

export interface Version {
  id: string;
  name: string;
  /** Immutable snapshot of the feature list at this point. */
  features: Feature[];
  /** The version this one was created from. Null for the root. */
  parent: string | null;
  createdAt: number;
}

export interface Branch {
  name: string;
  /** The version this branch currently points at. */
  head: string;
}

export interface VersionGraph {
  versions: Record<string, Version>;
  branches: Branch[];
  current: string;
}

export function createGraph(features: Feature[]): VersionGraph {
  const root: Version = {
    id: 'v1',
    name: 'Start',
    features: structuredClone(features),
    parent: null,
    createdAt: Date.now(),
  };
  return {
    versions: { v1: root },
    branches: [{ name: 'main', head: 'v1' }],
    current: 'v1',
  };
}

export function commit(graph: VersionGraph, features: Feature[], name: string): VersionGraph {
  const id = `v${Object.keys(graph.versions).length + 1}`;
  const version: Version = {
    id,
    name,
    features: structuredClone(features),
    parent: graph.current,
    createdAt: Date.now(),
  };

  const branch = graph.branches.find((b) => b.head === graph.current);

  return {
    versions: { ...graph.versions, [id]: version },
    branches: branch
      ? graph.branches.map((b) => (b.name === branch.name ? { ...b, head: id } : b))
      : graph.branches,
    current: id,
  };
}

export function branch(graph: VersionGraph, name: string): VersionGraph {
  return {
    ...graph,
    branches: [...graph.branches, { name, head: graph.current }],
  };
}

/** Walk back to the root, so two versions can be compared against where they diverged. */
function ancestry(graph: VersionGraph, id: string): string[] {
  const chain: string[] = [];
  let cursor: string | null = id;
  while (cursor) {
    chain.push(cursor);
    cursor = graph.versions[cursor]?.parent ?? null;
  }
  return chain;
}

/** The most recent version both sides share: the base for a three-way merge. */
export function commonAncestor(graph: VersionGraph, a: string, b: string): string | null {
  const ancestorsOfA = new Set(ancestry(graph, a));
  for (const id of ancestry(graph, b)) {
    if (ancestorsOfA.has(id)) return id;
  }
  return null;
}

export type ChangeKind = 'added' | 'removed' | 'changed' | 'moved';

export interface FeatureChange {
  kind: ChangeKind;
  featureId: string;
  name: string;
  detail?: string;
}

/** What one version did to another. Drives the "compare versions" view. */
export function diff(base: Feature[], head: Feature[]): FeatureChange[] {
  const changes: FeatureChange[] = [];
  const baseById = new Map(base.map((f) => [f.id, f]));
  const headById = new Map(head.map((f) => [f.id, f]));

  for (const f of head) {
    const before = baseById.get(f.id);
    if (!before) {
      changes.push({ kind: 'added', featureId: f.id, name: f.name });
      continue;
    }
    if (JSON.stringify(before.params) !== JSON.stringify(f.params)) {
      const keys = Object.keys(f.params).filter(
        (k) => JSON.stringify(before.params[k]) !== JSON.stringify(f.params[k]),
      );
      changes.push({
        kind: 'changed',
        featureId: f.id,
        name: f.name,
        detail: keys
          .map((k) => `${k}: ${JSON.stringify(before.params[k])} -> ${JSON.stringify(f.params[k])}`)
          .join(', '),
      });
    }
  }

  for (const f of base) {
    if (!headById.has(f.id)) {
      changes.push({ kind: 'removed', featureId: f.id, name: f.name });
    }
  }

  const baseOrder = base.filter((f) => headById.has(f.id)).map((f) => f.id).join(',');
  const headOrder = head.filter((f) => baseById.has(f.id)).map((f) => f.id).join(',');
  if (baseOrder !== headOrder) {
    changes.push({ kind: 'moved', featureId: '', name: 'Feature order changed' });
  }

  return changes;
}

export interface Conflict {
  featureId: string;
  name: string;
  /** The parameters both sides edited, differently. */
  keys: string[];
  ours: Record<string, unknown>;
  theirs: Record<string, unknown>;
}

export interface MergeResult {
  features: Feature[];
  conflicts: Conflict[];
}

/**
 * Three-way merge of two feature lists against their common ancestor.
 *
 * Per feature, per parameter: if only one side touched it, take that side. If both
 * touched it and disagree, that is a conflict -- reported, not guessed at. Silently
 * picking a winner is how you end up with a mold at somebody else's shrinkage.
 */
export function merge(base: Feature[], ours: Feature[], theirs: Feature[]): MergeResult {
  const baseById = new Map(base.map((f) => [f.id, f]));
  const oursById = new Map(ours.map((f) => [f.id, f]));
  const theirsById = new Map(theirs.map((f) => [f.id, f]));

  const conflicts: Conflict[] = [];
  const merged: Feature[] = [];

  // Keep our ordering, then append anything they added that we do not have.
  const order = [
    ...ours.map((f) => f.id),
    ...theirs.filter((f) => !oursById.has(f.id)).map((f) => f.id),
  ];

  for (const id of order) {
    const b = baseById.get(id);
    const o = oursById.get(id);
    const t = theirsById.get(id);

    // Deleted on one side, untouched on the other: honour the deletion.
    if (!o && t) {
      if (b && JSON.stringify(b.params) === JSON.stringify(t.params)) continue;
      merged.push(structuredClone(t));
      continue;
    }
    if (o && !t) {
      if (b && JSON.stringify(b.params) === JSON.stringify(o.params)) continue;
      merged.push(structuredClone(o));
      continue;
    }
    if (!o || !t) continue;

    if (!b) {
      // Both added a feature with the same id; take ours and note the clash.
      merged.push(structuredClone(o));
      if (JSON.stringify(o.params) !== JSON.stringify(t.params)) {
        conflicts.push({
          featureId: id,
          name: o.name,
          keys: Object.keys(o.params),
          ours: o.params,
          theirs: t.params,
        });
      }
      continue;
    }

    const params: Record<string, unknown> = { ...b.params };
    const clashing: string[] = [];

    for (const key of new Set([...Object.keys(o.params), ...Object.keys(t.params)])) {
      const wasOurs = JSON.stringify(o.params[key]) !== JSON.stringify(b.params[key]);
      const wasTheirs = JSON.stringify(t.params[key]) !== JSON.stringify(b.params[key]);

      if (wasOurs && wasTheirs) {
        if (JSON.stringify(o.params[key]) !== JSON.stringify(t.params[key])) {
          clashing.push(key);
          params[key] = o.params[key]; // provisional; the UI must resolve it
        } else {
          params[key] = o.params[key]; // both made the same edit
        }
      } else if (wasOurs) {
        params[key] = o.params[key];
      } else if (wasTheirs) {
        params[key] = t.params[key];
      }
    }

    merged.push({ ...structuredClone(o), params });

    if (clashing.length > 0) {
      conflicts.push({
        featureId: id,
        name: o.name,
        keys: clashing,
        ours: o.params,
        theirs: t.params,
      });
    }
  }

  return { features: merged, conflicts };
}
