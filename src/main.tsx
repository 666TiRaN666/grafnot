import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './ui/tokens.css'
import App from './App.tsx'

// S11: an on-screen keyboard can cover the focused field above fixed
// footers (tab bar). Nudge the field into view when the visual viewport
// shrinks; browsers without visualViewport keep native behavior.
if (typeof window !== 'undefined' && window.visualViewport) {
  let lastH = window.visualViewport.height;
  window.visualViewport.addEventListener('resize', () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const opened = vv.height < lastH - 100;
    lastH = vv.height;
    if (!opened) return;
    const t = document.activeElement as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
      t.scrollIntoView({ block: 'center' });
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
