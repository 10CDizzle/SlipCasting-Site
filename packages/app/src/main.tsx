import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Documents } from './components/Documents.tsx';
import { Workspace } from './components/Workspace.tsx';
import { Splash } from './components/Splash.tsx';
import { isFirstVisit, markVisited, openSample } from './state/samples.ts';
import { listDocuments } from './state/db.ts';
import './styles/index.css';

type View = 'booting' | 'documents' | 'workspace';

function App() {
  const [view, setView] = useState<View>('booting');

  /**
   * First boot: open a real mold instead of an empty dashboard.
   *
   * Someone arriving cold has no idea what this tool does, and a page listing zero
   * documents does not tell them. A finished mold -- with its plaster recipe and its
   * undercut heatmap -- tells them in one screen. And because a sample goes through
   * exactly the same import path as a dragged-in file, what they are looking at is
   * the real thing rather than a picture of it.
   *
   * Only ever once. Someone coming back to find their own work should land on their
   * own work, not be hijacked by a demo.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const saved = await listDocuments();

      if (saved.length > 0 || !isFirstVisit()) {
        if (!cancelled) setView('documents');
        return;
      }

      markVisited();
      try {
        await openSample('cup');
        if (!cancelled) setView('workspace');
      } catch {
        // If the sample cannot be built, the dashboard is a fine fallback. Nobody
        // should be stranded on a spinner because a demo failed.
        if (!cancelled) setView('documents');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (view === 'booting') return <Splash />;

  return view === 'workspace' ? (
    <Workspace onExit={() => setView('documents')} />
  ) : (
    <Documents onOpen={() => setView('workspace')} />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
