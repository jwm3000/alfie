import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Strike from '@tiptap/extension-strike';
import Blockquote from '@tiptap/extension-blockquote';
import { ListItem } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import type { Node as PMNode } from '@tiptap/pm/model';
import { ArrowUp, Bold, Check, Heading2, Heading3, Highlighter, Italic, List, ListOrdered, MessageSquarePlus, MessageSquareText, Minus, Pilcrow, Quote, Strikethrough, Trash2, Underline as UnderlineIcon, X } from 'lucide-react';
import { mdToDoc } from './rich';
import { Comments, blockAt, commentState, commentsKey } from './comments';
import { uid, type Thread } from './model';

export const FONTS = [
  { id: 'georgia', name: 'Georgia', note: 'Classic and familiar', family: "Georgia, 'Times New Roman', serif", scale: 1 },
  { id: 'literata', name: 'Literata', note: 'Made for long reading', family: "'Literata', Georgia, serif", scale: .96 },
  { id: 'garamond', name: 'EB Garamond', note: 'An old-style book face', family: "'EB Garamond', Georgia, serif", scale: 1.1 },
  { id: 'lora', name: 'Lora', note: 'Soft, warm, contemporary', family: "'Lora', Georgia, serif", scale: .97 },
  { id: 'inter', name: 'Inter', note: 'Clean and modern sans', family: "'Inter', system-ui, sans-serif", scale: .92 },
  { id: 'mono', name: 'IBM Plex Mono', note: 'Like a typewriter', family: "'IBM Plex Mono', ui-monospace, monospace", scale: .86 },
] as const;
export const fontFor = (id?: string) => FONTS.find(f => f.id === id) || FONTS[0];

export type EditorApi = { open: (threadId: string) => void; commentHere: () => void };
type Props = {
  chapterId: string; text: string; threads: Thread[]; author: string; placeholder: string; showComments: boolean;
  isOwnText: (text: string) => boolean; onDoc: (doc: PMNode) => void; onBlur: () => void;
  onThreads: (update: (threads: Thread[]) => Thread[]) => void; onReady: (editor: Editor | null) => void; onLocated: (ids: Set<string>) => void;
  api: RefObject<EditorApi | null>;
};
const when = (iso: string) => { const s = (Date.now() - Date.parse(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const initial = (name: string) => (name.trim()[0] || '·').toUpperCase();

// Keep Alt+↑/↓ for chapter navigation instead of ProseMirror's "join block" commands.
const AlfieKeys = Extension.create({ name: 'alfieKeys', addKeyboardShortcuts() { return { 'Alt-ArrowUp': () => true, 'Alt-ArrowDown': () => true }; } });

export default function RichEditor(p: Props) {
  const props = useRef(p); props.current = p;
  const host = useRef<HTMLDivElement>(null), caret = useRef<HTMLDivElement>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, code: false, codeBlock: false, link: false, strike: false, blockquote: false, listItem: false }),
      // The schema allows exactly what the Markdown format can store: quotes hold paragraphs, list items one paragraph.
      Blockquote.extend({ content: 'paragraph+' }), ListItem.extend({ content: 'paragraph' }),
      // Ctrl+Shift+S keeps a version in Alfie, so strikethrough lives on Ctrl+Shift+X.
      Strike.extend({ addKeyboardShortcuts() { return { 'Mod-Shift-x': () => this.editor.commands.toggleStrike() }; } }),
      Highlight, Comments, AlfieKeys,
      Placeholder.configure({ placeholder: p.placeholder }),
    ],
    content: mdToDoc(p.text),
    editorProps: {
      attributes: { class: 'manuscript-editor', spellcheck: 'true', 'aria-label': 'Chapter manuscript' },
      handleKeyDown: (_v, e) => { if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'm') { e.preventDefault(); props.current.api.current?.commentHere(); return true; } return false; },
    },
    onUpdate: ({ editor }) => props.current.onDoc(editor.state.doc),
    onBlur: () => props.current.onBlur(),
  }, [p.chapterId]);
  useEffect(() => { p.onReady(editor); return () => p.onReady(null); }, [editor]);
  // The text changed outside the editor (a branch was restored, the project reloaded): show it.
  const shown = useRef(p.text);
  useEffect(() => { if (!editor || p.text === shown.current) return; shown.current = p.text; if (!p.isOwnText(p.text)) editor.commands.setContent(mdToDoc(p.text), { emitUpdate: false }); }, [p.text, editor]);
  useEffect(() => { if (editor) editor.view.dispatch(editor.state.tr.setMeta(commentsKey, { threads: p.threads }).setMeta('addToHistory', false)); }, [p.threads, editor]);

  // ---- layout: a caret as tall as the letters, comment markers in the margin ----
  const [markers, setMarkers] = useState<{ pos: number; top: number; count: number }[]>([]);
  const [gutter, setGutter] = useState(0);
  const [hover, setHover] = useState<{ pos: number; top: number } | null>(null);
  const [open, setOpen] = useState<{ pos: number; draft: boolean } | null>(null);
  const located = useRef('');
  useEffect(() => {
    if (!editor) return;
    let frame = 0;
    const layout = () => {
      frame = 0; const h = host.current; if (!h || editor.isDestroyed) return;
      const view = editor.view, hb = h.getBoundingClientRect(), eb = view.dom.getBoundingClientRect();
      setGutter(eb.right - hb.left);
      // caret
      const c = caret.current, sel = editor.state.selection;
      if (c) {
        if (!view.hasFocus() || !sel.empty) c.style.display = 'none';
        else {
          const r = view.coordsAtPos(sel.head), size = parseFloat(getComputedStyle(view.dom).fontSize) || 20;
          let top = r.top, height = r.bottom - r.top; if (height > size * 1.45 || height < 4) { top = top + (height - size * 1.2) / 2; height = size * 1.2; }
          c.style.display = ''; c.style.height = `${height}px`; c.style.transform = `translate(${r.left - hb.left - 1}px, ${top - hb.top}px)`;
          c.classList.remove('blink'); void c.offsetWidth; c.classList.add('blink');
        }
      }
      // markers: one per paragraph with open threads
      const st = commentState(editor.state), byPos = new Map<number, number>();
      for (const t of st.threads) { const pos = st.pos.get(t.id); if (pos !== undefined && !t.resolved) byPos.set(pos, (byPos.get(pos) || 0) + t.comments.length); }
      const next: { pos: number; top: number; count: number }[] = [];
      for (const [pos, count] of byPos) { const dom = view.nodeDOM(pos) as HTMLElement | null; if (dom?.getBoundingClientRect) next.push({ pos, count, top: dom.getBoundingClientRect().top - hb.top }); }
      setMarkers(m => JSON.stringify(m) === JSON.stringify(next) ? m : next);
      const ids = [...st.pos.keys()].sort().join(','); if (ids !== located.current) { located.current = ids; props.current.onLocated(new Set(st.pos.keys())); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(layout); };
    editor.on('transaction', schedule); editor.on('focus', schedule); editor.on('blur', schedule);
    const ro = new ResizeObserver(schedule); ro.observe(editor.view.dom); if (host.current) ro.observe(host.current);
    schedule();
    return () => { cancelAnimationFrame(frame); editor.off('transaction', schedule); editor.off('focus', schedule); editor.off('blur', schedule); ro.disconnect(); };
  }, [editor]);

  // Keep each thread's stored anchor in step with its paragraph while writing (quietly, after a pause).
  useEffect(() => {
    if (!editor) return;
    let t = 0;
    const sync = () => { clearTimeout(t); t = window.setTimeout(() => {
      if (editor.isDestroyed) return;
      const st = commentState(editor.state), changes = new Map<string, { anchor: string; hint: number }>();
      for (const th of st.threads) { const pos = st.pos.get(th.id); if (pos === undefined) continue; const b = blockAt(editor.state, pos + 1); if (b && (b.text !== th.anchor || b.index !== th.hint) && b.text.trim()) changes.set(th.id, { anchor: b.text, hint: b.index }); }
      if (changes.size) props.current.onThreads(list => list.map(th => changes.has(th.id) ? { ...th, ...changes.get(th.id)! } : th));
    }, 900); };
    editor.on('update', sync); return () => { clearTimeout(t); editor.off('update', sync); };
  }, [editor]);

  const blockTop = (pos: number) => { const dom = editor?.view.nodeDOM(pos) as HTMLElement | null, h = host.current; return dom && h ? dom.getBoundingClientRect().top - h.getBoundingClientRect().top : 0; };
  const setActive = (pos: number | null) => { if (!editor) return; const st = commentState(editor.state); const id = pos === null ? null : st.threads.find(t => st.pos.get(t.id) === pos && !t.resolved)?.id ?? null; editor.view.dispatch(editor.state.tr.setMeta(commentsKey, { active: id, hover: id ? null : pos }).setMeta('addToHistory', false)); };
  const openAt = (pos: number) => { setOpen({ pos, draft: !threadsAt(pos).length }); setActive(pos); };
  const close = () => { setOpen(null); setActive(null); };
  const threadsAt = (pos: number) => { if (!editor) return []; const st = commentState(editor.state); return st.threads.filter(t => st.pos.get(t.id) === pos && !t.resolved); };
  p.api.current = {
    open: id => { if (!editor) return; const pos = commentState(editor.state).pos.get(id); if (pos === undefined) return; const dom = editor.view.nodeDOM(pos) as HTMLElement | null; dom?.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => openAt(pos), 250); },
    commentHere: () => { if (!editor) return; const b = blockAt(editor.state, editor.state.selection.from); if (b) openAt(b.pos); },
  };

  // Hover a line → a "comment" button appears in the margin next to it.
  const onMove = (e: React.MouseEvent) => {
    if (!editor || open || !p.showComments) return;
    const view = editor.view, eb = view.dom.getBoundingClientRect();
    if ((e.target as HTMLElement).closest('.comment-add,.comment-marker')) return;
    if (e.clientY < eb.top || e.clientY > eb.bottom) { if (hover) setHover(null); return; }
    const at = view.posAtCoords({ left: Math.min(Math.max(e.clientX, eb.left + 4), eb.right - 4), top: e.clientY });
    const b = at && blockAt(editor.state, at.pos);
    if (!b || !b.text.trim()) { if (hover) setHover(null); return; }
    if (hover?.pos !== b.pos) setHover({ pos: b.pos, top: blockTop(b.pos) });
  };

  // Leaving the text towards the margin must not hide the button: the margin strip belongs to the hover area,
  // and a short grace period covers quick or diagonal mouse moves.
  const leaveTimer = useRef(0);
  return <div ref={host} className={`rich-host ${p.showComments ? '' : 'no-comments'}`} onMouseMove={e => { clearTimeout(leaveTimer.current); onMove(e); }} onMouseLeave={() => { clearTimeout(leaveTimer.current); leaveTimer.current = window.setTimeout(() => setHover(null), 350); }}>
    <EditorContent editor={editor}/>
    <div ref={caret} className="soft-caret" aria-hidden="true" style={{ display: 'none' }}/>
    {editor && <BubbleMenu editor={editor} className="bubble" options={{ placement: 'top', offset: 8 }}>
      <MarkButtons editor={editor} compact/>
      {p.showComments && <><span className="bubble-sep"/><button className="bubble-comment" title="Comment on this line (Ctrl+Alt+M)" onMouseDown={e => e.preventDefault()} onClick={() => p.api.current?.commentHere()}><MessageSquarePlus size={15}/>Comment</button></>}
    </BubbleMenu>}
    {p.showComments && <div className="comment-gutter" style={{ left: gutter } as CSSProperties}>
      {markers.map(m => <button key={m.pos} className={`comment-marker ${open?.pos === m.pos ? 'open' : ''}`} style={{ top: m.top }} title="Show comments" onClick={() => open?.pos === m.pos ? close() : openAt(m.pos)}><MessageSquareText size={14}/>{m.count}</button>)}
      {hover && !open && !markers.some(m => m.pos === hover.pos) && <button className="comment-add" style={{ top: hover.top }} title="Comment on this line (Ctrl+Alt+M)" onMouseEnter={() => setActive(hover.pos)} onMouseLeave={() => setActive(null)} onClick={() => openAt(hover.pos)}><MessageSquarePlus size={15}/></button>}
    </div>}
    {open && editor && <ThreadPopover key={open.pos} editor={editor} pos={open.pos} threads={threadsAt(open.pos)} author={p.author} anchorTop={blockTop(open.pos)} host={host}
      onClose={close}
      onPost={text => {
        const b = blockAt(editor.state, open.pos + 1); if (!b) return;
        const now = new Date().toISOString(), comment = { id: uid(), author: p.author, text, createdAt: now }, existing = threadsAt(open.pos)[0];
        p.onThreads(list => existing ? list.map(t => t.id === existing.id ? { ...t, comments: [...t.comments, comment] } : t) : [...list, { id: uid(), anchor: b.text, hint: b.index, resolved: false, createdAt: now, comments: [comment] }]);
        setOpen({ pos: open.pos, draft: false });
      }}
      onResolve={id => { p.onThreads(list => list.map(t => t.id === id ? { ...t, resolved: true } : t)); close(); }}
      onDelete={(threadId, commentId) => p.onThreads(list => list.flatMap(t => t.id !== threadId ? [t] : t.comments.length <= 1 ? [] : [{ ...t, comments: t.comments.filter(c => c.id !== commentId) }]))}
    />}
  </div>;
}

function ThreadPopover({ editor, pos, threads, author, anchorTop, host, onClose, onPost, onResolve, onDelete }: { editor: Editor; pos: number; threads: Thread[]; author: string; anchorTop: number; host: RefObject<HTMLDivElement | null>; onClose: () => void; onPost: (text: string) => void; onResolve: (id: string) => void; onDelete: (threadId: string, commentId: string) => void }) {
  const [draft, setDraft] = useState(''); const box = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const quote = editor.state.doc.nodeAt(pos)?.textContent || '';
  // Fixed to the viewport next to the paragraph's margin marker; follows scrolling and stays on screen.
  useLayoutEffect(() => {
    const at = () => {
      const h = host.current, b = box.current; if (!h || !b) return;
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null; if (!dom) return;
      const r = dom.getBoundingClientRect(), eb = editor.view.dom.getBoundingClientRect(), w = b.offsetWidth, hgt = b.offsetHeight;
      let left = eb.right + 74; if (left + w > window.innerWidth - 14) left = Math.max(14, eb.right - w + 30);
      const top = Math.min(Math.max(r.top - 10, 74), window.innerHeight - hgt - 14);
      setPlace(p => p && p.left === left && p.top === top ? p : { left, top });
    };
    at(); const ro = new ResizeObserver(at); if (box.current) ro.observe(box.current);
    window.addEventListener('scroll', at, true); window.addEventListener('resize', at); editor.on('transaction', at);
    return () => { ro.disconnect(); window.removeEventListener('scroll', at, true); window.removeEventListener('resize', at); editor.off('transaction', at); };
  }, [pos, anchorTop]);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const away = (e: MouseEvent) => { const t = e.target as HTMLElement; if (!box.current?.contains(t) && !t.closest('.comment-marker,.comment-add,.bubble,.companion-comments')) onClose(); };
    document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away);
  }, []);
  const send = () => { const t = draft.trim(); if (!t) return; onPost(t); setDraft(''); };
  const grow = (el: HTMLTextAreaElement) => { el.style.height = '0px'; el.style.height = Math.min(160, el.scrollHeight) + 'px'; };
  return createPortal(<div ref={box} className="thread-pop" role="dialog" aria-label="Comments on this paragraph" style={{ left: place?.left ?? -9999, top: place?.top ?? -9999 }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); editor.commands.focus(); } }}>
    <div className="thread-head"><span>{threads.length ? 'Comments' : 'New comment'}</span><button className="icon-button" aria-label="Close comments" onClick={onClose}><X size={14}/></button></div>
    {quote && <blockquote className="thread-quote">{quote.length > 140 ? quote.slice(0, 140) + '…' : quote}</blockquote>}
    {threads.map(t => <div key={t.id} className="thread">
      {t.comments.map(c => <div key={c.id} className="comment">
        <span className="comment-avatar">{initial(c.author)}</span>
        <div className="comment-body"><div className="comment-meta"><strong>{c.author}</strong><small>{when(c.createdAt)}</small><button className="comment-delete" aria-label="Delete comment" title="Delete comment" onClick={() => onDelete(t.id, c.id)}><Trash2 size={12}/></button></div><p>{c.text}</p></div>
      </div>)}
      <button className="thread-resolve" onClick={() => onResolve(t.id)}><Check size={13}/>Resolve</button>
    </div>)}
    <div className="thread-compose">
      <span className="comment-avatar">{initial(author)}</span>
      <textarea ref={input} rows={1} value={draft} placeholder={threads.length ? 'Reply…' : 'Add a comment…'} aria-label="Comment" onChange={e => { setDraft(e.target.value); grow(e.target); }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}/>
      <button className="thread-send" aria-label="Post comment" disabled={!draft.trim()} onClick={send}><ArrowUp size={14}/></button>
    </div>
  </div>, document.body);
}

// ---- formatting controls (bubble menu and the writing desk toolbar) ----
function MarkButtons({ editor, compact = false }: { editor: Editor; compact?: boolean }) {
  const s = useEditorState({ editor, selector: ({ editor: e }) => ({ bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'), highlight: e.isActive('highlight'), h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }), quote: e.isActive('blockquote') }) });
  const b = (on: boolean, label: string, Icon: typeof Bold, run: () => void) => <button key={label} className={on ? 'on' : ''} aria-pressed={on} aria-label={label} title={label} onMouseDown={e => e.preventDefault()} onClick={run}><Icon size={15}/></button>;
  const chain = () => editor.chain().focus();
  return <>
    {b(s.bold, 'Bold (Ctrl+B)', Bold, () => chain().toggleBold().run())}
    {b(s.italic, 'Italic (Ctrl+I)', Italic, () => chain().toggleItalic().run())}
    {b(s.underline, 'Underline (Ctrl+U)', UnderlineIcon, () => chain().toggleUnderline().run())}
    {b(s.strike, 'Strikethrough (Ctrl+Shift+X)', Strikethrough, () => chain().toggleStrike().run())}
    {b(s.highlight, 'Highlight (Ctrl+Shift+H)', Highlighter, () => chain().toggleHighlight().run())}
    {compact && <><span className="bubble-sep"/>{b(s.h2, 'Heading', Heading2, () => chain().toggleHeading({ level: 2 }).run())}{b(s.h3, 'Subheading', Heading3, () => chain().toggleHeading({ level: 3 }).run())}{b(s.quote, 'Quote', Quote, () => chain().toggleBlockquote().run())}</>}
  </>;
}
const BLOCKS = [
  { id: 'p', label: 'Text', Icon: Pilcrow }, { id: 'h2', label: 'Heading', Icon: Heading2 }, { id: 'h3', label: 'Subheading', Icon: Heading3 },
  { id: 'quote', label: 'Quote', Icon: Quote }, { id: 'ul', label: 'Bulleted list', Icon: List }, { id: 'ol', label: 'Numbered list', Icon: ListOrdered },
] as const;
export function FormatBar({ editor, font, onFont }: { editor: Editor; font: string; onFont: (id: string) => void }) {
  const block = useEditorState({ editor, selector: ({ editor: e }) => e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : e.isActive('bulletList') ? 'ul' : e.isActive('orderedList') ? 'ol' : e.isActive('blockquote') ? 'quote' : 'p' });
  const setBlock = (id: string) => {
    const c = editor.chain().focus();
    if (editor.isActive('bulletList') && id !== 'ul') c.toggleBulletList(); else if (editor.isActive('orderedList') && id !== 'ol') c.toggleOrderedList();
    if (editor.isActive('blockquote') && id !== 'quote') c.lift('blockquote');
    if (id === 'p') c.setParagraph(); else if (id === 'h2') c.setHeading({ level: 2 }); else if (id === 'h3') c.setHeading({ level: 3 });
    else if (id === 'quote') { c.setParagraph(); if (!editor.isActive('blockquote')) c.toggleBlockquote(); }
    else if (id === 'ul' && !editor.isActive('bulletList')) c.setParagraph().toggleBulletList(); else if (id === 'ol' && !editor.isActive('orderedList')) c.setParagraph().toggleOrderedList();
    c.run();
  };
  const current = BLOCKS.find(b => b.id === block)!;
  return <div className="format-bar" role="toolbar" aria-label="Text formatting">
    <label className="format-select" title="Paragraph style"><current.Icon size={14}/><select aria-label="Paragraph style" value={block} onChange={e => setBlock(e.target.value)}>{BLOCKS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
    <span className="format-sep"/>
    <MarkButtons editor={editor}/>
    <button aria-label="Scene break" title="Scene break" onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={15}/></button>
    <span className="format-sep"/>
    <label className="format-select font-select" title="Manuscript font"><span style={{ fontFamily: fontFor(font).family }}>Aa</span><select aria-label="Manuscript font" value={fontFor(font).id} onChange={e => onFont(e.target.value)}>{FONTS.map(f => <option key={f.id} value={f.id}>{f.name} — {f.note}</option>)}</select></label>
  </div>;
}
