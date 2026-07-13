import { describe, expect, it } from 'vitest';
import {
  defaultFeatures,
  paramsFrom,
  prefixHash,
  validate,
  type Feature,
} from '../src/features.js';
import { RegenEngine } from '../src/regen.js';
import { branch, commit, commonAncestor, createGraph, diff, merge } from '../src/versions.js';
import { cup } from '../src/fixtures.js';
import { volume } from '../src/mesh.js';

const base = () => defaultFeatures('file-1', 'cup.stl');

const move = (features: Feature[], from: number, to: number): Feature[] => {
  const next = [...features];
  const [f] = next.splice(from, 1);
  next.splice(to, 0, f!);
  return next;
};

describe('validate', () => {
  it('accepts the default feature list', () => {
    expect(validate(base())).toEqual([]);
  });

  it('flags a feature dragged above the one that feeds it', () => {
    // Onshape lets you make this mistake and then shows you what broke. So do we:
    // refusing the drag would be less honest and much more annoying.
    const features = base();
    const splitIndex = features.findIndex((f) => f.type === 'split');
    const blockIndex = features.findIndex((f) => f.type === 'block');

    const errors = validate(move(features, splitIndex, blockIndex));

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.featureId).toBe(features[splitIndex]!.id);
    expect(errors[0]!.message).toMatch(/nothing has produced yet/);
  });

  it('rolls the failure downstream instead of cascading nonsense', () => {
    const features = base();
    const splitIndex = features.findIndex((f) => f.type === 'split');
    const errors = validate(move(features, splitIndex, 1));

    // The moved feature is the real error; everything after it merely never ran.
    expect(errors[0]!.message).toMatch(/nothing has produced yet/);
    expect(errors.slice(1).every((e) => /Skipped/.test(e.message))).toBe(true);
  });

  it('lets a feature be suppressed without breaking what follows', () => {
    const features = base().map((f) =>
      f.type === 'keys' ? { ...f, suppressed: true } : f,
    );
    // 'keys' produces a body nothing else consumes except 'output'... which does
    // consume it, so suppressing it must be reported rather than silently ignored.
    const errors = validate(features);
    expect(errors.some((e) => e.message.includes('keyed'))).toBe(true);
  });
});

describe('paramsFrom', () => {
  it('collapses the feature list into one parameter set', () => {
    const features = base().map((f) =>
      f.type === 'shrink' ? { ...f, params: { shrinkage: 0.11 } } : f,
    );
    expect(paramsFrom(features).shrinkage).toBe(0.11);
  });

  it('honours the rollback point: later features have not happened yet', () => {
    const features = base();
    const shrinkIndex = features.findIndex((f) => f.type === 'shrink');
    // Rolled back above 'shrink', the shrink value must be the default, not the
    // one the user typed into a feature that has not run.
    const rolled = paramsFrom(
      features.map((f) => (f.type === 'shrink' ? { ...f, params: { shrinkage: 0.2 } } : f)),
      shrinkIndex,
    );
    expect(rolled.shrinkage).not.toBe(0.2);
  });
});

describe('prefixHash', () => {
  it('is stable for the same prefix', () => {
    expect(prefixHash(base(), 4)).toBe(prefixHash(base(), 4));
  });

  it('changes when a parameter changes', () => {
    const edited = base().map((f) =>
      f.type === 'block' ? { ...f, params: { ...f.params, wallThickness: 30 } } : f,
    );
    expect(prefixHash(edited, 8)).not.toBe(prefixHash(base(), 8));
  });

  it('ignores features beyond the rollback point', () => {
    const edited = base().map((f) =>
      f.type === 'output' ? { ...f, params: { mode: 'positive' } } : f,
    );
    // 'output' is last, so a prefix that stops before it is unaffected -- which is
    // exactly what makes scrubbing the Rollback Bar cheap.
    expect(prefixHash(edited, 4)).toBe(prefixHash(base(), 4));
  });

  it('is unaffected by renaming a feature', () => {
    const renamed = base().map((f) => ({ ...f, name: 'Renamed' }));
    // A name is a label, not geometry. Renaming must not invalidate the cache.
    expect(prefixHash(renamed, 8)).toBe(prefixHash(base(), 8));
  });
});

describe('RegenEngine', () => {
  it('caches: the same document twice does not rebuild the geometry', async () => {
    const engine = new RegenEngine();
    const part = cup();

    const first = await engine.run({ features: base(), part });
    const second = await engine.run({ features: base(), part });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    // Identical, not merely equivalent: the cache returns the same object.
    expect(second.geometry).toBe(first.geometry);
  });

  it('rebuilds when a parameter actually changes', async () => {
    const engine = new RegenEngine();
    const part = cup();

    const thin = await engine.run({
      features: base().map((f) =>
        f.type === 'block' ? { ...f, params: { ...f.params, wallThickness: 15 } } : f,
      ),
      part,
    });
    const thick = await engine.run({
      features: base().map((f) =>
        f.type === 'block' ? { ...f, params: { ...f.params, wallThickness: 40 } } : f,
      ),
      part,
    });

    expect(thick.cached).toBe(false);
    expect(thick.geometry!.mold.volumes.block).toBeGreaterThan(
      thin.geometry!.mold.volumes.block,
    );
  });

  it('rolling back to N equals a fresh run of the first N features', async () => {
    // The Rollback Bar must be honest: what it shows has to be what you would get
    // if you had never added the features below it.
    const engine = new RegenEngine();
    const part = cup();

    const features = base();
    const upTo = features.findIndex((f) => f.type === 'keys'); // stop before keys

    const rolled = await engine.run({ features, part, rollbackTo: upTo });
    const truncated = await new RegenEngine().run({
      features: features.slice(0, upTo),
      part,
    });

    expect(volume(rolled.geometry!.mold.plasterLower)).toBeCloseTo(
      volume(truncated.geometry!.mold.plasterLower),
      6,
    );
  });

  it('serves no geometry at all when the list is in error', async () => {
    // Not stale geometry. The user has to see that the screen no longer matches
    // what they asked for.
    const engine = new RegenEngine();
    const features = base();
    const splitIndex = features.findIndex((f) => f.type === 'split');

    const result = await engine.run({ features: move(features, splitIndex, 1), part: cup() });

    expect(result.geometry).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('shows the part alone when rolled back before any mold exists', async () => {
    const engine = new RegenEngine();
    const result = await engine.run({ features: base(), part: cup(), rollbackTo: 2 });

    expect(result.geometry).toBeNull();
    expect(result.errors).toEqual([]); // not an error -- a legitimate thing to want
  });

  it('does not grow without bound', async () => {
    const engine = new RegenEngine(3);
    const part = cup();

    for (const wall of [10, 15, 20, 25, 30]) {
      await engine.run({
        features: base().map((f) =>
          f.type === 'block' ? { ...f, params: { ...f.params, wallThickness: wall } } : f,
        ),
        part,
      });
    }
    expect(engine.size).toBeLessThanOrEqual(3);
  });
});

describe('version graph', () => {
  it('records versions and tracks a branch head', () => {
    let graph = createGraph(base());
    graph = commit(graph, base(), 'Thicker walls');

    expect(Object.keys(graph.versions)).toHaveLength(2);
    expect(graph.branches[0]!.head).toBe(graph.current);
  });

  it('finds where two branches diverged', () => {
    let graph = createGraph(base());
    graph = commit(graph, base(), 'Second');
    const forkPoint = graph.current;

    graph = branch(graph, 'experiment');
    graph = commit(graph, base(), 'On main');
    const mainHead = graph.current;

    graph.current = forkPoint;
    graph = commit(graph, base(), 'On experiment');

    expect(commonAncestor(graph, mainHead, graph.current)).toBe(forkPoint);
  });
});

describe('diff', () => {
  it('reports a parameter change with its before and after', () => {
    const changed = base().map((f) =>
      f.type === 'shrink' ? { ...f, params: { shrinkage: 0.11 } } : f,
    );
    const changes = diff(base(), changed);

    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe('changed');
    expect(changes[0]!.detail).toContain('0.13');
    expect(changes[0]!.detail).toContain('0.11');
  });

  it('notices a reorder', () => {
    const changes = diff(base(), move(base(), 6, 3));
    expect(changes.some((c) => c.kind === 'moved')).toBe(true);
  });
});

describe('merge', () => {
  it('takes each side\'s edit when they touched different things', () => {
    const ancestor = base();
    const ours = ancestor.map((f) =>
      f.type === 'shrink' ? { ...f, params: { shrinkage: 0.11 } } : f,
    );
    const theirs = ancestor.map((f) =>
      f.type === 'block' ? { ...f, params: { ...f.params, wallThickness: 35 } } : f,
    );

    const result = merge(ancestor, ours, theirs);

    expect(result.conflicts).toHaveLength(0);
    expect(paramsFrom(result.features).shrinkage).toBe(0.11);
    expect(paramsFrom(result.features).wallThickness).toBe(35);
  });

  it('reports a conflict rather than silently picking a winner', () => {
    // Two people set different clay shrinkages. Guessing here means someone gets a
    // mold cut for someone else's clay body, and finds out after the kiln.
    const ancestor = base();
    const ours = ancestor.map((f) =>
      f.type === 'shrink' ? { ...f, params: { shrinkage: 0.11 } } : f,
    );
    const theirs = ancestor.map((f) =>
      f.type === 'shrink' ? { ...f, params: { shrinkage: 0.14 } } : f,
    );

    const result = merge(ancestor, ours, theirs);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.keys).toContain('shrinkage');
    expect(result.conflicts[0]!.ours.shrinkage).toBe(0.11);
    expect(result.conflicts[0]!.theirs.shrinkage).toBe(0.14);
  });

  it('does not conflict when both sides made the same edit', () => {
    const ancestor = base();
    const edit = (f: Feature) =>
      f.type === 'shrink' ? { ...f, params: { shrinkage: 0.12 } } : f;

    const result = merge(ancestor, ancestor.map(edit), ancestor.map(edit));
    expect(result.conflicts).toHaveLength(0);
    expect(paramsFrom(result.features).shrinkage).toBe(0.12);
  });

  it('keeps a feature one side added', () => {
    const ancestor = base();
    const extra: Feature = {
      id: 'f9',
      type: 'keys',
      name: 'Extra keys',
      params: { keyCount: 6 },
    };
    const result = merge(ancestor, ancestor, [...ancestor, extra]);

    expect(result.features.some((f) => f.id === 'f9')).toBe(true);
  });
});
