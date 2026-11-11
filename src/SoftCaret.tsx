import { useEffect, useRef, type RefObject } from 'react';

// WebKit draws the text cursor as tall as the whole line box, so with Alfie's airy line height it towered over
// the letters. The native caret is hidden (caret-color: transparent) and this one, sized to the glyphs, is drawn
// in its place. A hidden mirror measures where the caret sits: the text before the current paragraph lives in its
// own block that only changes when the caret moves to another paragraph, so typing re-lays out just one paragraph.
export default function SoftCaret({ editor, watch }: { editor: RefObject<HTMLTextAreaElement | null>; watch: unknown }) {
  const caret = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ta = editor.current, c = caret.current, host = ta?.parentElement;
    if (!ta || !c || !host) return;
    const mirror = document.createElement('div'), before = document.createElement('div'), line = document.createElement('div'), text = document.createTextNode(''), mark = document.createElement('span');
    mirror.className = 'soft-caret-mirror'; mirror.setAttribute('aria-hidden', 'true'); mark.textContent = '​';
    line.append(text, mark); mirror.append(before, line); host.append(mirror);
    let prefix: string | null | undefined, width = -1, frame = 0;
    const sync = () => {
      const cs = getComputedStyle(ta);
      for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'tabSize', 'fontKerning', 'fontVariantLigatures'] as const) (mirror.style as unknown as Record<string, string>)[k] = (cs as unknown as Record<string, string>)[k];
      width = ta.clientWidth; mirror.style.width = width + 'px'; prefix = undefined;
    };
    const place = () => {
      frame = 0;
      const s = ta.selectionStart;
      if (document.activeElement !== ta || s !== ta.selectionEnd) { c.style.display = 'none'; return; }
      if (ta.clientWidth !== width) sync();
      mirror.style.top = ta.offsetTop + 'px'; mirror.style.left = ta.offsetLeft + 'px';
      const v = ta.value, start = v.lastIndexOf('\n', s - 1) + 1, pre = start ? v.slice(0, start - 1) : null;
      if (pre !== prefix) { prefix = pre; before.style.display = pre === null ? 'none' : ''; before.textContent = pre === null ? '' : pre + (pre === '' || pre.endsWith('\n') ? '​' : ''); }
      text.data = v.slice(start, s);
      c.style.display = '';
      c.style.transform = `translate(${ta.offsetLeft + mark.offsetLeft}px, ${ta.offsetTop + mark.offsetTop}px)`;
      c.style.height = mark.offsetHeight + 'px';
      c.classList.remove('blink'); void c.offsetWidth; c.classList.add('blink');
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    const events = ['input', 'focus', 'blur', 'keydown', 'mousedown', 'mouseup', 'select'];
    events.forEach(e => ta.addEventListener(e, schedule)); document.addEventListener('selectionchange', schedule);
    const ro = new ResizeObserver(schedule); ro.observe(ta);
    sync(); schedule();
    return () => { cancelAnimationFrame(frame); events.forEach(e => ta.removeEventListener(e, schedule)); document.removeEventListener('selectionchange', schedule); ro.disconnect(); mirror.remove(); };
  }, [editor, watch]);
  return <div ref={caret} className="soft-caret" aria-hidden="true" style={{ display: 'none' }}/>;
}
