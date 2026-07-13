/**
 * The Documents page (UI-UX.md §1).
 *
 * Onshape's dashboard: filters down the left, a searchable grid in the middle, a
 * Create button as the primary call to action. A Document here is a container --
 * the part, its feature tree, its version history -- not a single file.
 *
 * There is no server and no account. This list lives in your browser, which is why
 * you can drop a proprietary part file into this tool without it going anywhere.
 */
import { useEffect, useState } from 'react';
import { fixtures, toSTL } from '@slipcast/engine';
import {
  deleteForever,
  listDocuments,
  loadFile,
  restoreDocument,
  trashDocument,
  type DocumentRecord,
} from '../state/db.ts';
import { useStore } from '../state/store.ts';

type Filter = 'recent' | 'samples' | 'trash';

type SampleName = 'cup' | 'mug' | 'torus' | 'sealed';

const SAMPLES: Record<SampleName, () => Promise<import('@slipcast/engine').MeshData>> = {
  cup: async () => fixtures.cup(),
  mug: () => fixtures.handledMug(),
  torus: async () => fixtures.torus(),
  // Deliberately impossible. A sealed internal void cannot be reached from any
  // direction, and the only honest thing the tool can do is say so.
  sealed: () => fixtures.hollowSphere(),
};

export function Documents({ onOpen }: { onOpen: () => void }) {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [filter, setFilter] = useState<Filter>('recent');
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);

  const openFile = useStore((s) => s.openFile);
  const loadDocument = useStore((s) => s.loadDocument);
  const busy = useStore((s) => s.busy);

  const refresh = () => void listDocuments(true).then(setDocs);
  useEffect(refresh, []);

  const open = async (file: File) => {
    await openFile(file);
    onOpen();
  };

  const openSample = async (name: SampleName) => {
    // A sample is a real STL, generated on the spot and pushed through the same
    // import path as any other file. Whatever breaks for a sample breaks for a
    // real model too -- there is no privileged route through this app.
    const mesh = await SAMPLES[name]();
    const bytes = toSTL(mesh);
    await open(new File([bytes as BlobPart], `${name}.stl`, { type: 'model/stl' }));
  };

  const visible = docs
    .filter((d) => (filter === 'trash' ? d.trashed : !d.trashed))
    .filter((d) => d.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div
      className="flex h-dvh flex-col bg-shell-900 text-ink-100"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void open(file);
      }}
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-shell-600 bg-shell-800 px-4">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-sm font-semibold">SlipCast</span>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents…"
          className="ml-4 w-72 rounded border border-shell-600 bg-shell-900 px-2.5 py-1 text-xs outline-none placeholder:text-ink-500 focus:border-pick"
          data-testid="search"
        />

        <div className="flex-1" />

        <label className="cursor-pointer rounded bg-pick px-3 py-1.5 text-xs font-medium text-white hover:brightness-110">
          Import model
          <input
            type="file"
            accept=".stl,.obj,.ply,.3mf,.step,.stp,.iges,.igs"
            className="hidden"
            data-testid="import-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void open(file);
            }}
          />
        </label>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-44 shrink-0 border-r border-shell-600 bg-shell-800 p-2">
          {(
            [
              ['recent', 'Recently opened'],
              ['samples', 'Samples'],
              ['trash', 'Trash'],
            ] as Array<[Filter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              data-testid={`filter-${key}`}
              className={[
                'mb-0.5 w-full rounded px-2 py-1.5 text-left text-xs transition',
                filter === key ? 'bg-pick-soft text-pick' : 'text-ink-300 hover:bg-shell-700',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {busy && (
            <div className="mb-3 text-xs text-ink-500">Reading the model…</div>
          )}

          {filter === 'samples' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
              <SampleCard
                title="Tapered cup"
                blurb="The happy path. Parts along its own axis, needs no split."
                onClick={() => void openSample('cup')}
                testId="sample-cup"
              />
              <SampleCard
                title="Handled mug"
                blurb="Un-moldable along its axis. Watch it find the seam through the handle instead — where a potter would put it."
                onClick={() => void openSample('mug')}
                testId="sample-mug"
              />
              <SampleCard
                title="Torus"
                blurb="Parts cleanly at its equator, and not at all across its hole."
                onClick={() => void openSample('torus')}
                testId="sample-torus"
              />
              <SampleCard
                title="Sealed void"
                blurb="Impossible on purpose. Nothing can mold an enclosed cavity, and the tool will refuse rather than hand you a file that looks right."
                onClick={() => void openSample('sealed')}
                testId="sample-sealed"
              />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm text-ink-300">
                {filter === 'trash' ? 'Nothing in the trash.' : 'No documents yet.'}
              </p>
              {filter !== 'trash' && (
                <p className="max-w-sm text-xs leading-relaxed text-ink-500">
                  Drop an STL, OBJ, 3MF or STEP anywhere on this page — or open a sample
                  to see what the tool does. Nothing is uploaded; it all runs here in
                  your browser.
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
              {visible.map((doc) => (
                <div
                  key={doc.id}
                  className="group rounded-md border border-shell-600 bg-shell-800 p-3 transition hover:border-shell-500"
                  data-testid="doc-card"
                >
                  <button
                    onClick={async () => {
                      const file = await loadFile(doc.fileId);
                      if (!file) return;
                      await loadDocument(doc, file.bytes);
                      onOpen();
                    }}
                    className="block w-full text-left"
                    disabled={doc.trashed}
                  >
                    <div className="mb-2 flex h-20 items-center justify-center rounded bg-shell-900">
                      <Logo dim />
                    </div>
                    <div className="truncate text-xs font-medium">{doc.name}</div>
                    <div className="text-[10px] text-ink-500">
                      {new Date(doc.updatedAt).toLocaleDateString()}
                    </div>
                  </button>

                  <div className="mt-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                    {doc.trashed ? (
                      <>
                        <MiniButton onClick={() => void restoreDocument(doc.id).then(refresh)}>
                          Restore
                        </MiniButton>
                        <MiniButton danger onClick={() => void deleteForever(doc.id).then(refresh)}>
                          Delete
                        </MiniButton>
                      </>
                    ) : (
                      <MiniButton onClick={() => void trashDocument(doc.id).then(refresh)}>
                        Trash
                      </MiniButton>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-shell-900/80">
          <div className="rounded-lg border-2 border-dashed border-pick px-8 py-6 text-sm text-pick">
            Drop to import
          </div>
        </div>
      )}
    </div>
  );
}

function SampleCard({
  title,
  blurb,
  onClick,
  testId,
}: {
  title: string;
  blurb: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="rounded-md border border-shell-600 bg-shell-800 p-3 text-left transition hover:border-pick"
    >
      <div className="mb-2 flex h-20 items-center justify-center rounded bg-shell-900">
        <Logo dim />
      </div>
      <div className="text-xs font-medium">{title}</div>
      <div className="mt-0.5 text-[10px] leading-snug text-ink-500">{blurb}</div>
    </button>
  );
}

function MiniButton({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'rounded px-1.5 py-0.5 text-[10px] transition',
        danger ? 'text-danger hover:bg-danger/15' : 'text-ink-500 hover:bg-shell-700 hover:text-ink-100',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Logo({ dim }: { dim?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={dim ? 'h-8 w-8 opacity-25' : 'h-5 w-5'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      {/* A mold: two halves, parted, with the pour spare on top. */}
      <path d="M11 6h10l-1 3h-8l-1-3z" className="text-pick" stroke="currentColor" />
      <path d="M6 12h20v7H6zM6 21h20v7H6z" />
      <path d="M13 12v7M19 12v7" opacity="0.45" />
    </svg>
  );
}
