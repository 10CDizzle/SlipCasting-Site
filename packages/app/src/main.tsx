import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Documents } from './components/Documents.tsx';
import { Workspace } from './components/Workspace.tsx';
import './styles/index.css';

function App() {
  const [inWorkspace, setInWorkspace] = useState(false);

  return inWorkspace ? (
    <Workspace />
  ) : (
    <Documents onOpen={() => setInWorkspace(true)} />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
