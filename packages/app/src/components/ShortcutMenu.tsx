/**
 * The "S" key shortcut menu (UI-UX.md §4).
 *
 * Press S and a small menu appears at the cursor, holding the tools that make
 * sense right now. In Onshape this is the thing that stops you crossing the screen
 * to a toolbar forty times an hour; the same logic applies here.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../state/store.ts';

interface Action {
  label: string;
  hint?: string;
  run: () => void;
}

export function ShortcutMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const toggleHeatmap = useStore((s) => s.toggleHeatmap);
  const setDisplay = useStore((s) => s.setDisplay);
  const setExplode = useStore((s) => s.setExplode);
  const explode = useStore((s) => s.explode);
  const isolate = useStore((s) => s.isolate);
  const clearSelection = useStore((s) => s.clearSelection);
  const setRollback = useStore((s) => s.setRollback);
  const features = useStore((s) => s.features);

  useEffect(() => {
    let cursor = { x: 0, y: 0 };

    const onMove = (e: MouseEvent) => {
      cursor = { x: e.clientX, y: e.clientY };
    };

    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select');
      if (typing) return;

      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setAt((current) => (current ? null : cursor));
      }
      if (e.key === 'Escape') setAt(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!at) return null;

  // Contextual, per the guide: the menu offers what is useful on this tab.
  const actions: Action[] =
    tab === 'mold'
      ? [
          { label: explode > 0 ? 'Collapse view' : 'Explode view', run: () => setExplode(explode > 0 ? 0 : 1) },
          { label: 'Translucent', run: () => setDisplay('translucent') },
          { label: 'Shaded with edges', run: () => setDisplay('shaded-edges') },
          { label: 'Show everything', run: () => isolate(null) },
          { label: 'Roll forward to end', run: () => setRollback(features.length) },
        ]
      : tab === 'part-studio'
        ? [
            { label: 'Toggle undercut heatmap', hint: 'green pulls, red is trapped', run: toggleHeatmap },
            { label: 'Translucent', run: () => setDisplay('translucent') },
            { label: 'Clear selection', hint: 'Space', run: clearSelection },
            { label: 'Go to Mold', run: () => setTab('mold') },
          ]
        : [
            { label: 'Back to Part Studio', run: () => setTab('part-studio') },
            { label: 'Go to Mold', run: () => setTab('mold') },
          ];

  // Keep the menu on screen when S is pressed near an edge.
  const x = Math.min(at.x, window.innerWidth - 200);
  const y = Math.min(at.y, window.innerHeight - actions.length * 28 - 20);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setAt(null)} />
      <div
        className="fixed z-50 w-48 overflow-hidden rounded-md border border-shell-600 bg-shell-800 py-1 shadow-2xl"
        style={{ left: x, top: y }}
        data-testid="shortcut-menu"
      >
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={() => {
              action.run();
              setAt(null);
            }}
            className="flex w-full items-baseline justify-between px-2.5 py-1 text-left text-xs text-ink-100 hover:bg-pick hover:text-white"
          >
            {action.label}
            {action.hint && <span className="ml-2 text-[9px] text-ink-500">{action.hint}</span>}
          </button>
        ))}
      </div>
    </>
  );
}
