// The little round cat that brings the companion panel back. It blinks and twitches an ear now and then;
// on hover it perks up, on click it hops before the panel opens.
import { useState } from 'react';

export default function CatButton({ onClick }: { onClick: () => void }) {
  const [hop, setHop] = useState(false);
  return <button className={`cat-toggle ${hop ? 'hop' : ''}`} aria-label="Show Alfie's companion panel" title="Bring Alfie back"
    onClick={() => { if (hop) return; setHop(true); setTimeout(() => { setHop(false); onClick(); }, 260); }}>
    <svg className="cat-face" viewBox="0 -0.5 32 32" aria-hidden="true">
      <g className="cat-face-head">
        <path className="ear ear-l" d="M7.5 13 L8.6 4.6 L14.2 9.6 Z" fill="currentColor"/>
        <path className="ear ear-r" d="M17.8 9.6 L23.4 4.6 L24.5 13 Z" fill="currentColor"/>
        <ellipse cx="16" cy="17" rx="10" ry="8.6" fill="currentColor"/>
        <g className="eyes"><ellipse cx="12.2" cy="16.4" rx="1.55" ry="2" fill="var(--accent)"/><ellipse cx="19.8" cy="16.4" rx="1.55" ry="2" fill="var(--accent)"/></g>
        <path d="M15 19.6 h2 l-1 1.1 Z" fill="var(--accent)"/>
        <path d="M16 20.7 q-.9 1.2 -2 .5 M16 20.7 q.9 1.2 2 .5" fill="none" stroke="var(--accent)" strokeWidth=".7" strokeLinecap="round"/>
      </g>
    </svg>
  </button>;
}
