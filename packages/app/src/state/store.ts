/**
 * The workspace store.
 *
 * Holds the feature list, the rollback point, the selection, and the last
 * regeneration. Every geometry call goes through the worker; nothing in here
 * touches Manifold.
 */
import { create } from 'zustand';
import * as Comlink from 'comlink';
import {
  commit as commitVersion,
  createGraph,
  defaultFeatures,
  merge as mergeFeatures,
  validate,
  type Feature,
  type VersionGraph,
} from '@slipcast/engine';
import type { EngineApi, RegenView } from '../worker/engine.worker.ts';
import { newId, saveDocument, storeFile, type DocumentRecord } from './db.ts';

const worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), {
  type: 'module',
});
export const engine = Comlink.wrap<EngineApi>(worker);

export type Tab = 'part-studio' | 'mold' | 'instructions';
export type DisplayStyle = 'shaded' | 'shaded-edges' | 'translucent';

export interface State {
  docId: string | null;
  docName: string;
  fileId: string | null;

  features: Feature[];
  /** Features at or after this index are rolled back: not evaluated, greyed out. */
  rollbackTo: number;
  versions: VersionGraph | null;

  /** The feature whose dialog is open. */
  editing: string | null;
  /** Additive selection, per Onshape: clicking adds, Spacebar clears. */
  selection: string[];
  hidden: Set<string>;
  isolated: string | null;

  tab: Tab;
  display: DisplayStyle;
  perspective: boolean;
  showHeatmap: boolean;
  explode: number;

  busy: boolean;
  regen: RegenView | null;
  /** Set when the engine refuses the part outright. */
  fatal: string | null;

  // --- actions
  openFile: (file: File) => Promise<void>;
  loadDocument: (doc: DocumentRecord, bytes: ArrayBuffer) => Promise<void>;
  updateFeature: (id: string, params: Record<string, unknown>) => void;
  renameFeature: (id: string, name: string) => void;
  reorderFeature: (from: number, to: number) => void;
  toggleSuppressed: (id: string) => void;
  setRollback: (index: number) => void;
  setEditing: (id: string | null) => void;

  select: (id: string, additive: boolean) => void;
  clearSelection: () => void;
  toggleHidden: (id: string) => void;
  isolate: (id: string | null) => void;

  setTab: (tab: Tab) => void;
  setDisplay: (d: DisplayStyle) => void;
  togglePerspective: () => void;
  toggleHeatmap: () => void;
  setExplode: (v: number) => void;

  regenerate: () => Promise<void>;
  saveVersion: (name: string) => void;
  mergeFrom: (versionId: string) => { conflicts: number };
  exportZip: () => Promise<Blob>;
  /** Write the document back to IndexedDB. Called after anything worth keeping. */
  persist: () => void;
}

export const useStore = create<State>((set, get) => ({
  docId: null,
  docName: 'Untitled',
  fileId: null,

  features: [],
  rollbackTo: 0,
  versions: null,

  editing: null,
  selection: [],
  hidden: new Set(),
  isolated: null,

  tab: 'part-studio',
  display: 'shaded-edges',
  perspective: true,
  showHeatmap: true,
  explode: 0,

  busy: false,
  regen: null,
  fatal: null,

  async openFile(file) {
    set({ busy: true, fatal: null });
    try {
      const bytes = await file.arrayBuffer();
      const fileId = await storeFile(file.name, bytes.slice(0));

      // The worker keeps the mesh; the main thread never holds a copy.
      await engine.importModel(fileId, file.name, bytes, 'mm');

      const features = defaultFeatures(fileId, file.name);
      const docId = newId();

      set({
        docId,
        docName: file.name.replace(/\.[^.]+$/, ''),
        fileId,
        features,
        rollbackTo: features.length,
        versions: createGraph(features),
        tab: 'part-studio',
        selection: [],
        hidden: new Set(),
        isolated: null,
      });

      await get().regenerate();
      get().persist();
    } finally {
      set({ busy: false });
    }
  },

  async loadDocument(doc, bytes) {
    set({ busy: true, fatal: null });
    try {
      await engine.importModel(doc.fileId, doc.name, bytes, 'mm');
      set({
        docId: doc.id,
        docName: doc.name,
        fileId: doc.fileId,
        features: doc.features,
        rollbackTo: doc.features.length,
        versions: doc.versions,
        tab: 'part-studio',
      });
      await get().regenerate();
    } finally {
      set({ busy: false });
    }
  },

  updateFeature(id, params) {
    set((s) => ({
      features: s.features.map((f) =>
        f.id === id ? { ...f, params: { ...f.params, ...params } } : f,
      ),
    }));
    void get().regenerate();
  },

  renameFeature(id, name) {
    // A rename does not invalidate the regen cache: a label is not geometry.
    set((s) => ({ features: s.features.map((f) => (f.id === id ? { ...f, name } : f)) }));
    get().persist();
  },

  reorderFeature(from, to) {
    set((s) => {
      const features = [...s.features];
      const [moved] = features.splice(from, 1);
      features.splice(to, 0, moved!);
      // The rollback bar follows the list rather than staying at a fixed index --
      // otherwise dragging a feature silently changes how much of the model is built.
      return { features, rollbackTo: Math.max(s.rollbackTo, 0) };
    });
    void get().regenerate();
  },

  toggleSuppressed(id) {
    set((s) => ({
      features: s.features.map((f) =>
        f.id === id ? { ...f, suppressed: !f.suppressed } : f,
      ),
    }));
    void get().regenerate();
  },

  setRollback(index) {
    set({ rollbackTo: index });
    void get().regenerate();
  },

  setEditing(id) {
    set({ editing: id });
  },

  select(id, additive) {
    set((s) => {
      if (!additive) return { selection: [id] };
      // Onshape's additive selection: clicking a second face adds it to the pool
      // instead of replacing the first.
      return {
        selection: s.selection.includes(id)
          ? s.selection.filter((x) => x !== id)
          : [...s.selection, id],
      };
    });
  },

  clearSelection() {
    set({ selection: [] });
  },

  toggleHidden(id) {
    set((s) => {
      const hidden = new Set(s.hidden);
      if (hidden.has(id)) hidden.delete(id);
      else hidden.add(id);
      return { hidden };
    });
  },

  isolate(id) {
    set((s) => ({ isolated: s.isolated === id ? null : id }));
  },

  setTab(tab) {
    set({ tab });
  },
  setDisplay(display) {
    set({ display });
  },
  togglePerspective() {
    set((s) => ({ perspective: !s.perspective }));
  },
  toggleHeatmap() {
    set((s) => ({ showHeatmap: !s.showHeatmap }));
  },
  setExplode(explode) {
    set({ explode });
  },

  async regenerate() {
    const { features, fileId, rollbackTo } = get();
    if (!fileId) return;

    // Show the errors immediately -- do not wait on the worker to tell us
    // something we can already see from the feature list alone.
    const errors = validate(features.slice(0, rollbackTo));
    if (errors.length > 0) {
      set({
        regen: {
          ok: false,
          errors,
          cached: false,
          glb: null,
          bodies: [],
          warnings: [],
          instructions: '',
          moldable: true,
          pullDirection: null,
          partingZ: null,
          volumes: null,
          draftArea: null,
        },
      });
      return;
    }

    set({ busy: true });
    try {
      const view = await engine.regenerate(features, fileId, rollbackTo);
      set({ regen: view, fatal: view.ok ? null : (view.errors[0]?.message ?? null) });
      get().persist();
    } catch (err) {
      set({ fatal: (err as Error).message });
    } finally {
      set({ busy: false });
    }
  },

  saveVersion(name) {
    const { versions, features } = get();
    if (!versions) return;
    set({ versions: commitVersion(versions, features, name) });
    get().persist();
  },

  mergeFrom(versionId) {
    const { versions, features } = get();
    if (!versions) return { conflicts: 0 };

    const theirs = versions.versions[versionId];
    if (!theirs) return { conflicts: 0 };

    const base = versions.versions[versions.current]?.features ?? features;
    const result = mergeFeatures(base, features, theirs.features);

    set({ features: result.features });
    void get().regenerate();

    return { conflicts: result.conflicts.length };
  },

  async exportZip() {
    const buffer = await engine.exportZip();
    return new Blob([buffer], { type: 'application/zip' });
  },

  persist() {
    const s = get();
    if (!s.docId || !s.fileId || !s.versions) return;
    void saveDocument({
      id: s.docId,
      name: s.docName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      features: s.features,
      versions: s.versions,
      fileId: s.fileId,
    });
  },
}));
