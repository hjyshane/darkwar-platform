import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TooltipLayer } from './components/ui/TooltipLayer';
import './index.css';
import './shell.css';
import { applyTheme, readTheme } from './lib/theme';

// Before the first render, not in an effect. An effect runs after React has
// painted, so a saved light theme would show one frame of the machine's dark
// one first — the flash every themed site gets wrong once.
applyTheme(readTheme());

const root = document.getElementById('root');
if (root === null) {
  throw new Error('#root element missing from index.html');
}
createRoot(root).render(
  <StrictMode>
    <App />
    <TooltipLayer />
  </StrictMode>,
);
