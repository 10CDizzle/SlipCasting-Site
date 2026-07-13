/**
 * The sample parts.
 *
 * Each is generated as a real STL and pushed through the same import path as any
 * other file. There is no privileged route into this app: whatever breaks for a
 * sample breaks for a model you dragged in, which is the only way a sample is
 * worth having.
 */
import { fixtures, toSTL, type MeshData } from '@slipcast/engine';
import { useStore } from './store.ts';

export type SampleName = 'cup' | 'mug' | 'torus' | 'sealed';

export const SAMPLES: Record<
  SampleName,
  { build: () => Promise<MeshData>; title: string; blurb: string }
> = {
  cup: {
    build: async () => fixtures.cup(),
    title: 'Tapered cup',
    blurb: 'The happy path. Parts along its own axis and needs no split.',
  },
  mug: {
    build: () => fixtures.handledMug(),
    title: 'Handled mug',
    blurb:
      'Un-moldable along its axis. Watch it find the seam through the handle instead — where a potter would put it.',
  },
  torus: {
    build: async () => fixtures.torus(),
    title: 'Torus',
    blurb: 'Parts cleanly at its equator, and not at all across its hole.',
  },
  sealed: {
    // Deliberately impossible. A sealed internal void cannot be reached from any
    // direction, and the only honest thing the tool can do is say so.
    build: () => fixtures.hollowSphere(),
    title: 'Sealed void',
    blurb:
      'Impossible on purpose. Nothing can mold an enclosed cavity, and the tool refuses rather than hand you a file that looks right.',
  },
};

export async function openSample(name: SampleName): Promise<void> {
  const mesh = await SAMPLES[name].build();
  const bytes = toSTL(mesh);
  const file = new File([bytes as BlobPart], `${name}.stl`, { type: 'model/stl' });
  await useStore.getState().openFile(file);
}

/**
 * Has this browser ever opened the app before?
 *
 * A first-time visitor landing on an empty Documents page has to guess what this
 * tool even does. Opening a real mold for them answers that in one screen -- but
 * only ever once, because hijacking the dashboard of someone who came back to find
 * their own work would be obnoxious.
 */
const SEEN_KEY = 'slipcast.seen';

export function isFirstVisit(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === null;
  } catch {
    // Private mode, or storage disabled. Treat as a returning visitor rather than
    // auto-opening on every single page load.
    return false;
  }
}

export function markVisited(): void {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    // Nothing to do; the worst case is we offer the tour again next time.
  }
}
