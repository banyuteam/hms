import { createRoot } from 'react-dom/client';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import './spike.css';

// Synthetic only — mimics a patient window whose title carries an identifier (PHI-like) to test serialisation.
const Panel = (p: IDockviewPanelProps<{ note: string }>) => (
  <div style={{ padding: 16 }}>
    <h2>{p.api.title}</h2>
    <button>first focusable</button> <input aria-label="field" />
  </div>
);

declare global {
  interface Window {
    __api?: DockviewApi;
  }
}

function App() {
  const onReady = (e: DockviewReadyEvent) => {
    window.__api = e.api;
    e.api.addPanel({ id: 'patients', component: 'p', title: 'Manajemen Pasien', params: { note: 'x' } });
    e.api.addPanel({ id: 'rm-synthetic', component: 'p', title: 'RM 000123 · Pasien Uji', params: { note: 'y' } });
    e.api.addPanel({
      id: 'lab',
      component: 'p',
      title: 'Laboratorium',
      floating: { x: 120, y: 80, width: 480, height: 320 },
    });
  };
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DockviewReact className="dockview-theme-hms" components={{ p: Panel }} onReady={onReady} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
