/**
 * Feature dialogs (UI-UX.md §4).
 *
 * Tab moves between fields, Enter commits, Escape closes. Numeric fields are
 * sliders as well as inputs, so dragging one previews the change live -- that is
 * the "preview slider" from the guide, and it is only affordable because the regen
 * cache means most of those intermediate states have already been computed.
 */
import { useEffect, useRef } from 'react';
import type { Feature } from '@slipcast/engine';
import { useStore } from '../state/store.ts';

interface FieldSpec {
  key: string;
  label: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Array<{ value: string; label: string }>;
  type?: 'number' | 'select' | 'boolean';
  /** Show the raw value as a percentage. */
  percent?: boolean;
}

const FIELDS: Record<string, FieldSpec[]> = {
  import: [
    {
      key: 'units',
      label: 'Units',
      type: 'select',
      options: [
        { value: 'mm', label: 'Millimetres' },
        { value: 'cm', label: 'Centimetres' },
        { value: 'm', label: 'Metres' },
        { value: 'in', label: 'Inches' },
      ],
      hint: 'What the numbers in the file mean. Get this wrong and the mold comes out the wrong size.',
    },
  ],
  shrink: [
    {
      key: 'shrinkage',
      label: 'Clay shrinkage',
      min: 0,
      max: 0.25,
      step: 0.005,
      percent: true,
      hint: 'Total shrinkage, drying plus firing. Stoneware and porcelain run 10-15%, earthenware 5-10%. The mold is cut oversize by 1/(1-this), so the fired pot lands at the size you drew.',
    },
  ],
  pullDir: [
    {
      key: 'mode',
      label: 'Pull direction',
      type: 'select',
      options: [
        { value: 'auto', label: 'Find it for me' },
        { value: 'manual', label: 'I will choose' },
      ],
      hint: 'The axis the mold halves come apart along. Searching finds an axis with no undercuts, which is not always the obvious one -- a mug parts through its handle, not along its own axis.',
    },
    {
      key: 'minDraft',
      label: 'Minimum draft',
      min: 0,
      max: 15,
      step: 0.5,
      unit: '°',
      hint: 'Faces with less taper than this are flagged amber. They still release, but they drag against the plaster.',
    },
  ],
  block: [
    {
      key: 'wallThickness',
      label: 'Plaster thickness',
      min: 8,
      max: 60,
      step: 1,
      unit: 'mm',
      hint: 'How much plaster surrounds the part. Thin molds crack; thick molds are heavy and slow to dry.',
    },
    {
      key: 'blockStyle',
      label: 'Block shape',
      type: 'select',
      options: [
        { value: 'box', label: 'Rectangular block' },
        { value: 'conformal', label: 'Conformal (saves plaster)' },
      ],
    },
    {
      key: 'outerDraft',
      label: 'Outer draft',
      min: 0,
      max: 8,
      step: 0.5,
      unit: '°',
      hint: 'Taper on the outside walls so a printed tray lifts off the set plaster instead of suctioning onto it.',
    },
  ],
  spare: [
    {
      key: 'spareDiameter',
      label: 'Pour hole',
      min: 8,
      max: 80,
      step: 1,
      unit: 'mm',
      hint: 'Too narrow and the slip will not flow; too wide and you waste clay and leave a big scar to trim.',
    },
    {
      key: 'spareHeight',
      label: 'Reservoir height',
      min: 5,
      max: 120,
      step: 1,
      unit: 'mm',
      hint: 'The head of slip that keeps feeding the cast as the plaster draws water out and the level drops.',
    },
  ],
  split: [
    {
      key: 'split',
      label: 'Two-part mold',
      type: 'boolean',
      hint: 'Off gives a single open mold, which is all a simple tapered form needs.',
    },
  ],
  keys: [
    {
      key: 'keyCount',
      label: 'Registration keys',
      min: 0,
      max: 8,
      step: 1,
      hint: 'Natches: the cones and sockets that make the halves seat the same way every time.',
    },
    { key: 'keyDiameter', label: 'Key size', min: 5, max: 30, step: 1, unit: 'mm' },
    {
      key: 'keyClearance',
      label: 'Key clearance',
      min: 0,
      max: 1.5,
      step: 0.05,
      unit: 'mm',
      hint: 'The gap between cone and socket. Zero and the halves bind on plaster that has swollen a hair.',
    },
  ],
  output: [
    {
      key: 'mode',
      label: 'What to print',
      type: 'select',
      options: [
        { value: 'shells', label: 'Trays — pour plaster IN' },
        { value: 'positive', label: 'The part — pour plaster AROUND it' },
      ],
      hint: 'Trays are reusable: print once, cast as many plaster molds as you want. The positive is the traditional route.',
    },
    { key: 'shellWall', label: 'Tray wall', min: 1.5, max: 8, step: 0.5, unit: 'mm' },
  ],
};

export function FeatureDialog({ feature }: { feature: Feature }) {
  const updateFeature = useStore((s) => s.updateFeature);
  const setEditing = useStore((s) => s.setEditing);
  const picking = useStore((s) => s.picking);
  const cancelPicking = useStore((s) => s.cancelPicking);
  const first = useRef<HTMLElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, [feature.id]);

  const fields = FIELDS[feature.type] ?? [];

  return (
    <div
      className="border-t border-shell-600 bg-shell-800"
      data-testid={`dialog-${feature.type}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          // Escape backs out one step at a time. With a field armed, it disarms the
          // field; it does not also slam the dialog shut and take the field with it.
          if (picking) {
            cancelPicking();
            e.stopPropagation();
          } else {
            setEditing(null);
          }
        }
        if (e.key === 'Enter' && !e.shiftKey && !picking) setEditing(null);
      }}
    >
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-300">
          {feature.name}
        </span>
        <button
          onClick={() => setEditing(null)}
          className="text-ink-500 hover:text-ink-100"
          title="Close (Esc)"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="space-y-2.5 px-2.5 pb-3">
        {fields.length === 0 && (
          <p className="text-[11px] text-ink-500">Nothing to adjust on this feature.</p>
        )}

        {/* The spare's position is a viewport pick, not a number you type. */}
        {feature.type === 'spare' && <SparePlacement feature={feature} />}

        {fields.map((field, i) => (
          <Field
            key={field.key}
            spec={field}
            value={feature.params[field.key]}
            autoFocus={i === 0}
            onChange={(value) => updateFeature(feature.id, { [field.key]: value })}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The pour spare's position: a selection field, not a number field.
 *
 * Straight out of UI-UX.md §4 -- the primary input is highlighted blue and waits for
 * you to click the model. Typing coordinates into a box would be a strange way to
 * say "put the hole here", and nobody knows where (22.4, -3.1) is on their own pot.
 */
function SparePlacement({ feature }: { feature: Feature }) {
  const picking = useStore((s) => s.picking);
  const startPicking = useStore((s) => s.startPicking);
  const cancelPicking = useStore((s) => s.cancelPicking);
  const updateFeature = useStore((s) => s.updateFeature);

  const position = feature.params.sparePosition as [number, number, number] | null | undefined;
  const pour = feature.params.pourDirection as [number, number, number] | null | undefined;
  const armed = picking === 'spare';

  const POUR_AXES: Array<{ id: string; label: string; value: [number, number, number] | null }> = [
    { id: 'auto', label: "The part's own up (+Z)", value: null },
    { id: 'x', label: '+X', value: [1, 0, 0] },
    { id: 'y', label: '+Y', value: [0, 1, 0] },
    { id: 'z', label: '+Z', value: [0, 0, 1] },
  ];

  const current = pour
    ? (POUR_AXES.find((a) => a.value && a.value.every((v, i) => v === pour[i]))?.id ?? 'auto')
    : 'auto';

  return (
    <div className="space-y-2.5">
      {/*
        Which way is UP when the mold stands on the bench being filled. This is NOT
        the axis the mold opens along, and conflating the two is a real mistake: a
        mug's mold opens sideways through the handle but is filled from the rim.
      */}
      <label className="block">
        <span className="mb-1 block text-[11px] text-ink-300">Fill from</span>
        <select
          value={current}
          onChange={(e) => {
            const axis = POUR_AXES.find((a) => a.id === e.target.value);
            updateFeature(feature.id, { pourDirection: axis?.value ?? null });
          }}
          data-testid="field-pourDirection"
          className="w-full rounded border border-shell-600 bg-shell-900 px-2 py-1 text-xs text-ink-100 outline-none focus:border-pick"
        >
          {POUR_AXES.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[10px] leading-snug text-ink-500">
          Which way is up when the mold stands on the bench. Not the same as the axis it
          opens along — a mug&apos;s mold opens sideways through the handle but is filled
          from the rim. Models are drawn standing up, so the default is almost always right.
        </p>
      </label>

      <div>
      <span className="mb-1 block text-[11px] text-ink-300">Position</span>

      <button
        onClick={() => (armed ? cancelPicking() : startPicking('spare'))}
        data-testid="pick-spare"
        data-armed={armed}
        className={[
          'flex w-full items-center gap-1.5 rounded border px-2 py-1 text-left text-[11px] transition',
          armed
            ? 'border-pick bg-pick-soft text-pick'
            : 'border-shell-600 bg-shell-900 text-ink-100 hover:border-shell-500',
        ].join(' ')}
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          <circle cx="12" cy="12" r="3.5" />
        </svg>

        {armed ? (
          <span className="animate-pulse">Click the part…</span>
        ) : position ? (
          <span className="font-mono tabular-nums">
            {position.map((v) => v.toFixed(0)).join(', ')} mm
          </span>
        ) : (
          <span>The rim (highest point)</span>
        )}
      </button>

      {position && !armed && (
        <button
          onClick={() => updateFeature(feature.id, { sparePosition: null })}
          className="mt-1 text-[10px] text-ink-500 underline-offset-2 hover:text-ink-100 hover:underline"
          data-testid="reset-spare"
        >
          Back to automatic
        </button>
      )}

      <p className="mt-1 text-[10px] leading-snug text-ink-500">
        Where the slip goes in. The default is the highest point measured up the fill
        axis — the rim of a cup or a mug. A teapot might want it on the foot instead.
      </p>
      </div>
    </div>
  );
}

function Field({
  spec,
  value,
  autoFocus,
  onChange,
}: {
  spec: FieldSpec;
  value: unknown;
  autoFocus: boolean;
  onChange: (v: unknown) => void;
}) {
  const id = `field-${spec.key}`;

  if (spec.type === 'select') {
    return (
      <label className="block" htmlFor={id}>
        <span className="mb-1 block text-[11px] text-ink-300">{spec.label}</span>
        <select
          id={id}
          data-testid={id}
          autoFocus={autoFocus}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-shell-600 bg-shell-900 px-2 py-1 text-xs text-ink-100 outline-none focus:border-pick"
        >
          {spec.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {spec.hint && <p className="mt-1 text-[10px] leading-snug text-ink-500">{spec.hint}</p>}
      </label>
    );
  }

  if (spec.type === 'boolean') {
    return (
      <label className="flex cursor-pointer items-start gap-2" htmlFor={id}>
        <input
          id={id}
          data-testid={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-[#2f81f7]"
        />
        <span>
          <span className="block text-[11px] text-ink-100">{spec.label}</span>
          {spec.hint && <span className="mt-0.5 block text-[10px] leading-snug text-ink-500">{spec.hint}</span>}
        </span>
      </label>
    );
  }

  const numeric = Number(value ?? 0);
  const shown = spec.percent ? (numeric * 100).toFixed(1) : String(numeric);

  return (
    <label className="block" htmlFor={id}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] text-ink-300">{spec.label}</span>
        <span className="font-mono text-[11px] tabular-nums text-ink-100">
          {shown}
          {spec.percent ? '%' : (spec.unit ?? '')}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* The preview slider from the guide: drag it and the model updates live. */}
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={numeric}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded bg-shell-600 accent-[#2f81f7]"
          aria-label={`${spec.label} slider`}
        />
        <input
          id={id}
          data-testid={id}
          autoFocus={autoFocus}
          type="number"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={numeric}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-16 rounded border border-shell-600 bg-shell-900 px-1.5 py-0.5 text-right font-mono text-[11px] tabular-nums text-ink-100 outline-none focus:border-pick"
        />
      </div>

      {spec.hint && <p className="mt-1 text-[10px] leading-snug text-ink-500">{spec.hint}</p>}
    </label>
  );
}
