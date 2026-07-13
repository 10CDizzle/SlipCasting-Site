/**
 * The Parts List (UI-UX.md §2B): the bodies that exist, grouped by kind, each with
 * a hover eyeball to hide or show it. Right-click isolates.
 */
import { useStore } from '../state/store.ts';

const GROUPS: Array<{ key: string; label: string }> = [
  { key: 'part', label: 'Solid Parts' },
  { key: 'plaster', label: 'Plaster' },
  { key: 'printable', label: 'Print These' },
];

export function PartsList() {
  const regen = useStore((s) => s.regen);
  const hidden = useStore((s) => s.hidden);
  const isolated = useStore((s) => s.isolated);
  const selection = useStore((s) => s.selection);
  const toggleHidden = useStore((s) => s.toggleHidden);
  const isolate = useStore((s) => s.isolate);
  const select = useStore((s) => s.select);

  const bodies = regen?.bodies ?? [];
  if (bodies.length === 0) {
    return <div className="px-3 py-4 text-xs text-ink-500">No bodies yet.</div>;
  }

  return (
    <div className="pb-2" data-testid="parts-list">
      {GROUPS.map((group) => {
        const items = bodies.filter((b) => b.category === group.key);
        if (items.length === 0) return null;

        return (
          <div key={group.key}>
            <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              {group.label}
            </div>
            {items.map((body) => {
              const isHidden = hidden.has(body.id);
              const dimmed = isolated !== null && isolated !== body.id;

              return (
                <div
                  key={body.id}
                  onClick={() => select(body.id, false)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    isolate(body.id);
                  }}
                  data-testid={`part-${body.id}`}
                  className={[
                    'group flex cursor-pointer items-center gap-2 px-2.5 py-[5px] text-xs transition',
                    selection.includes(body.id) ? 'bg-pick-soft text-ink-100' : 'hover:bg-shell-700',
                    isHidden || dimmed ? 'opacity-40' : '',
                  ].join(' ')}
                  title={isolated === body.id ? 'Isolated. Right-click to show everything again.' : 'Right-click to isolate'}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{
                      background:
                        body.category === 'plaster'
                          ? '#d8d2c4'
                          : body.category === 'printable'
                            ? '#3f7fd8'
                            : '#8b93a1',
                    }}
                  />
                  <span className="flex-1 truncate text-ink-100">{body.name}</span>
                  <span className="shrink-0 text-[9px] tabular-nums text-ink-500">
                    {body.triangles.toLocaleString()}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleHidden(body.id);
                    }}
                    className={[
                      'shrink-0 transition',
                      isHidden
                        ? 'text-ink-500 opacity-100'
                        : 'text-ink-500 opacity-0 hover:text-ink-100 group-hover:opacity-100',
                    ].join(' ')}
                    title={isHidden ? 'Show' : 'Hide'}
                    data-testid={`eye-${body.id}`}
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                      {isHidden ? (
                        <path d="M3 3l18 18M10.6 5.1A9 9 0 0121 12a9 9 0 01-1.6 2.6M6.6 6.6A9 9 0 003 12a9 9 0 0012.4 5.4" strokeLinecap="round" />
                      ) : (
                        <>
                          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                          <circle cx="12" cy="12" r="2.6" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
