/**
 * The Version and History graph (UI-UX.md §2A).
 *
 * A branching tree of named versions, with merge. It is affordable here for one
 * reason: a document is a short JSON list of features, so merging two designs is a
 * three-way diff over an array -- not a reconciliation of two solid models, which
 * nobody knows how to do.
 *
 * Conflicts are reported, never guessed. If two people set different clay
 * shrinkages, silently picking one hands someone a mold cut for another person's
 * clay body, and they find out after the kiln.
 */
import { useState } from 'react';
import { diff } from '@slipcast/engine';
import { useStore } from '../state/store.ts';

export function VersionGraphPanel({ onClose }: { onClose: () => void }) {
  const versions = useStore((s) => s.versions);
  const features = useStore((s) => s.features);
  const saveVersion = useStore((s) => s.saveVersion);
  const mergeFrom = useStore((s) => s.mergeFrom);

  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);

  if (!versions) return null;

  const list = Object.values(versions.versions).sort((a, b) => a.createdAt - b.createdAt);
  const current = versions.versions[versions.current];

  // What has changed since the version we are sitting on.
  const pending = current ? diff(current.features, features) : [];

  return (
    <div
      className="absolute left-2 top-11 z-30 w-80 rounded-md border border-shell-600 bg-shell-800 p-3 shadow-2xl"
      data-testid="version-graph"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-300">
          Versions
        </span>
        <button onClick={onClose} className="text-ink-500 hover:text-ink-100">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="mb-3 max-h-52 space-y-0.5 overflow-y-auto">
        {list.map((v) => {
          const isCurrent = v.id === versions.current;
          const depth = ancestorDepth(versions.versions, v.id);

          return (
            <div
              key={v.id}
              className={[
                'flex items-center gap-2 rounded px-1.5 py-1 text-xs',
                isCurrent ? 'bg-pick-soft' : 'hover:bg-shell-700',
              ].join(' ')}
              style={{ paddingLeft: `${6 + depth * 10}px` }}
              data-testid={`version-${v.id}`}
            >
              {/* The branching tree: a node, and a line back to its parent. */}
              <span
                className={[
                  'h-2 w-2 shrink-0 rounded-full',
                  isCurrent ? 'bg-pick' : 'bg-shell-500',
                ].join(' ')}
              />
              <span className="flex-1 truncate text-ink-100">{v.name}</span>
              {!isCurrent && (
                <button
                  onClick={() => {
                    const { conflicts } = mergeFrom(v.id);
                    setNote(
                      conflicts === 0
                        ? `Merged "${v.name}" cleanly.`
                        : `Merged with ${conflicts} conflict${conflicts === 1 ? '' : 's'} — your values were kept. Check them.`,
                    );
                  }}
                  className="shrink-0 rounded px-1 text-[10px] text-ink-500 hover:bg-shell-600 hover:text-ink-100"
                  title="Merge this version into the current one"
                >
                  merge
                </button>
              )}
            </div>
          );
        })}
      </div>

      {pending.length > 0 && (
        <div className="mb-2 rounded border border-shell-600 bg-shell-900 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">
            Unsaved changes
          </div>
          {pending.slice(0, 4).map((c, i) => (
            <div key={i} className="truncate text-[10px] text-ink-300">
              <span className="text-ink-500">{c.kind}</span> {c.name}
              {c.detail ? ` — ${c.detail}` : ''}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              saveVersion(name.trim());
              setName('');
              setNote('Version saved.');
            }
          }}
          placeholder="Name this version…"
          className="flex-1 rounded border border-shell-600 bg-shell-900 px-2 py-1 text-xs text-ink-100 outline-none placeholder:text-ink-500 focus:border-pick"
          data-testid="version-name"
        />
        <button
          onClick={() => {
            if (!name.trim()) return;
            saveVersion(name.trim());
            setName('');
            setNote('Version saved.');
          }}
          className="rounded bg-pick px-2 py-1 text-xs text-white hover:brightness-110"
          data-testid="save-version"
        >
          Save
        </button>
      </div>

      {note && <p className="mt-2 text-[10px] leading-snug text-ink-300">{note}</p>}
    </div>
  );
}

function ancestorDepth(
  versions: Record<string, { parent: string | null }>,
  id: string,
): number {
  let depth = 0;
  let cursor = versions[id]?.parent ?? null;
  while (cursor && depth < 12) {
    depth++;
    cursor = versions[cursor]?.parent ?? null;
  }
  return depth;
}
