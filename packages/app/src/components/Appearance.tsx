/**
 * The right-hand slide-outs (UI-UX.md §2F): Appearance, and the Configuration
 * table that turns one design into a family of them.
 *
 * The configuration table earns its place. The actual goal here is a rack of
 * plaster molds cycling through a casting rotation, so emitting the same mold at
 * three different clay shrinkages in one pass is the difference between a toy and
 * a production tool.
 */
import { useState } from 'react';
import { useStore } from '../state/store.ts';

export function Appearance({ onClose }: { onClose: () => void }) {
  const display = useStore((s) => s.display);
  const setDisplay = useStore((s) => s.setDisplay);
  const showHeatmap = useStore((s) => s.showHeatmap);
  const toggleHeatmap = useStore((s) => s.toggleHeatmap);
  const features = useStore((s) => s.features);
  const updateFeature = useStore((s) => s.updateFeature);
  const exportZip = useStore((s) => s.exportZip);
  const regenerate = useStore((s) => s.regenerate);
  const docName = useStore((s) => s.docName);

  const shrink = features.find((f) => f.type === 'shrink');
  const [variants, setVariants] = useState('11, 13, 15');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  /**
   * Emit one ZIP per variant, in turn. The geometry kernel is single-threaded, so
   * firing them off in parallel would only queue them behind each other anyway.
   */
  const runBatch = async () => {
    if (!shrink) return;

    const values = variants
      .split(',')
      .map((v) => parseFloat(v.trim()))
      .filter((v) => Number.isFinite(v) && v > 0 && v < 50);

    if (values.length === 0) return;

    setRunning(true);
    const original = shrink.params.shrinkage;

    try {
      for (const percent of values) {
        updateFeature(shrink.id, { shrinkage: percent / 100 });
        await regenerate();

        const blob = await exportZip();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${docName || 'slipcast'}-shrink-${percent}pct.zip`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setDone(`Exported ${values.length} molds.`);
    } finally {
      // Put the document back exactly as it was: a batch export is not an edit.
      updateFeature(shrink.id, { shrinkage: original });
      setRunning(false);
    }
  };

  return (
    <aside
      className="absolute right-9 top-0 z-30 flex h-full w-64 flex-col border-l border-shell-600 bg-shell-800"
      data-testid="appearance-panel"
    >
      <div className="flex items-center justify-between border-b border-shell-600 px-2.5 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-300">
          Appearance
        </span>
        <button onClick={onClose} className="text-ink-500 hover:text-ink-100" aria-label="Close">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="space-y-3 overflow-y-auto p-2.5">
        <label className="block">
          <span className="mb-1 block text-[11px] text-ink-300">Display style</span>
          <select
            value={display}
            onChange={(e) => setDisplay(e.target.value as never)}
            className="w-full rounded border border-shell-600 bg-shell-900 px-2 py-1 text-xs text-ink-100 outline-none focus:border-pick"
          >
            <option value="shaded">Shaded</option>
            <option value="shaded-edges">Shaded with edges</option>
            <option value="translucent">Translucent</option>
          </select>
        </label>

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={showHeatmap}
            onChange={toggleHeatmap}
            className="h-3.5 w-3.5 accent-[#2f81f7]"
          />
          <span className="text-[11px] text-ink-100">Undercut heatmap</span>
        </label>

        <div className="flex items-center gap-3 rounded border border-shell-600 bg-shell-900 p-2">
          <Swatch color="#6bc785" label="Releases" />
          <Swatch color="#f2b53f" label="Drags" />
          <Swatch color="#b82938" label="Trapped" />
        </div>

        <div className="h-px bg-shell-600" />

        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-300">
            Configurations
          </div>
          <p className="mb-2 text-[10px] leading-snug text-ink-500">
            One design, several molds. Give a list of clay shrinkages and get a ZIP
            for each, which is what you want when building a rack of molds for
            different clay bodies.
          </p>

          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-300">Shrinkage variants (%)</span>
            <input
              value={variants}
              onChange={(e) => setVariants(e.target.value)}
              className="w-full rounded border border-shell-600 bg-shell-900 px-2 py-1 font-mono text-xs text-ink-100 outline-none focus:border-pick"
              data-testid="variants"
            />
          </label>

          <button
            onClick={() => void runBatch()}
            disabled={running}
            data-testid="run-batch"
            className="mt-2 w-full rounded bg-pick px-2 py-1 text-xs text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {running ? 'Generating…' : 'Export every variant'}
          </button>

          {done && <p className="mt-1.5 text-[10px] text-ink-300">{done}</p>}
        </div>
      </div>
    </aside>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      <span className="text-[9px] text-ink-500">{label}</span>
    </div>
  );
}
