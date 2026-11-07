import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
import { newProject, newChapter, serialize } from './model';
import { CACHE_KEY } from './bridge';
// `?bigdemo`: a 60k-word manuscript for performance testing (only in a throwaway browser profile).
if (import.meta.env.DEV && location.search.includes('bigdemo')) {
  const p = newProject(); const para = 'The rain kept a patient rhythm on the glass while Mira read the letter again, slower this time, as if the words might rearrange themselves into something kinder. ';
  p.chapters = Array.from({ length: 40 }, (_, i) => ({ ...newChapter(`Chapter of many words ${i + 1}`), text: Array.from({ length: 50 }, () => para.repeat(1)).join('\n\n') }));
  localStorage.setItem(CACHE_KEY, serialize(p));
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
// Diagnostics: `?fps` shows the frame rate in the window title.
if (import.meta.env.DEV && location.search.includes('fps')) {
  let frames = 0, last = performance.now();
  const tick = (now: number) => { frames++; if (now - last >= 1000) { document.title = `FPS ${Math.round(frames * 1000 / (now - last))} | ${document.querySelector(".preview-nav span")?.textContent ?? ""}`; frames = 0; last = now; } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
// `?fps&stress`: let the cat out, open the book preview and keep turning pages.
if (import.meta.env.DEV && location.search.includes('stress')) {
  setTimeout(() => {
    document.querySelector<HTMLElement>('.brand')?.click();
    [...document.querySelectorAll<HTMLElement>('nav button, .nav-pill')].find(b => b.textContent?.includes('Book preview'))?.click();
    let dir = 1, n = 0;
    setInterval(() => { if (++n % 4 === 0) dir = -dir; window.dispatchEvent(new KeyboardEvent('keydown', { key: dir > 0 ? 'ArrowRight' : 'ArrowLeft' })); }, 900);
  }, 1500);
}
// `?type`: type into the manuscript and report the average cost per keystroke (ms) in the title.
if (import.meta.env.DEV && location.search.includes('type')) {
  setTimeout(() => {
    const ta = document.querySelector<HTMLTextAreaElement>('.manuscript-editor'); if (!ta) { document.title = 'no editor'; return; }
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    let total = 0, n = 0, worst = 0; const parts = [0, 0, 0];
    setInterval(() => {
      const t0 = performance.now();
      const raw = location.search.includes('raw');
      setter.call(ta, ta.value + 'a'); const t1 = performance.now(); if (!raw) ta.dispatchEvent(new Event('input', { bubbles: true }));
      const t2 = performance.now(); void ta.offsetHeight; // include layout
      const dt = performance.now() - t0; total += dt; n++; worst = Math.max(worst, dt); parts[0] += t1 - t0; parts[1] += t2 - t1; parts[2] += performance.now() - t2;
      if (n % 20 === 0) { document.title = `TYPE avg ${(total / n).toFixed(1)}ms worst ${worst.toFixed(1)}ms set ${(parts[0] / n).toFixed(1)} react ${(parts[1] / n).toFixed(1)} layout ${(parts[2] / n).toFixed(1)}`; total = 0; n = 0; worst = 0; parts.fill(0); }
    }, 60);
  }, 2000);
}
