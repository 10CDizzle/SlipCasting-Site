/**
 * The Document Workspace (UI-UX.md §2): the zones assembled.
 *
 * Left panel over Feature List and Parts List, graphics area in the middle taking
 * everything it can, tabs along the bottom, slide-outs on the right, properties in
 * the bottom-right corner.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../state/store.ts';
import { Viewport } from './Viewport.tsx';
import { Toolbar } from './Toolbar.tsx';
import { FeatureList } from './FeatureList.tsx';
import { FeatureDialog } from './FeatureDialog.tsx';
import { PartsList } from './PartsList.tsx';
import { MassProperties } from './MassProperties.tsx';
import { ShortcutMenu } from './ShortcutMenu.tsx';
import { Appearance } from './Appearance.tsx';
import { Instructions } from './Instructions.tsx';

const TABS: Array<{ id: 'part-studio' | 'mold' | 'instructions'; label: string }> = [
  { id: 'part-studio', label: 'Part Studio' },
  { id: 'mold', label: 'Mold' },
  { id: 'instructions', label: 'Instructions' },
];

export function Workspace({ onExit }: { onExit: () => void }) {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const features = useStore((s) => s.features);
  const editing = useStore((s) => s.editing);
  const regen = useStore((s) => s.regen);
  const fatal = useStore((s) => s.fatal);

  const [panel, setPanel] = useState<'appearance' | null>(null);
  const editingFeature = features.find((f) => f.id === editing);

  // Mobile: the left panel collapses so the graphics area keeps the screen.
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (window.innerWidth >= 768) setDrawer(true);
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-shell-900 text-ink-100">
      <Toolbar onExit={onExit} />

      <div className="relative flex min-h-0 flex-1">
        {/* Left: Feature List over Parts List */}
        <aside
          className={[
            'z-20 flex w-60 shrink-0 flex-col border-r border-shell-600 bg-shell-800',
            'max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:transition-transform',
            drawer ? '' : 'max-md:-translate-x-full',
          ].join(' ')}
        >
          <div className="flex items-center justify-between border-b border-shell-600 px-2.5 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-300">
              Features
            </span>
            <button
              onClick={() => setDrawer(false)}
              className="text-ink-500 hover:text-ink-100 md:hidden"
              aria-label="Close panel"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <FeatureList />
          </div>

          {editingFeature && <FeatureDialog feature={editingFeature} />}

          <div className="max-h-[38%] shrink-0 overflow-y-auto border-t border-shell-600">
            <PartsList />
          </div>
        </aside>

        {/* Centre: graphics area */}
        <main className="relative min-w-0 flex-1">
          {tab === 'instructions' ? <Instructions /> : <Viewport />}

          {!drawer && (
            <button
              onClick={() => setDrawer(true)}
              className="absolute left-2 top-2 z-10 rounded border border-shell-600 bg-shell-800/90 p-1.5 md:hidden"
              aria-label="Open features"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
              </svg>
            </button>
          )}

          {fatal && (
            <div
              className="pointer-events-auto absolute left-1/2 top-4 z-20 w-[min(560px,90%)] -translate-x-1/2 rounded-md border border-danger/50 bg-[#2a1216] p-3 shadow-xl"
              data-testid="fatal"
            >
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-danger">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 8v5M12 16.5v.5M10.3 3.9L2.5 18a2 2 0 001.7 3h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                This part cannot be molded as drawn
              </div>
              <p className="text-[11px] leading-relaxed text-ink-300">{fatal}</p>
            </div>
          )}

          {regen?.warnings && regen.warnings.length > 0 && !fatal && (
            <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-sm space-y-1">
              {regen.warnings.slice(0, 2).map((w, i) => (
                <div
                  key={i}
                  className="rounded border border-shell-600 bg-shell-800/95 px-2 py-1 text-[10px] leading-snug text-ink-300 backdrop-blur"
                  data-testid="warning"
                >
                  {w}
                </div>
              ))}
            </div>
          )}

          {tab !== 'instructions' && <MassProperties />}
        </main>

        {/* Right: slide-out panels */}
        <aside className="z-20 flex w-9 shrink-0 flex-col items-center gap-1 border-l border-shell-600 bg-shell-800 py-2">
          <RailButton
            active={panel === 'appearance'}
            onClick={() => setPanel(panel === 'appearance' ? null : 'appearance')}
            title="Appearance and configurations"
            icon="M12 3a9 9 0 100 18 2 2 0 002-2v-1a2 2 0 012-2h1a3 3 0 003-3 9 9 0 00-9-10z"
          />
        </aside>

        {panel === 'appearance' && <Appearance onClose={() => setPanel(null)} />}
      </div>

      {/* Bottom: the Tabs Manager */}
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-t border-shell-600 bg-shell-800 px-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            data-testid={`tab-${t.id}`}
            data-active={tab === t.id}
            className={[
              'rounded-t px-2.5 py-1 text-[11px] transition',
              tab === t.id
                ? 'bg-shell-900 text-ink-100'
                : 'text-ink-500 hover:bg-shell-700 hover:text-ink-300',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <span className="pr-1.5 text-[9px] text-ink-500">
          press <kbd className="rounded bg-shell-700 px-1 font-mono">S</kbd> for shortcuts
        </span>
      </div>

      <ShortcutMenu />
    </div>
  );
}

function RailButton({
  active,
  onClick,
  title,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  icon: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={[
        'rounded p-1.5 transition',
        active ? 'bg-pick-soft text-pick' : 'text-ink-500 hover:bg-shell-700 hover:text-ink-100',
      ].join(' ')}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d={icon} />
      </svg>
    </button>
  );
}
