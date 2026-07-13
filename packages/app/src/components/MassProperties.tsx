/**
 * The bottom-right corner (UI-UX.md §2G).
 *
 * Onshape puts mass properties here: click something and the numbers appear
 * without hunting for a tool. The direct translation for this domain is not mass
 * -- it is the recipe. How much plaster to weigh out, how much water to measure,
 * how much slip to have mixed. Those are the numbers you actually need, and they
 * are one boolean away from the geometry that is already on screen.
 */
import { plasterMix, slipEstimate } from '@slipcast/engine';
import { useStore } from '../state/store.ts';

export function MassProperties() {
  const regen = useStore((s) => s.regen);
  const busy = useStore((s) => s.busy);

  if (!regen?.volumes) return null;

  const mix = plasterMix(regen.volumes.plasterMm3);
  const slip = slipEstimate(regen.volumes.cavityMm3, 0, 4);

  const draft = regen.draftArea;
  const total = draft ? draft.ok + draft.shallow + draft.undercut : 0;
  const shallowPct = draft && total > 0 ? (draft.shallow / total) * 100 : 0;

  return (
    <div
      className="pointer-events-auto absolute bottom-3 right-3 w-60 rounded-md border border-shell-600 bg-shell-800/95 p-2.5 shadow-xl backdrop-blur"
      data-testid="mass-properties"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-300">
          Mold properties
        </span>
        {busy && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pick" />}
      </div>

      <Row label="Plaster" value={`${mix.plasterKg.toFixed(2)} kg`} strong />
      <Row label="Water" value={`${mix.waterLitres.toFixed(2)} L`} strong />
      <Row label="Mold volume" value={`${mix.volumeLitres.toFixed(2)} L`} />

      <div className="my-2 h-px bg-shell-600" />

      <Row label="Slip to fill" value={`${slip.fillLitres.toFixed(2)} L`} />
      <Row
        label="Consistency"
        value={`${mix.consistency} : 100`}
        hint="parts water to plaster, by weight"
      />

      {draft && (
        <>
          <div className="my-2 h-px bg-shell-600" />
          <DraftBar draft={draft} />
          {draft.undercut > 0 ? (
            <p className="mt-1.5 text-[10px] leading-snug text-draft-undercut">
              This part cannot be molded along this axis.
            </p>
          ) : shallowPct > 5 ? (
            <p className="mt-1.5 text-[10px] leading-snug text-ink-500">
              {shallowPct.toFixed(0)}% of the surface will drag on the plaster.
            </p>
          ) : (
            <p className="mt-1.5 text-[10px] leading-snug text-ink-500">
              Every surface releases cleanly.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-[2px]">
      <span className="text-[11px] text-ink-500">{label}</span>
      <span
        className={[
          'font-mono text-[11px] tabular-nums',
          strong ? 'font-semibold text-ink-100' : 'text-ink-300',
        ].join(' ')}
        title={hint}
      >
        {value}
      </span>
    </div>
  );
}

function DraftBar({ draft }: { draft: { ok: number; shallow: number; undercut: number } }) {
  const total = draft.ok + draft.shallow + draft.undercut || 1;
  const segments = [
    { key: 'ok', value: draft.ok, color: 'bg-draft-ok', label: 'Releases cleanly' },
    { key: 'shallow', value: draft.shallow, color: 'bg-draft-shallow', label: 'Drags' },
    { key: 'undercut', value: draft.undercut, color: 'bg-draft-undercut', label: 'Trapped' },
  ];

  return (
    <div>
      <div className="mb-1 flex h-1.5 overflow-hidden rounded-full bg-shell-900">
        {segments.map((s) => (
          <div
            key={s.key}
            className={s.color}
            style={{ width: `${(s.value / total) * 100}%` }}
            title={`${s.label}: ${((s.value / total) * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-ink-500">
        <span>Draft</span>
        <span>{((draft.ok / total) * 100).toFixed(0)}% clean</span>
      </div>
    </div>
  );
}
