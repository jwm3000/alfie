import { useEffect, useRef, useState } from 'react';

// A small, round black cat that strolls along the bottom of the window.
// Now and then it sits down for a moment; clicking it makes it purr.
type Mode = 'walk' | 'sit';
const SPEED = 52; // px per second
const W = 76;

function Head() {
  return <g className="cat-head">
    <g className="cat-ear left"><path d="M43 18 L44.5 5.5 L52.5 13.5 Z" fill="#1b1816"/><path d="M45 15.5 L45.8 9 L49.8 13 Z" fill="#e8a3a6"/></g>
    <g className="cat-ear right"><path d="M55 13 L63 6 L63.5 18.5 Z" fill="#1b1816"/><path d="M57.5 13.5 L61.6 10 L61.8 15.5 Z" fill="#e8a3a6"/></g>
    <ellipse cx="53" cy="24" rx="12.5" ry="11.2" fill="#1b1816"/>
    <g className="cat-eyes">
      <ellipse cx="48.6" cy="23.6" rx="2.6" ry="3.1" fill="#f3d55e"/><ellipse cx="49.1" cy="24" rx="1.3" ry="2.3" fill="#0d0b0a"/><circle cx="48.2" cy="22.5" r=".85" fill="#fff"/>
      <ellipse cx="57.6" cy="23.6" rx="2.6" ry="3.1" fill="#f3d55e"/><ellipse cx="58.1" cy="24" rx="1.3" ry="2.3" fill="#0d0b0a"/><circle cx="57.2" cy="22.5" r=".85" fill="#fff"/>
    </g>
    <path className="cat-happy-eyes" d="M46.3 24 q2.3 -2.6 4.6 0 M55.3 24 q2.3 -2.6 4.6 0" fill="none" stroke="#f3d55e" strokeWidth="1.3" strokeLinecap="round"/>
    <ellipse cx="45.4" cy="28.6" rx="2.1" ry="1.2" fill="#e88b93" opacity=".55"/><ellipse cx="60.8" cy="28.6" rx="2.1" ry="1.2" fill="#e88b93" opacity=".55"/>
    <path d="M52 27.6 h2.2 l-1.1 1.3 Z" fill="#f0a3a8"/>
    <path d="M53.1 28.9 q-1 1.4 -2.2 .6 M53.1 28.9 q1 1.4 2.2 .6" fill="none" stroke="#6b5a55" strokeWidth=".6" strokeLinecap="round"/>
    <path d="M41 26.5 l-5 -1 M41 28.4 l-5 .6 M65 26.5 l5 -1 M65 28.4 l5 .6" stroke="#8d8079" strokeWidth=".45" strokeLinecap="round"/>
  </g>;
}

export default function WalkingCat() {
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('walk');
  const [dir, setDir] = useState(1);
  const [hearts, setHearts] = useState<{ id: number; dx: number }[]>([]);
  const st = useRef({ x: -W, dir: 1, mode: 'walk' as Mode, until: 0, purr: 0 });

  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const s = st.current, dt = Math.min(.05, (now - last) / 1000); last = now;
      const max = window.innerWidth - W + 4;
      if (s.mode === 'walk') {
        s.x += s.dir * SPEED * dt;
        if (s.x > max && s.dir > 0) { s.dir = -1; setDir(-1); }
        if (s.x < -4 && s.dir < 0) { s.dir = 1; setDir(1); }
        if (s.x > 20 && s.x < max - 20 && Math.random() < dt * .09) { s.mode = 'sit'; s.until = now + 2600 + Math.random() * 2600; setMode('sit'); }
      } else if (now > s.until) {
        s.mode = 'walk'; setMode('walk');
        if (Math.random() < .35) { s.dir = -s.dir; setDir(s.dir); }
      }
      if (root.current) root.current.style.transform = `translateX(${s.x}px)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pet = () => {
    const s = st.current; s.mode = 'sit'; s.until = performance.now() + 3200; setMode('sit');
    const id = ++s.purr;
    setHearts(h => [...h, { id, dx: -8 }, { id: id + .3, dx: 6 }, { id: id + .6, dx: -1 }].slice(-9));
    setTimeout(() => setHearts(h => h.filter(x => Math.floor(x.id) !== id)), 1900);
  };

  return <div className="walking-cat" ref={root} aria-hidden="true">
    <div className={`cat-sprite ${mode} ${hearts.length ? 'purring' : ''}`} style={{ transform: `scaleX(${dir})` }} onClick={pet} title="Pet Alfie">
      <svg viewBox="0 0 80 60" width={W} height={57}>
        <ellipse className="cat-ground" cx="40" cy="57.5" rx="22" ry="2" fill="#000" opacity=".12"/>
        <g className="pose-walk">
          <path className="cat-tail" d="M21 34 C 11 33, 8 22, 13 15 C 16 11, 21 12.5, 19.5 16.5" fill="none" stroke="#1b1816" strokeWidth="4.6" strokeLinecap="round"/>
          <rect className="cat-leg leg-a" x="22" y="37" width="5" height="13" rx="2.5" fill="#100e0d"/>
          <rect className="cat-leg leg-b" x="40.5" y="37" width="5" height="13" rx="2.5" fill="#100e0d"/>
          <g className="cat-torso"><ellipse cx="33.5" cy="36" rx="15.5" ry="9.6" fill="#1b1816"/></g>
          <rect className="cat-leg leg-b" x="26.5" y="37.5" width="5" height="13" rx="2.5" fill="#1b1816"/>
          <rect className="cat-leg leg-a" x="45" y="37.5" width="5" height="13" rx="2.5" fill="#1b1816"/>
          <Head/>
        </g>
        <g className="pose-sit">
          <path className="cat-tail-sit" d="M27 52 C 20 52, 15 47, 17 41 C 18.5 37, 22 38, 21 41" fill="none" stroke="#1b1816" strokeWidth="4.6" strokeLinecap="round"/>
          <path d="M28 54 C 24 46, 27 31, 38 30 C 49 31, 52 46, 48 54 Z" fill="#1b1816"/>
          <ellipse cx="34.5" cy="53.5" rx="3.6" ry="2.4" fill="#211d1a"/><ellipse cx="42.5" cy="53.5" rx="3.6" ry="2.4" fill="#211d1a"/>
          <g transform="translate(-14 4)"><Head/></g>
        </g>
      </svg>
      {hearts.map(h => <span key={h.id} className="cat-heart" style={{ left: 38 + h.dx, animationDelay: `${(h.id % 1) * 400}ms` }}>♥</span>)}
    </div>
  </div>;
}
