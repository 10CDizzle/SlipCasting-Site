/**
 * The context-sensitive ribbon (UI-UX.md §2A).
 *
 * The tools change with the active tab, the way Onshape's do: sketch tools in a
 * sketch, feature tools in a Part Studio. Here, Part Studio tools are about the
 * part, Mold tools are about the mold, and Export is about getting files out.
 */
import { useRef, useState } from 'react';
import { useStore } from '../state/store.ts';
import { VersionGraphPanel } from './VersionGraph.tsx';

export function Toolbar({ onExit }: { onExit: () => void }) {
  const tab = useStore((s) => s.tab);
  const docName = useStore((s) => s.docName);
  const display = useStore((s) => s.display);
  const perspective = useStore((s) => s.perspective);
  const showHeatmap = useStore((s) => s.showHeatmap);
  const explode = useStore((s) => s.explode);
  const busy = useStore((s) => s.busy);
  const regen = useStore((s) => s.regen);

  const setDisplay = useStore((s) => s.setDisplay);
  const togglePerspective = useStore((s) => s.togglePerspective);
  const toggleHeatmap = useStore((s) => s.toggleHeatmap);
  const setExplode = useStore((s) => s.setExplode);
  const openFile = useStore((s) => s.openFile);
  const exportZip = useStore((s) => s.exportZip);

  const fileInput = useRef<HTMLInputElement>(null);
  const [showVersions, setShowVersions] = useState(false);

  const download = async () => {
    const blob = await exportZip();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docName || 'slipcast'}-mold.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative flex h-11 shrink-0 items-center gap-1 border-b border-shell-600 bg-shell-800 px-2">
      {/* Back to the Documents page. Without this, a workspace opened on first boot
          is a room with no door. */}
      <button
        onClick={onExit}
        className="rounded p-1.5 text-ink-500 transition hover:bg-shell-700 hover:text-ink-100"
        title="Documents"
        aria-label="Back to documents"
        data-testid="back-to-documents"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
      </button>

      <button
        onClick={() => setShowVersions((v) => !v)}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-ink-100 hover:bg-shell-700"
        title="Versions and history"
        data-testid="doc-menu"
      >
        <span className="truncate max-w-[180px]">{docName || 'Untitled'}</span>
        <svg viewBox="0 0 24 24" className="h-3 w-3 text-ink-500" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" />
        </svg>
      </button>

      <div className="mx-1 h-5 w-px bg-shell-600" />

      {tab === 'part-studio' && (
        <>
          <ToolButton
            label="Import"
            onClick={() => fileInput.current?.click()}
            icon="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"
          />
          <input
            ref={fileInput}
            type="file"
            accept=".stl,.obj,.ply,.3mf,.step,.stp,.iges,.igs"
            className="hidden"
            data-testid="file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void openFile(file);
            }}
          />
          <Toggle label="Undercuts" active={showHeatmap} onClick={toggleHeatmap} testId="toggle-heatmap" />
        </>
      )}

      {tab === 'mold' && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-500">Explode</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={explode}
            onChange={(e) => setExplode(Number(e.target.value))}
            className="h-1 w-28 cursor-pointer appearance-none rounded bg-shell-600 accent-[#2f81f7]"
            data-testid="explode-slider"
            aria-label="Exploded view"
          />
        </div>
      )}

      {tab === 'instructions' && (
        <ToolButton
          label="Download ZIP"
          onClick={() => void download()}
          icon="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3M12 3v12m0 0l4-4m-4 4l-4-4"
          primary
          disabled={!regen?.ok}
          testId="download-zip"
        />
      )}

      <div className="flex-1" />

      {busy && (
        <span className="mr-2 flex items-center gap-1.5 text-[10px] text-ink-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pick" />
          working
        </span>
      )}

      {/* View options: display style and camera, per UI-UX.md §2D. */}
      <select
        value={display}
        onChange={(e) => setDisplay(e.target.value as never)}
        className="rounded border border-shell-600 bg-shell-900 px-1.5 py-1 text-[11px] text-ink-300 outline-none focus:border-pick"
        aria-label="Display style"
        data-testid="display-style"
      >
        <option value="shaded">Shaded</option>
        <option value="shaded-edges">Shaded with edges</option>
        <option value="translucent">Translucent</option>
      </select>

      <button
        onClick={togglePerspective}
        className="rounded border border-shell-600 px-1.5 py-1 text-[11px] text-ink-300 hover:bg-shell-700"
        title="Perspective or orthographic"
        data-testid="toggle-perspective"
      >
        {perspective ? 'Persp' : 'Ortho'}
      </button>

      {showVersions && <VersionGraphPanel onClose={() => setShowVersions(false)} />}
    </div>
  );
}

function ToolButton({
  label,
  icon,
  onClick,
  primary,
  disabled,
  testId,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={[
        'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition',
        primary
          ? 'bg-pick text-white hover:brightness-110'
          : 'text-ink-100 hover:bg-shell-700',
        disabled ? 'cursor-not-allowed opacity-40' : '',
      ].join(' ')}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d={icon} />
      </svg>
      {label}
    </button>
  );
}

function Toggle({
  label,
  active,
  onClick,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      data-active={active}
      className={[
        'rounded px-2 py-1 text-xs transition',
        active ? 'bg-pick-soft text-pick' : 'text-ink-300 hover:bg-shell-700',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
