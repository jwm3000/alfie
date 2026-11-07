import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ChevronsLeft, ChevronsRight, Feather, PenLine } from 'lucide-react';
import type { Chapter, Project } from './model';

const RATIO = 0.68; // page width / height, close to a trade paperback
const spelled = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const chapterLabel = (i: number) => `Chapter ${spelled[i] || i + 1}`;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const easeInOut = (t: number) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---- paper-fold geometry ----
type V = { x: number; y: number };
// Keep the part of a convex polygon on one side of the line through q with normal n.
function clipHalf(poly: V[], q: V, n: V, positive: boolean): V[] {
  const out: V[] = [], side = (p: V) => ((p.x - q.x) * n.x + (p.y - q.y) * n.y) * (positive ? 1 : -1);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], sa = side(a), sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
  }
  return out;
}
const polyCss = (pts: V[], ox = 0, oy = 0) => (pts.length < 3 ? 'polygon(0 0, 0 0, 0 0)' : `polygon(${pts.map(p => `${(p.x - ox).toFixed(2)}px ${(p.y - oy).toFixed(2)}px`).join(', ')})`);
// A long strip whose left edge lies on a line through q, extending along normal n.
const stripTransform = (q: V, n: V, half: number) => `translate(${q.x}px, ${q.y}px) rotate(${Math.atan2(n.y, n.x)}rad) translate(0px, ${-half}px)`;

function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  if (!blocks.length) return <p className="book-empty">This chapter is still waiting for its words.</p>;
  return <>{blocks.map((block, i) => /^(\*\s*){3,}$|^-{3,}$|^#$/.test(block)
    ? <div key={i} className="book-scene-break">⁂</div>
    : <p key={i}>{block.split('\n').reduce<ReactNode[]>((acc, line, j) => (j ? [...acc, <br key={j}/>, line] : [line]), [])}</p>)}</>;
}
function FrontMatter({ project, starts, textH }: { project: Project; starts: Record<string, number>; textH: number }) {
  return <>
    <section className="book-title-page" style={{ height: textH }}>
      <span className="book-ornament">✦</span><h1>{project.title}</h1>
      {project.author && <p className="book-author">{project.author}</p>}
      <span className="book-rule"/><small>written with alfie</small>
    </section>
    <section className="book-contents">
      <h2>Contents</h2>
      {project.chapters.map((c, i) => <button key={c.id} data-goto={starts[c.id] ?? ''}><span className="toc-num">{i + 1}</span><span className="toc-title">{c.title}</span><span className="toc-leader"/><span className="toc-page">{starts[c.id] !== undefined ? starts[c.id] + 1 : ''}</span></button>)}
    </section>
  </>;
}
function ChapterSection({ chapter, index, last }: { chapter: Chapter; index: number; last: boolean }) {
  return <>
    <section className="book-chapter" data-chapter={chapter.id}>
      <header><span>{chapterLabel(index)}</span><h2>{chapter.title}</h2>{chapter.subtitle && <em>{chapter.subtitle}</em>}<i>❦</i></header>
      <div className="book-prose"><Prose text={chapter.text}/></div>
    </section>
    {last && <div className="book-fin"><span>— fin —</span></div>}
  </>;
}

type Geometry = { pageW: number; pageH: number; mx: number; my: number; colW: number; textH: number };
type Flip = { dir: 'next' | 'prev'; from: number; to: number; auto: boolean };
type PageInfo = { content: ReactNode; offset: number; head: string | null; folio: number | null } | null;

// One printed page. Each chapter starts on a fresh column, so a page only needs to lay out its own chapter.
function Page({ info, side, g }: { info: PageInfo; side: 'left' | 'right'; g: Geometry }) {
  return <div className={`book-page ${side}`} style={{ width: g.pageW, height: g.pageH }}>
    {info && <>
      <div className="book-margin" style={{ padding: `0 ${g.mx}px`, height: g.my, justifyContent: side === 'left' ? 'flex-start' : 'flex-end' }}>{info.head}</div>
      <div className="book-clip" style={{ left: g.mx, top: g.my, width: g.colW, height: g.textH }}>
        <div className="book-flow" style={{ width: g.colW, height: g.textH, columnCount: 1, columnGap: 2 * g.mx, transform: `translateX(${-info.offset * g.pageW}px)` }}>{info.content}</div>
      </div>
      {info.folio && <span className="book-folio" style={{ bottom: g.my * .35 }}>{info.folio}</span>}
    </>}
  </div>;
}
export default function Preview({ project, onEdit }: { project: Project; onEdit: (chapterId: string) => void }) {
  const stage = useRef<HTMLDivElement>(null), measureFlow = useRef<HTMLDivElement>(null), end = useRef<HTMLSpanElement>(null), bookRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(() => { try { return Number(localStorage.getItem('alfie.bookScale')) || 1; } catch { return 1; } });
  const [spread, setSpread] = useState(0);
  const [flip, setFlip] = useState<Flip | null>(null);
  const [pages, setPages] = useState(1);
  const [starts, setStarts] = useState<Record<string, number>>({});
  const pending = useRef<number | null>(null);

  useEffect(() => { const el = stage.current; if (!el) return; const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height })); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => { try { localStorage.setItem('alfie.bookScale', String(scale)); } catch {} }, [scale]);

  const pageW = Math.max(180, Math.floor(Math.min((size.w - 40) / 2, (size.h - 30) * RATIO) / 2) * 2);
  const pageH = Math.floor(pageW / RATIO);
  const mx = Math.round(pageW * 0.12), my = Math.round(pageH * 0.095);
  const g: Geometry = { pageW, pageH, mx, my, colW: pageW - 2 * mx, textH: pageH - 2 * my };
  const font = Math.max(9, Math.round(pageW * 0.031 * scale * 10) / 10);
  const maxSpread = Math.max(0, Math.floor((pages - 1) / 2));

  const measure = () => {
    const f = measureFlow.current; if (!f || !end.current) return;
    const base = f.getBoundingClientRect().left;
    const pageOf = (el: Element) => Math.max(0, Math.floor((el.getBoundingClientRect().left - base + 2) / pageW));
    setPages(pageOf(end.current) + 1);
    const next: Record<string, number> = {};
    f.querySelectorAll<HTMLElement>('[data-chapter]').forEach(el => { next[el.dataset.chapter!] = pageOf(el); });
    setStarts(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  };
  useLayoutEffect(() => { measure(); const raf = requestAnimationFrame(measure); return () => cancelAnimationFrame(raf); }, [project, pageW, pageH, font]);
  useEffect(() => { void document.fonts?.ready.then(measure); }, []);
  useEffect(() => { if (spread > maxSpread) { setSpread(maxSpread); setFlip(null); } }, [maxSpread]);

  // ---- page contents ----
  const front = useMemo(() => <FrontMatter project={project} starts={starts} textH={g.textH}/>, [project, starts, g.textH]);
  const sections = useMemo(() => project.chapters.map((c, i) => <ChapterSection key={c.id} chapter={c} index={i} last={i === project.chapters.length - 1}/>), [project]);
  const chapterAt = (page: number) => { let found = -1; project.chapters.forEach((c, i) => { if ((starts[c.id] ?? Infinity) <= page) found = i; }); return found; };
  const pageInfo = (page: number): PageInfo => {
    if (page < 0 || page >= pages) return null;
    const i = chapterAt(page);
    if (i < 0) return { content: front, offset: page, head: null, folio: page > 0 ? page + 1 : null };
    const start = starts[project.chapters[i].id];
    return { content: sections[i], offset: page - start, head: start === page ? null : page % 2 ? project.chapters[i].title : project.title, folio: page + 1 };
  };
  const info = pageInfo;

  // ---- turning: a paper fold that follows the pointer in both directions, like Books on iPad ----
  // Everything is computed for a forward turn of the right page; a backward turn mirrors the whole layer.
  const flipRef = useRef(flip); flipRef.current = flip;
  const geo = useRef(g); geo.current = g;
  const raf = useRef(0);
  const els = useRef<Record<string, HTMLDivElement | null>>({});
  const setEl = (k: string) => (n: HTMLDivElement | null) => { els.current[k] = n; };
  // cy: height of the grabbed point on the outer edge C = (2P, cy); m: where that point is now.
  const curl = useRef({ cy: 0, m: { x: 0, y: 0 } as V, v: { x: 0, y: 0 } as V, target: { x: 0, y: 0 } as V, start: { x: 0, y: 0 } as V, mode: 'idle' as 'idle' | 'drag' | 'spring' | 'auto', t0: 0, dur: 800, running: false, last: 0 });
  const drag = useRef<{ x0: number; y0: number; moved: boolean; side: 'next' | 'prev'; id: number; vx: number; vy: number; lx: number; ly: number; lt: number } | null>(null);

  // Paper does not stretch: every point keeps its distance to the spine.
  const constrain = (m: V, cy: number): V => {
    const { pageW: P, pageH: H } = geo.current;
    let p = { ...m };
    for (let pass = 0; pass < 3; pass++) for (const [sy, r] of [[cy, P], [0, Math.hypot(P, cy)], [H, Math.hypot(P, H - cy)]] as const) {
      const dx = p.x - P, dy = p.y - sy, d = Math.hypot(dx, dy);
      if (d > r) p = { x: P + dx * r / d, y: sy + dy * r / d };
    }
    return p;
  };
  const toLocal = (clientX: number, clientY: number, side: 'next' | 'prev'): V => {
    const r = bookRef.current!.getBoundingClientRect(), x = clientX - r.left;
    return { x: side === 'next' ? x : r.width - x, y: clientY - r.top };
  };

  const paint = () => {
    const E = els.current; if (!flipRef.current || !E.front || !E.flap || !E.gloss || !E.glossStrip || !E.under || !E.underStrip || !E.shadow) return;
    const { pageW: P, pageH: H } = geo.current, c = curl.current;
    const C = { x: 2 * P, y: c.cy }, M = c.m, dx = C.x - M.x, dy = C.y - M.y, L = Math.hypot(dx, dy);
    const page = [{ x: P, y: 0 }, { x: 2 * P, y: 0 }, { x: 2 * P, y: H }, { x: P, y: H }];
    if (L < .5) { E.front.style.clipPath = 'none'; E.flap.style.clipPath = E.gloss.style.clipPath = E.under.style.clipPath = polyCss([]); E.shadow.style.filter = 'none'; return; }
    const n = { x: dx / L, y: dy / L }, q = { x: (C.x + M.x) / 2, y: (C.y + M.y) / 2 }, half = 2 * Math.hypot(2 * P, H);
    const exposed = clipHalf(page, q, n, true);
    const reflect = (p: V) => { const k = 2 * ((p.x - q.x) * n.x + (p.y - q.y) * n.y); return { x: p.x - k * n.x, y: p.y - k * n.y }; };
    // Flat part of the current page.
    E.front.style.clipPath = polyCss(clipHalf(page, q, n, false), P, 0);
    // Folded flap: the back of the leaf, mirrored at the spine and reflected across the fold line.
    const qn = q.x * n.x + q.y * n.y;
    E.flap.style.transform = `matrix(${-(1 - 2 * n.x * n.x)}, ${2 * n.x * n.y}, ${-2 * n.x * n.y}, ${1 - 2 * n.y * n.y}, ${2 * P * (1 - 2 * n.x * n.x) + 2 * qn * n.x}, ${-4 * P * n.x * n.y + 2 * qn * n.y})`;
    E.flap.style.clipPath = polyCss(exposed.map(p => ({ x: 2 * P - p.x, y: p.y })));
    // Curvature light on the flap and soft shadow on the page underneath, both hugging the fold.
    const depth = L / 2, done = Math.hypot(M.x, M.y - c.cy), strength = clamp(L / (P * .35)) * clamp(done / (P * .45));
    E.gloss.style.clipPath = polyCss(exposed.map(reflect));
    E.glossStrip.style.width = `${depth + 2}px`; E.glossStrip.style.transform = stripTransform(q, { x: -n.x, y: -n.y }, half);
    E.gloss.style.opacity = String(.35 + .65 * strength);
    E.under.style.clipPath = polyCss(exposed, P, 0);
    E.underStrip.style.width = `${Math.min(P * .4, depth * .9 + 12)}px`; E.underStrip.style.transform = stripTransform({ x: q.x - P, y: q.y }, n, half);
    E.underStrip.style.opacity = String(strength);
    E.shadow.style.filter = `drop-shadow(0 ${2 + 4 * strength}px ${6 + 14 * strength}px rgba(30,18,6,${(.34 * strength).toFixed(3)}))`;
  };

  const tick = (now: number) => {
    const c = curl.current, dt = Math.min(.032, (now - c.last) / 1000), { pageW: P, pageH: H } = geo.current; c.last = now;
    if (c.mode === 'auto') {
      const t = clamp((now - c.t0) / c.dur), e = easeInOut(t), lift = (c.cy < H / 2 ? 1 : -1) * H * .18;
      c.m = constrain({ x: c.start.x + (c.target.x - c.start.x) * e, y: c.start.y + (c.target.y - c.start.y) * e + lift * Math.sin(Math.PI * e) }, c.cy);
      paint();
      if (t >= 1) { c.running = false; finishFlip(); return; }
    } else if (c.mode === 'spring') {
      const k = 95, damp = 2 * Math.sqrt(k) * .88;
      for (let i = 0; i < 2; i++) {
        const h = dt / 2;
        c.v.x += (k * (c.target.x - c.m.x) - damp * c.v.x) * h; c.v.y += (k * (c.target.y - c.m.y) - damp * c.v.y) * h;
        c.m = constrain({ x: c.m.x + c.v.x * h, y: c.m.y + c.v.y * h }, c.cy);
      }
      paint();
      if (Math.hypot(c.target.x - c.m.x, c.target.y - c.m.y) < .8 && Math.hypot(c.v.x, c.v.y) < 12) { c.running = false; c.target.x < P ? finishFlip() : cancelFlip(); return; }
    } else { c.running = false; return; }
    raf.current = requestAnimationFrame(tick);
  };
  const kick = () => { const c = curl.current; if (c.running) return; c.running = true; c.last = performance.now(); raf.current = requestAnimationFrame(tick); };
  const finishFlip = () => {
    const f = flipRef.current; if (!f) return;
    curl.current.mode = 'idle'; setSpread(f.to); setFlip(null);
    const next = pending.current; pending.current = null;
    if (next !== null && next !== f.to) requestAnimationFrame(() => startFlip(f.to, next));
  };
  const cancelFlip = () => { curl.current.mode = 'idle'; setFlip(null); pending.current = null; };
  const startFlip = (from: number, n: number, auto = true) => { const to = Math.min(maxSpread, Math.max(0, n)); if (to === from) return false; setFlip({ dir: to > from ? 'next' : 'prev', from, to, auto }); return true; };
  useLayoutEffect(() => {
    if (!flip) return;
    const c = curl.current, { pageW: P, pageH: H } = geo.current;
    if (flip.auto) {
      c.cy = H * .9; c.start = { x: 2 * P - 1, y: c.cy }; c.m = { ...c.start }; c.target = { x: 0, y: c.cy };
      c.mode = 'auto'; c.t0 = performance.now(); c.dur = pending.current !== null ? 420 : 820;
      paint(); kick();
    } else paint();
  }, [flip]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const go = (n: number) => { if (flipRef.current) { pending.current = n; return; } startFlip(spread, n); };
  const target = () => pending.current ?? flip?.to ?? spread;
  const goPage = (page: number) => go(Math.floor(page / 2));

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || flipRef.current || !bookRef.current) return;
    const r = bookRef.current.getBoundingClientRect();
    const side = e.clientX - r.left > r.width / 2 ? 'next' : 'prev';
    if ((side === 'next' && spread >= maxSpread) || (side === 'prev' && spread <= 0)) return;
    drag.current = { x0: e.clientX, y0: e.clientY, moved: false, side, id: e.pointerId, vx: 0, vy: 0, lx: e.clientX, ly: e.clientY, lt: performance.now() };
    bookRef.current.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const c = curl.current, { pageW: P, pageH: H } = geo.current;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
      d.moved = true;
      const grab = toLocal(d.x0, d.y0, d.side);
      c.cy = clamp(grab.y, 0, H); c.mode = 'drag'; c.v = { x: 0, y: 0 };
      startFlip(spread, spread + (d.side === 'next' ? 1 : -1), false);
    }
    const now = performance.now(), dt = Math.max(1, now - d.lt), sx = d.side === 'next' ? 1 : -1;
    d.vx = .6 * d.vx + .4 * (sx * (e.clientX - d.lx) / dt * 1000); d.vy = .6 * d.vy + .4 * ((e.clientY - d.ly) / dt * 1000);
    d.lx = e.clientX; d.ly = e.clientY; d.lt = now;
    // The grabbed point of the page edge moves exactly with the pointer.
    c.m = constrain({ x: 2 * P + sx * (e.clientX - d.x0), y: c.cy + (e.clientY - d.y0) }, c.cy);
    paint();
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return; drag.current = null;
    if (!d.moved) {
      const toc = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]');
      if (toc) { if (toc.dataset.goto !== '') goPage(Number(toc.dataset.goto)); return; }
      go(spread + (d.side === 'next' ? 1 : -1)); return;
    }
    const c = curl.current, P = geo.current.pageW, flick = 450;
    const complete = d.vx < -flick || (d.vx < flick && c.m.x < P * 1.25);
    c.target = complete ? { x: 0, y: c.cy } : { x: 2 * P, y: c.cy };
    c.v = { x: d.vx, y: d.vy }; c.mode = 'spring'; kick();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]') || e.ctrlKey || e.metaKey || e.altKey || drag.current) return;
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(target() + 1); }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(target() - 1); }
      if (e.key === 'Home') { e.preventDefault(); go(0); }
      if (e.key === 'End') { e.preventDefault(); go(maxSpread); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  // What lies flat on each side while a leaf turns, and what the turning leaf shows on each face.
  const s = flip ? flip.from : spread;
  const leftIndex = flip ? (flip.dir === 'next' ? 2 * s : 2 * flip.to) : 2 * spread;
  const rightIndex = flip ? (flip.dir === 'next' ? 2 * flip.to + 1 : 2 * s + 1) : 2 * spread + 1;
  const frontIdx = flip ? (flip.dir === 'next' ? 2 * s + 1 : 2 * s) : 0;
  const backIdx = flip ? (flip.dir === 'next' ? 2 * flip.to : 2 * flip.to + 1) : 0;
  const shown = flip ? flip.to : spread;
  const current = chapterAt(Math.min(pages - 1, 2 * shown + 1));
  const label = 2 * shown + 1 < pages ? `Pages ${2 * shown + 1}–${2 * shown + 2} of ${pages}` : `Page ${2 * shown + 1} of ${pages}`;

  let leaf: ReactNode = null;
  if (flip) {
    const prev = flip.dir === 'prev', unmirror = prev ? { transform: 'scaleX(-1)' } : undefined, half = 2 * Math.hypot(2 * pageW, pageH);
    leaf = <div className="curl-layer" style={{ transform: prev ? 'scaleX(-1)' : undefined }}>
      <div className="curl-under" ref={setEl('under')} style={{ left: pageW, width: pageW, height: pageH }}><div className="curl-under-strip" ref={setEl('underStrip')} style={{ height: 2 * half }}/></div>
      <div className="curl-front" ref={setEl('front')} style={{ left: pageW, width: pageW, height: pageH }}><div style={unmirror}><Page info={info(frontIdx)} side={prev ? 'left' : 'right'} g={g}/></div></div>
      <div className="curl-shadow" ref={setEl('shadow')}>
        <div className="curl-flap" ref={setEl('flap')} style={{ width: pageW, height: pageH }}><div style={unmirror}><Page info={info(backIdx)} side={prev ? 'right' : 'left'} g={g}/></div></div>
        <div className="curl-gloss" ref={setEl('gloss')}><div className="curl-gloss-strip" ref={setEl('glossStrip')} style={{ height: 2 * half }}/></div>
      </div>
    </div>;
  }

  return <div className="preview-view">
    <div className="preview-toolbar">
      <div className="preview-title"><span className="eyebrow">BOOK PREVIEW</span><strong>{project.title}</strong></div>
      <div className="preview-nav">
        <button className="icon-button" aria-label="First page" title="First page" disabled={!shown} onClick={() => go(0)}><ChevronsLeft size={16}/></button>
        <button className="icon-button" aria-label="Previous pages" title="Previous pages (←)" disabled={!shown} onClick={() => go(target() - 1)}><ArrowLeft size={16}/></button>
        <span>{label}</span>
        <button className="icon-button" aria-label="Next pages" title="Next pages (→)" disabled={shown >= maxSpread} onClick={() => go(target() + 1)}><ArrowRight size={16}/></button>
        <button className="icon-button" aria-label="Last page" title="Last page" disabled={shown >= maxSpread} onClick={() => go(maxSpread)}><ChevronsRight size={16}/></button>
      </div>
      <div className="preview-tools">
        <select aria-label="Jump to chapter" value={current >= 0 ? project.chapters[current].id : ''} onChange={e => { const p = starts[e.target.value]; if (p !== undefined) goPage(p); else go(0); }}><option value="">Title & contents</option>{project.chapters.map((c, i) => <option key={c.id} value={c.id}>{i + 1}. {c.title}</option>)}</select>
        <button className="icon-button" aria-label="Smaller book text" title="Smaller text" disabled={scale <= .8} onClick={() => setScale(Math.round((scale - .1) * 10) / 10)}><span className="small-a">A</span></button>
        <button className="icon-button" aria-label="Larger book text" title="Larger text" disabled={scale >= 1.5} onClick={() => setScale(Math.round((scale + .1) * 10) / 10)}><span className="large-a">A</span></button>
        <button className="text-button" disabled={current < 0} onClick={() => current >= 0 && onEdit(project.chapters[current].id)}><PenLine size={14}/><span>Edit this chapter</span></button>
      </div>
    </div>
    <div className="preview-stage" ref={stage}>
      {size.w > 0 && <div ref={bookRef} className={`book ${flip ? 'turning' : ''} ${spread > 0 ? 'can-prev' : ''} ${spread < maxSpread ? 'can-next' : ''}`} style={{ width: pageW * 2, height: pageH, '--book-font': `${font}px`, '--text-h': `${g.textH}px`, '--page-w': `${pageW}px` } as CSSProperties}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div className="book-half left"><Page info={info(leftIndex)} side="left" g={g}/></div>
        <div className="book-half right"><Page info={info(rightIndex)} side="right" g={g}/></div>
        <div className="book-spine"/>
        {leaf}
        {/* Invisible copy of the whole flow, used only to count pages and find chapter starts. */}
        <div className="book-measure" aria-hidden="true"><div className="book-flow" ref={measureFlow} style={{ width: g.colW, height: g.textH, columnCount: 1, columnGap: 2 * mx }}>{front}{sections}<span ref={end} className="book-end-marker"/></div></div>
      </div>}
    </div>
    <div className="preview-footer">
      <input type="range" aria-label="Page" min={0} max={maxSpread} value={shown} onChange={e => go(Number(e.target.value))} disabled={!maxSpread}/>
      <span><Feather size={12}/>Drag a page, click it, or use ← →</span>
    </div>
  </div>;
}
