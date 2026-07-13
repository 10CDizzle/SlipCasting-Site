/**
 * The Feature List and the Rollback Bar (UI-UX.md §2B).
 *
 * The chronological, parametric history of the mold. You can drag features to
 * reorder them, and you are allowed to drag them somewhere illegal -- the feature
 * turns red and tells you what it needed, exactly as Onshape does. Refusing the
 * drag would be less honest and much more irritating: you would be left guessing
 * why the tool would not let you do the thing you asked for.
 *
 * The Rollback Bar sits between two features. Drag it upward and the model
 * regenerates as it was at that point in its history, so you can insert a feature
 * in the middle of the sequence instead of only ever at the end.
 */
import { useState } from 'react';
import { FEATURE_SPECS, type Feature } from '@slipcast/engine';
import { useStore } from '../state/store.ts';

const ICONS: Record<string, string> = {
  import: 'M12 3v12m0 0l-4-4m4 4l4-4M4 19h16',
  shrink: 'M4 4l6 6M20 4l-6 6M4 20l6-6M20 20l-6-6',
  pullDir: 'M12 20V4m0 0l-5 5m5-5l5 5',
  block: 'M4 8l8-4 8 4v8l-8 4-8-4V8z',
  spare: 'M6 4h12l-4 7v7l-4 2v-9L6 4z',
  split: 'M3 12h18M8 6l-3 6 3 6M16 6l3 6-3 6',
  keys: 'M9 12a3 3 0 106 0 3 3 0 00-6 0zM4 12h5m6 0h5',
  output: 'M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3M12 3v12m0 0l4-4m-4 4l-4-4',
};

function FeatureIcon({ type }: { type: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[type] ?? ICONS.block!} />
    </svg>
  );
}

export function FeatureList() {
  const features = useStore((s) => s.features);
  const rollbackTo = useStore((s) => s.rollbackTo);
  const editing = useStore((s) => s.editing);
  const regen = useStore((s) => s.regen);
  const setEditing = useStore((s) => s.setEditing);
  const setRollback = useStore((s) => s.setRollback);
  const reorderFeature = useStore((s) => s.reorderFeature);
  const toggleSuppressed = useStore((s) => s.toggleSuppressed);

  const [dragging, setDragging] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const errors = new Map((regen?.errors ?? []).map((e) => [e.featureId, e.message]));

  if (features.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-ink-500">
        Import a model to begin.
      </div>
    );
  }

  const commitDrag = () => {
    if (dragging !== null && dropAt !== null && dragging !== dropAt) {
      reorderFeature(dragging, dropAt > dragging ? dropAt - 1 : dropAt);
    }
    setDragging(null);
    setDropAt(null);
  };

  return (
    <div className="select-none" data-testid="feature-list">
      {features.map((feature, i) => (
        <div key={feature.id}>
          {dropAt === i && dragging !== null && (
            <div className="mx-2 h-0.5 rounded bg-pick" />
          )}
          <FeatureRow
            feature={feature}
            index={i}
            rolledBack={i >= rollbackTo}
            error={errors.get(feature.id)}
            active={editing === feature.id}
            onEdit={() => setEditing(editing === feature.id ? null : feature.id)}
            onSuppress={() => toggleSuppressed(feature.id)}
            onDragStart={() => setDragging(i)}
            onDragOver={(e) => {
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              const below = e.clientY > rect.top + rect.height / 2;
              setDropAt(below ? i + 1 : i);
            }}
            onDrop={commitDrag}
            onDragEnd={commitDrag}
          />
          {/* The Rollback Bar lives between rows -- it is a point in history, not a
              row. The handle below the LAST feature is the end of history, which is
              where the bar sits by default: showing it as "rolled back" there would
              be a lie, and an alarming one. */}
          <RollbackHandle
            active={rollbackTo === i + 1 && i + 1 < features.length}
            onClick={() => setRollback(rollbackTo === i + 1 ? features.length : i + 1)}
          />
        </div>
      ))}
    </div>
  );
}

function RollbackHandle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative flex h-1.5 w-full items-center"
      title={active ? 'Roll forward to the end' : 'Roll the model back to here'}
      data-testid="rollback-handle"
      data-active={active}
    >
      {active ? (
        <div className="flex w-full items-center gap-1 px-1.5">
          <div className="h-[3px] flex-1 rounded-full bg-pick" />
          <span className="text-[9px] font-semibold uppercase tracking-wide text-pick">
            rolled back
          </span>
          <div className="h-[3px] flex-1 rounded-full bg-pick" />
        </div>
      ) : (
        <div className="mx-1.5 h-[2px] w-full rounded-full bg-transparent transition group-hover:bg-pick/40" />
      )}
    </button>
  );
}

function FeatureRow({
  feature,
  index,
  rolledBack,
  error,
  active,
  onEdit,
  onSuppress,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  feature: Feature;
  index: number;
  rolledBack: boolean;
  error?: string;
  active: boolean;
  onEdit: () => void;
  onSuppress: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const spec = FEATURE_SPECS[feature.type];

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onEdit}
      data-testid={`feature-${feature.type}`}
      data-error={error ? 'true' : 'false'}
      className={[
        'group flex cursor-pointer items-center gap-2 border-l-2 px-2.5 py-[5px] text-xs transition',
        active ? 'border-pick bg-pick-soft' : 'border-transparent hover:bg-shell-700',
        error ? 'border-danger bg-danger/10' : '',
        rolledBack || feature.suppressed ? 'opacity-40' : '',
      ].join(' ')}
      title={error ?? spec?.label}
    >
      <span className={error ? 'text-danger' : 'text-ink-500'}>
        <FeatureIcon type={feature.type} />
      </span>

      <span
        className={[
          'flex-1 truncate',
          error ? 'text-danger' : 'text-ink-100',
          feature.suppressed ? 'line-through' : '',
        ].join(' ')}
      >
        {feature.name}
      </span>

      {error && (
        <span
          className="shrink-0 rounded bg-danger/20 px-1 text-[9px] font-bold text-danger"
          data-testid="feature-error"
        >
          !
        </span>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          onSuppress();
        }}
        className="shrink-0 text-ink-500 opacity-0 transition hover:text-ink-100 group-hover:opacity-100"
        title={feature.suppressed ? 'Unsuppress' : 'Suppress'}
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
          {feature.suppressed ? (
            <path d="M3 3l18 18M10.6 5.1A9 9 0 0121 12a9 9 0 01-1.6 2.6M6.6 6.6A9 9 0 003 12a9 9 0 0012.4 5.4" strokeLinecap="round" />
          ) : (
            <>
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="2.6" />
            </>
          )}
        </svg>
      </button>

      <span className="w-4 shrink-0 text-right text-[9px] tabular-nums text-ink-500">
        {index + 1}
      </span>
    </div>
  );
}
