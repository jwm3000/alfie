import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ChevronsLeft, ChevronsRight, Feather, PenLine } from 'lucide-react';
import type { Chapter, Project } from './model';

const RATIO = 0.68; // page width / height, close to a trade paperback
const BEND = 26; // degrees the outer half of a turning leaf curls ahead of the inner half
const spelled = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const chapterLabel = (i: number) => `Chapter ${spelled[i] || i + 1}`;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

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
// Half of one side of a turning leaf: a window onto half of a page.
function Face({ info, side, g, half, back, shadeRef }: { info: PageInfo; side: 'left' | 'right'; g: Geometry; half: 0 | 1; back?: boolean; shadeRef: (el: HTMLDivElement | null) => void }) {
  return <div className={`leaf-face ${back ? 'back' : 'front'}`}>
    <div style={{ transform: `translateX(${-half * g.pageW / 2}px)` }}><Page info={info} side={side} g={g}/></div>
    <div className={`leaf-shade ${side}`} ref={shadeRef}/>
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

  // ---- turning ----
  const flipRef = useRef(flip); flipRef.current = flip;
  const geo = useRef(g); geo.current = g;
  const raf = useRef(0);
  const inner = useRef<HTMLDivElement>(null), outer = useRef<HTMLDivElement>(null), cast = useRef<HTMLDivElement>(null);
  const shades = useRef<(HTMLDivElement | null)[]>([]);
  // Spring physics for the turning leaf: angle a (0 = flat on its own side, 180 = turned), angular velocity v (deg/s).
  const phys = useRef({ a: 0, v: 0, target: 0, k: 14, zeta: .82, dragging: false, running: false, last: 0 });
  const drag = useRef<{ x0: number; grab: number; moved: boolean; side: 'next' | 'prev'; id: number } | null>(null);

  // Bend of the outer half: pulled ahead while dragging, trailing behind (air drag) when the leaf swings fast.
  const bendFor = (a: number, v: number, dragging: boolean) => {
    const raw = Math.sin(a * Math.PI / 180) * (dragging ? BEND : BEND * .3) - v * .045;
    return Math.min(Math.max(raw, -38, .5 - a), 38, 179.5 - a);
  };
  const paint = (a: number, v: number, dragging: boolean) => {
    const f = flipRef.current; if (!f || !inner.current || !outer.current) return;
    const P = geo.current.pageW, s = f.dir === 'next' ? -1 : 1, rad = a * Math.PI / 180;
    const b = bendFor(a, v, dragging);
    inner.current.style.transform = `rotateY(${s * a}deg) translateZ(${Math.sin(rad) * 2}px)`;
    outer.current.style.transform = `rotateY(${s * b}deg)`;
    const dark = (t: number, back: boolean) => { const c = Math.cos(t * Math.PI / 180); return back ? .5 * clamp(1 + c) : .5 * clamp(1 - c); };
    const [fi, bi, fo, bo] = shades.current;
    if (fi) fi.style.opacity = String(dark(a, false)); if (bi) bi.style.opacity = String(dark(a, true));
    if (fo) fo.style.opacity = String(dark(a + b, false)); if (bo) bo.style.opacity = String(dark(a + b, true));
    if (cast.current) {
      const edge = P / 2 * (Math.cos(rad) + Math.cos((a + b) * Math.PI / 180)); // projected distance of the leaf's edge from the spine
      const dirOut = f.dir === 'next' ? 1 : -1, d = edge >= 0 ? dirOut : -dirOut;
      const lift = Math.sin(rad), pos = P + dirOut * edge, w = Math.max(8, P * .3 * lift);
      cast.current.style.left = `${d > 0 ? pos : pos - w}px`; cast.current.style.width = `${w}px`;
      cast.current.style.background = `linear-gradient(${d > 0 ? 'to right' : 'to left'}, rgba(40,25,10,${.34 * lift}), transparent)`;
    }
  };
  const loop = (now: number) => {
    const ph = phys.current, dt = Math.min(.032, (now - ph.last) / 1000); ph.last = now;
    // Semi-implicit Euler in two sub-steps keeps the stiff drag spring stable.
    for (let i = 0; i < 2; i++) {
      const h = dt / 2, c = 2 * Math.sqrt(ph.k) * ph.zeta;
      ph.v += (ph.k * (ph.target - ph.a) - c * ph.v) * h; ph.a += ph.v * h;
      if (ph.a <= 0) { ph.a = 0; if (ph.v < 0) ph.v = ph.dragging ? 0 : -ph.v * .12; } // lands on the book with a tiny bounce
      if (ph.a >= 180) { ph.a = 180; if (ph.v > 0) ph.v = ph.dragging ? 0 : -ph.v * .12; }
    }
    paint(ph.a, ph.v, ph.dragging);
    if (!ph.dragging && Math.abs(ph.a - ph.target) < .35 && Math.abs(ph.v) < 6) { ph.running = false; ph.target === 180 ? finishFlip() : cancelFlip(); return; }
    raf.current = requestAnimationFrame(loop);
  };
  const kick = () => { const ph = phys.current; if (ph.running) return; ph.running = true; ph.last = performance.now(); raf.current = requestAnimationFrame(loop); };
  const finishFlip = () => {
    const f = flipRef.current; if (!f) return;
    setSpread(f.to); setFlip(null);
    const next = pending.current; pending.current = null;
    if (next !== null && next !== f.to) requestAnimationFrame(() => startFlip(f.to, next));
  };
  const cancelFlip = () => { setFlip(null); pending.current = null; };
  const startFlip = (from: number, n: number, auto = true) => { const to = Math.min(maxSpread, Math.max(0, n)); if (to === from) return false; setFlip({ dir: to > from ? 'next' : 'prev', from, to, auto }); return true; };
  useLayoutEffect(() => {
    if (!flip) return;
    const ph = phys.current;
    if (flip.auto) Object.assign(ph, { a: 0, v: 160, target: 180, k: pending.current !== null ? 60 : 22, zeta: .78, dragging: false });
    paint(ph.a, ph.v, ph.dragging); kick();
  }, [flip]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const go = (n: number) => { if (flipRef.current) { pending.current = n; return; } startFlip(spread, n); };
  const target = () => pending.current ?? flip?.to ?? spread;
  const goPage = (page: number) => go(Math.floor(page / 2));

  // Angle at which the grabbed point of the (bent) leaf sits exactly under the pointer.
  const solveAngle = (dx: number, grab: number) => {
    const P = geo.current.pageW, H = P / 2;
    const proj = (a: number) => { const r = a * Math.PI / 180; return grab <= H ? grab * Math.cos(r) : H * Math.cos(r) + (grab - H) * Math.cos(r + bendFor(a, 0, true) * Math.PI / 180); };
    if (dx >= proj(0)) return 0; if (dx <= proj(180)) return 180;
    let lo = 0, hi = 180;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (proj(mid) > dx) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  const spineDistance = (clientX: number, side: 'next' | 'prev') => { const r = bookRef.current!.getBoundingClientRect(); const x = clientX - r.left - r.width / 2; return side === 'next' ? x : -x; };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || flipRef.current || !bookRef.current) return;
    const r = bookRef.current.getBoundingClientRect();
    const side = e.clientX - r.left > r.width / 2 ? 'next' : 'prev';
    if ((side === 'next' && spread >= maxSpread) || (side === 'prev' && spread <= 0)) return;
    const grab = clamp(spineDistance(e.clientX, side), pageW * .3, pageW);
    drag.current = { x0: e.clientX, grab, moved: false, side, id: e.pointerId };
    bookRef.current.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x0) < 5) return;
      d.moved = true;
      Object.assign(phys.current, { a: 0, v: 0, k: 320, zeta: 1, dragging: true });
      startFlip(spread, spread + (d.side === 'next' ? 1 : -1), false);
    }
    phys.current.target = solveAngle(spineDistance(e.clientX, d.side), d.grab);
    kick();
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return; drag.current = null;
    if (!d.moved) {
      const toc = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]');
      if (toc) { if (toc.dataset.goto !== '') goPage(Number(toc.dataset.goto)); return; }
      go(spread + (d.side === 'next' ? 1 : -1)); return;
    }
    const ph = phys.current, flick = 140;
    const done = ph.v > flick || (ph.v > -flick && ph.a > 80);
    Object.assign(ph, { dragging: false, k: 40, zeta: .8, target: done ? 180 : 0 });
    kick();
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
  const setShade = (i: number) => (el: HTMLDivElement | null) => { shades.current[i] = el; };

  let leaf: ReactNode = null;
  if (flip) {
    const fs = flip.dir === 'next' ? 'right' : 'left', bs = flip.dir === 'next' ? 'left' : 'right';
    const fInfo = info(frontIdx), bInfo = info(backIdx), H = pageW / 2;
    leaf = flip.dir === 'next'
      ? <div className="book-leaf" ref={inner} style={{ left: pageW, width: H, transformOrigin: '0 50%' }}>
          <Face info={fInfo} side={fs} g={g} half={0} shadeRef={setShade(0)}/>
          <Face info={bInfo} side={bs} g={g} half={1} back shadeRef={setShade(1)}/>
          <div className="leaf-seg" ref={outer} style={{ left: '100%', width: H, transformOrigin: '0 50%' }}>
            <Face info={fInfo} side={fs} g={g} half={1} shadeRef={setShade(2)}/>
            <Face info={bInfo} side={bs} g={g} half={0} back shadeRef={setShade(3)}/>
          </div>
        </div>
      : <div className="book-leaf" ref={inner} style={{ left: H, width: H, transformOrigin: '100% 50%' }}>
          <Face info={fInfo} side={fs} g={g} half={1} shadeRef={setShade(0)}/>
          <Face info={bInfo} side={bs} g={g} half={0} back shadeRef={setShade(1)}/>
          <div className="leaf-seg" ref={outer} style={{ right: '100%', width: H, transformOrigin: '100% 50%' }}>
            <Face info={fInfo} side={fs} g={g} half={0} shadeRef={setShade(2)}/>
            <Face info={bInfo} side={bs} g={g} half={1} back shadeRef={setShade(3)}/>
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
        {flip && <div className="book-cast" ref={cast}/>}
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
