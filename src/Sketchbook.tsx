import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Eraser, ImageDown, Pen, Plus, Redo2, Trash2, Undo2, X } from 'lucide-react';
import { INKS, uid, type Sketch, type Stroke } from './model';

// Freehand sketchbook on <canvas>.
// - Two stacked canvases: `base` holds the finished strokes, `live` the stroke being drawn plus the brush cursor,
//   so a frame only repaints what changes.
// - Every pointer sample is used (coalesced events), smoothed a little ("streamline") and given a pressure:
//   real pressure from a pen, simulated from speed for mouse and touch, so lines swell and thin like ink.
// - Strokes are stored as vectors in a 1600×1000 space with theme-token colors: they stay sharp at any size and
//   follow light and dark mode. The eraser cuts strokes apart where it passes instead of deleting them whole.
const W = 1600, H = 1000;
const SIZES = [3, 7, 16], ERASERS = [10, 20, 40];
const inkName: Record<Stroke['ink'], string> = { ink: 'Ink', accent: 'Walnut', green: 'Sage', red: 'Rosehip', blue: 'Dusk' };
type Live = { ink: Stroke['ink']; size: number; points: number[]; pressure: number[]; sx: number; sy: number; t: number };

const widthAt = (s: Pick<Stroke, 'size' | 'pressure'>, i: number) => s.size * (s.pressure ? 0.4 + 1.2 * s.pressure[i] : 1);
function paint(ctx: CanvasRenderingContext2D, s: Pick<Stroke, 'size' | 'points' | 'pressure'>, color: string) {
  const p = s.points, n = p.length / 2; if (!n) return;
  ctx.strokeStyle = color; ctx.fillStyle = color;
  if (n === 1) { ctx.beginPath(); ctx.arc(p[0], p[1], widthAt(s, 0) / 2, 0, Math.PI * 2); ctx.fill(); return; }
  // Quadratic curves through the midpoints; each segment gets the width of its control point.
  let mx = p[0], my = p[1];
  for (let i = 1; i < n; i++) {
    const x = p[2 * i], y = p[2 * i + 1];
    ctx.beginPath(); ctx.moveTo(mx, my);
    if (i === n - 1) { ctx.lineTo(x, y); mx = x; my = y; }
    else { const nx = (x + p[2 * i + 2]) / 2, ny = (y + p[2 * i + 3]) / 2; ctx.quadraticCurveTo(x, y, nx, ny); mx = nx; my = ny; }
    ctx.lineWidth = (widthAt(s, i - 1) + widthAt(s, i)) / 2; ctx.stroke();
  }
}
// Cut every stroke where the eraser circle (moving from a to b) touches it.
function erase(strokes: Stroke[], ax: number, ay: number, bx: number, by: number, r: number): Stroke[] | null {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (r / 2)));
  const hits = (x: number, y: number, w: number) => { for (let k = 0; k <= steps; k++) { const ex = ax + (bx - ax) * k / steps, ey = ay + (by - ay) * k / steps; if (Math.hypot(x - ex, y - ey) <= r + w / 2) return true; } return false; };
  let changed = false; const out: Stroke[] = [];
  for (const s of strokes) {
    let piece: number[] = [], pr: number[] = [];
    const flush = () => { if (piece.length) out.push({ ...s, points: piece, ...(s.pressure ? { pressure: pr } : {}) }); piece = []; pr = []; };
    for (let i = 0; i < s.points.length / 2; i++) {
      const x = s.points[2 * i], y = s.points[2 * i + 1];
      if (hits(x, y, widthAt(s, i))) { changed = true; flush(); continue; }
      piece.push(x, y); if (s.pressure) pr.push(s.pressure[i]);
    }
    flush();
  }
  return changed ? out : null;
}

export default function Sketchbook({ sketches: saved, onChange }: { sketches: Sketch[]; onChange: (next: Sketch[]) => void }) {
  // An empty sketchbook shows a blank first page that is only stored once something is drawn on it.
  const [blank] = useState<Sketch>(() => ({ id: uid(), title: 'Sketch 1', strokes: [] }));
  const sketches = saved.length ? saved : [blank];
  const [activeId, setActiveId] = useState(sketches[0].id);
  const sketch = sketches.find(s => s.id === activeId) || sketches[0];
  const [ink, setInk] = useState<Stroke['ink']>('ink'); const [sizeIndex, setSizeIndex] = useState(0); const [erasing, setErasing] = useState(false);
  const [renaming, setRenaming] = useState('');
  const [, setTick] = useState(0);
  const history = useRef(new Map<string, { undo: Stroke[][]; redo: Stroke[][] }>());
  const stack = (id: string) => { let h = history.current.get(id); if (!h) history.current.set(id, h = { undo: [], redo: [] }); return h; };
  const paper = useRef<HTMLDivElement>(null), baseCv = useRef<HTMLCanvasElement>(null), liveCv = useRef<HTMLCanvasElement>(null);
  const live = useRef<Live | null>(null), erased = useRef<Stroke[] | null>(null), eraserAt = useRef<[number, number] | null>(null);
  const hover = useRef<[number, number] | null>(null), frame = useRef(0), baseDirty = useRef(true);
  const state = useRef({ sketch, sketches, ink, size: SIZES[sizeIndex], eraser: ERASERS[sizeIndex], erasing });
  state.current = { sketch, sketches, ink, size: SIZES[sizeIndex], eraser: ERASERS[sizeIndex], erasing };

  const colors = useRef<Record<string, string>>({});
  const readColors = () => { const cs = getComputedStyle(paper.current || document.documentElement); for (const k of INKS) colors.current[k] = cs.getPropertyValue(`--ink-${k}`).trim() || '#333'; };
  const prepare = (cv: HTMLCanvasElement) => { const ctx = cv.getContext('2d')!; const sx = cv.width / W; ctx.setTransform(sx, 0, 0, sx, 0, 0); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; return ctx; };
  const render = () => {
    frame.current = 0;
    const b = baseCv.current, l = liveCv.current; if (!b || !l) return;
    if (baseDirty.current) { baseDirty.current = false; const ctx = prepare(b); ctx.clearRect(0, 0, W, H); for (const s of erased.current || state.current.sketch.strokes) paint(ctx, s, colors.current[s.ink]); }
    const ctx = prepare(l); ctx.clearRect(0, 0, W, H);
    const st = live.current; if (st) paint(ctx, st, colors.current[st.ink]);
    const h = hover.current;
    if (h && !st) { // brush preview
      const { erasing: er, size, eraser, ink: k } = state.current;
      ctx.beginPath(); ctx.arc(h[0], h[1], er ? eraser : Math.max(2, size * .7), 0, Math.PI * 2);
      if (er) { ctx.lineWidth = 1.5 * W / l.clientWidth; ctx.strokeStyle = colors.current.ink; ctx.globalAlpha = .55; ctx.stroke(); ctx.globalAlpha = 1; }
      else { ctx.fillStyle = colors.current[k]; ctx.globalAlpha = .45; ctx.fill(); ctx.globalAlpha = 1; }
    }
  };
  const schedule = (base = false) => { if (base) baseDirty.current = true; if (!frame.current) frame.current = requestAnimationFrame(render); };

  // Size the canvases to their on-screen pixels; repaint on resize and on theme changes.
  useEffect(() => {
    const el = paper.current; if (!el) return;
    const fit = () => { const dpr = window.devicePixelRatio || 1, w = Math.round(el.clientWidth * dpr), h = Math.round(w * H / W); for (const cv of [baseCv.current, liveCv.current]) if (cv && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; } readColors(); schedule(true); };
    const ro = new ResizeObserver(fit); ro.observe(el); fit();
    const mo = new MutationObserver(() => { readColors(); schedule(true); }); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(frame.current); frame.current = 0; };
  }, []);
  useEffect(() => { schedule(true); }, [sketch.id, sketch.strokes]);
  useEffect(() => { schedule(); }, [ink, sizeIndex, erasing]);

  const commit = (strokes: Stroke[]) => {
    const { sketch: s, sketches: list } = state.current; const h = stack(s.id);
    h.undo.push(s.strokes); if (h.undo.length > 100) h.undo.shift(); h.redo = [];
    onChange(list.map(x => x.id === s.id ? { ...x, strokes } : x)); setTick(t => t + 1);
  };
  const travel = (dir: 'undo' | 'redo') => {
    const { sketch: s, sketches: list } = state.current; const h = stack(s.id); const prev = h[dir].pop(); if (!prev) return;
    h[dir === 'undo' ? 'redo' : 'undo'].push(s.strokes);
    onChange(list.map(x => x.id === s.id ? { ...x, strokes: prev } : x)); setTick(t => t + 1);
  };
  // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y), P for pen, E for eraser.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement; if (t.closest('input,textarea,select,[contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); travel(e.shiftKey ? 'redo' : 'undo'); }
      else if (mod && k === 'y') { e.preventDefault(); travel('redo'); }
      else if (!mod && !e.altKey && k === 'e') setErasing(true);
      else if (!mod && !e.altKey && (k === 'p' || k === 'b')) setErasing(false);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  const at = (e: { clientX: number; clientY: number }): [number, number] => { const r = liveCv.current!.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = at(e); hover.current = [x, y];
    if (state.current.erasing || e.button === 5) { erased.current = state.current.sketch.strokes; eraserAt.current = [x, y]; eraseTo(x, y); return; }
    const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : .62;
    live.current = { ink: state.current.ink, size: state.current.size, points: [Math.round(x), Math.round(y)], pressure: [p], sx: x, sy: y, t: e.timeStamp };
    schedule();
  };
  const eraseTo = (x: number, y: number) => {
    const from = eraserAt.current || [x, y]; eraserAt.current = [x, y];
    const next = erase(erased.current || [], from[0], from[1], x, y, state.current.eraser);
    if (next) { erased.current = next; schedule(true); } else schedule();
  };
  const addSample = (s: Live, e: PointerEvent | ReactPointerEvent) => {
    const [rx, ry] = at(e);
    // Streamline: follow the pointer a little lazily, which irons out the hand's jitter.
    const sx = s.sx + (rx - s.sx) * .5, sy = s.sy + (ry - s.sy) * .5;
    const n = s.points.length, lx = s.points[n - 2], ly = s.points[n - 1], d = Math.hypot(sx - lx, sy - ly);
    s.sx = sx; s.sy = sy;
    if (d < 1.2) return;
    const last = s.pressure[s.pressure.length - 1];
    let target: number;
    if (e.pointerType === 'pen' && e.pressure > 0) target = e.pressure;
    else { const dt = Math.max(1, e.timeStamp - s.t), v = d / dt; target = Math.min(.8, Math.max(.22, .8 - v * .16)); }
    s.t = e.timeStamp;
    s.points.push(Math.round(sx * 10) / 10, Math.round(sy * 10) / 10);
    s.pressure.push(Math.round((last + (target - last) * .3) * 100) / 100);
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const [x, y] = at(e); hover.current = [x, y];
    if (erased.current) { const evs = e.nativeEvent.getCoalescedEvents?.() || []; for (const ev of evs.length ? evs : [e.nativeEvent]) { const [ex, ey] = at(ev); eraseTo(ex, ey); } return; }
    const s = live.current;
    if (s) { const evs = e.nativeEvent.getCoalescedEvents?.() || []; for (const ev of evs.length ? evs : [e.nativeEvent]) addSample(s, ev); }
    schedule();
  };
  const up = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (erased.current) { const next = erased.current; erased.current = null; eraserAt.current = null; if (next !== state.current.sketch.strokes) commit(next); schedule(true); return; }
    const s = live.current; if (!s) return; live.current = null;
    if (e.type === 'pointerup') { const [x, y] = at(e), n = s.points.length; if (Math.hypot(x - s.points[n - 2], y - s.points[n - 1]) > 1) { s.points.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10); s.pressure.push(s.pressure[s.pressure.length - 1]); } }
    // Ease the tail of the stroke so lines end softly instead of bluntly.
    const pr = s.pressure, m = pr.length; for (let i = Math.max(1, m - 4); i < m; i++) pr[i] = Math.round(pr[i] * (1 - .12 * (i - (m - 5))) * 100) / 100;
    const stroke: Stroke = { ink: s.ink, size: s.size, points: s.points, pressure: pr.map(p => Math.max(0, Math.min(1, p))) };
    // Paint it straight onto the base so there is no flicker before React re-renders.
    const b = baseCv.current; if (b) paint(prepare(b), stroke, colors.current[stroke.ink]);
    commit([...state.current.sketch.strokes, stroke]);
    schedule();
  };
  const leave = () => { hover.current = null; schedule(); };

  const addPage = () => { const page = { id: uid(), title: `Sketch ${sketches.length + 1}`, strokes: [] }; onChange([...sketches, page]); setActiveId(page.id); };
  const removePage = (id: string) => { const rest = sketches.filter(s => s.id !== id); onChange(rest); if (id === sketch.id) setActiveId(rest[0].id); };
  const savePng = () => {
    const out = document.createElement('canvas'); out.width = W; out.height = H; const ctx = out.getContext('2d')!;
    ctx.fillStyle = getComputedStyle(paper.current!).getPropertyValue('--paper').trim() || '#fff'; ctx.fillRect(0, 0, W, H); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of sketch.strokes) paint(ctx, s, colors.current[s.ink]);
    out.toBlob(blob => { if (!blob) return; const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${sketch.title.replace(/[^\p{L}\p{N} -]/gu, '') || 'sketch'}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  };
  const h = stack(sketch.id);
  return <div className="sketchbook">
    <div className="sketch-pages" role="tablist" aria-label="Sketchbook pages">
      {sketches.map(s => <div key={s.id} className={`sketch-page-tab ${s.id === sketch.id ? 'selected' : ''}`}>
        {renaming === s.id
          ? <input autoFocus aria-label="Page name" defaultValue={s.title} maxLength={60} onBlur={e => { const t = e.target.value.trim(); if (t) onChange(sketches.map(x => x.id === s.id ? { ...x, title: t } : x)); setRenaming(''); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(''); }}/>
          : <button role="tab" aria-selected={s.id === sketch.id} title="Double-click to rename" onClick={() => setActiveId(s.id)} onDoubleClick={() => setRenaming(s.id)}>{s.title}</button>}
        {sketches.length > 1 && s.id === sketch.id && <button className="sketch-page-remove" aria-label={`Remove ${s.title}`} title="Remove page" onClick={() => removePage(s.id)}><X size={12}/></button>}
      </div>)}
      <button className="sketch-page-add" aria-label="New sketch page" title="New page" onClick={addPage}><Plus size={14}/></button>
    </div>
    <div className="sketch-tools">
      <div className="sketch-tool-group">
        <button className={!erasing ? 'selected' : ''} aria-pressed={!erasing} title="Pen (P)" onClick={() => setErasing(false)}><Pen size={15}/></button>
        <button className={erasing ? 'selected' : ''} aria-pressed={erasing} title="Eraser (E)" onClick={() => setErasing(true)}><Eraser size={15}/></button>
      </div>
      <div className="sketch-tool-group">{INKS.map(k => <button key={k} className={`sketch-ink ${ink === k && !erasing ? 'selected' : ''}`} title={inkName[k]} aria-label={`${inkName[k]} ink`} aria-pressed={ink === k} onClick={() => { setInk(k); setErasing(false); }}><i style={{ background: `var(--ink-${k})` }}/></button>)}</div>
      <div className="sketch-tool-group">{SIZES.map((n, i) => <button key={n} className={sizeIndex === i ? 'selected' : ''} title={`${['Fine', 'Medium', 'Bold'][i]} ${erasing ? 'eraser' : 'line'}`} aria-pressed={sizeIndex === i} onClick={() => setSizeIndex(i)}><i className="sketch-size" style={{ width: 4 + n / 1.6, height: 4 + n / 1.6 }}/></button>)}</div>
      <span className="sketch-spacer"/>
      <div className="sketch-tool-group">
        <button title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!h.undo.length} onClick={() => travel('undo')}><Undo2 size={15}/></button>
        <button title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!h.redo.length} onClick={() => travel('redo')}><Redo2 size={15}/></button>
      </div>
      <button className="text-button" disabled={!sketch.strokes.length} onClick={savePng}><ImageDown size={14}/>Save as image</button>
      <button className="text-button" disabled={!sketch.strokes.length} onClick={() => commit([])}><Trash2 size={14}/>Clear page</button>
    </div>
    <div ref={paper} className={`sketch-paper ${erasing ? 'erasing' : ''}`}>
      <canvas ref={baseCv} aria-hidden="true"/>
      <canvas ref={liveCv} role="img" aria-label={`Drawing: ${sketch.title}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={leave} onContextMenu={e => e.preventDefault()}/>
      {!sketch.strokes.length && <p className="sketch-hint">A map, a face, a floor plan of the house. Draw whatever helps you see it.</p>}
    </div>
  </div>;
}
