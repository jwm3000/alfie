import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Thread } from './model';

// Paragraph comments. Every thread is attached to one textblock (paragraph, heading or list line).
// - On load, a thread finds its block by its stored text (`anchor`), closest to its old position (`hint`);
//   if the text was edited elsewhere, the most similar block wins.
// - While writing, positions follow every edit through ProseMirror's mapping. If a block is split, merged or
//   emptied, the thread looks for its previous text again, so it never silently jumps to an unrelated line.
// - Blocks with open threads get a decoration (soft highlight); the thread being viewed is emphasised.
export type Spot = { pos: number; text: string; index: number };
type State = { pos: Map<string, number>; threads: Thread[]; active: string | null; hover: number | null; deco: DecorationSet };
export const commentsKey = new PluginKey<State>('alfie-comments');

const textblocks = (doc: PMNode) => { const list: Spot[] = []; doc.descendants((node, pos) => { if (node.isTextblock) { list.push({ pos, text: node.textContent, index: list.length }); return false; } return true; }); return list; };
const tokens = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
function similarity(a: string, b: string) { const x = tokens(a), y = tokens(b); if (!x.size || !y.size) return 0; let n = 0; for (const t of x) if (y.has(t)) n++; return n / (x.size + y.size - n); }
function find(blocks: Spot[], text: string, near: number): Spot | null {
  if (!text.trim()) return null;
  let best: Spot | null = null, bestScore = 0;
  for (const b of blocks) {
    const score = b.text === text ? 2 : similarity(b.text, text);
    if (score > bestScore + 1e-9 || (best && Math.abs(score - bestScore) < 1e-9 && Math.abs(b.index - near) < Math.abs(best.index - near))) { best = b; bestScore = score; }
  }
  return bestScore >= .5 ? best : null;
}
function locateAll(doc: PMNode, threads: Thread[], known?: Map<string, number>) {
  const blocks = textblocks(doc), pos = new Map<string, number>();
  for (const t of threads) { const k = known?.get(t.id); if (k !== undefined) { pos.set(t.id, k); continue; } const b = find(blocks, t.anchor, t.hint); if (b) pos.set(t.id, b.pos); }
  return pos;
}
function decorate(doc: PMNode, s: Omit<State, 'deco'>) {
  const decos: Decoration[] = [], seen = new Set<number>();
  for (const t of s.threads) {
    const p = s.pos.get(t.id); if (p === undefined || t.resolved || seen.has(p)) continue;
    const node = doc.nodeAt(p); if (!node) continue; seen.add(p);
    const open = s.active !== null && s.pos.get(s.active) === p;
    decos.push(Decoration.node(p, p + node.nodeSize, { class: `pm-commented${open ? ' pm-comment-open' : ''}` }));
  }
  if (s.hover !== null && !seen.has(s.hover)) { const node = doc.nodeAt(s.hover); if (node?.isTextblock) decos.push(Decoration.node(s.hover, s.hover + node.nodeSize, { class: 'pm-comment-target' })); }
  return DecorationSet.create(doc, decos);
}
function remap(tr: Transaction, prev: Map<string, number>) {
  const out = new Map<string, number>(); let blocks: Spot[] | null = null;
  for (const [id, old] of prev) {
    const before = tr.before.nodeAt(old), p = tr.mapping.map(old, 1), node = p <= tr.doc.content.size ? tr.doc.nodeAt(p) : null;
    const was = before?.textContent || '';
    if (node?.isTextblock && node.textContent === was) { out.set(id, p); continue; }
    if (node?.isTextblock && node.textContent) {
      // The paragraph was edited or split: stay with whichever part (this block or the one after it) is closer to before.
      const after = p + node.nodeSize, nextNode = after < tr.doc.content.size ? tr.doc.nodeAt(after) : null;
      const here = similarity(node.textContent, was), there = nextNode?.isTextblock ? similarity(nextNode.textContent, was) : 0;
      out.set(id, there > here && there >= .5 ? after : p); continue;
    }
    blocks ??= textblocks(tr.doc);
    const near = blocks.findIndex(b => b.pos >= p);
    const hit = find(blocks, was, near < 0 ? blocks.length : near);
    if (hit) out.set(id, hit.pos);
  }
  return out;
}

export const Comments = Extension.create({
  name: 'alfieComments',
  addProseMirrorPlugins() {
    return [new Plugin<State>({
      key: commentsKey,
      state: {
        init: (_, state) => ({ pos: new Map(), threads: [], active: null, hover: null, deco: DecorationSet.create(state.doc, []) }),
        apply(tr, prev, _old, state) {
          const meta = tr.getMeta(commentsKey) as Partial<Pick<State, 'threads' | 'active' | 'hover'>> | undefined;
          if (!meta && !tr.docChanged) return prev;
          let pos = tr.docChanged ? remap(tr, prev.pos) : prev.pos;
          const threads = meta?.threads ?? prev.threads;
          if (meta?.threads) { for (const id of [...pos.keys()]) if (!threads.some(t => t.id === id)) pos.delete(id); pos = locateAll(state.doc, threads, pos); }
          const next = { pos, threads, active: meta && 'active' in meta ? meta.active ?? null : prev.active, hover: meta && 'hover' in meta ? meta.hover ?? null : prev.hover };
          const hover = next.hover !== null && tr.docChanged ? tr.mapping.map(next.hover, 1) : next.hover;
          return { ...next, hover, deco: decorate(state.doc, { ...next, hover }) };
        },
      },
      props: { decorations: state => commentsKey.getState(state)?.deco },
    })];
  },
});
export const commentState = (state: EditorState) => commentsKey.getState(state)!;
/** The textblock containing a document position, or null. */
export function blockAt(state: EditorState, pos: number): Spot | null {
  const $p = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)));
  for (let d = $p.depth; d > 0; d--) if ($p.node(d).isTextblock) { const start = $p.before(d); return { pos: start, text: $p.node(d).textContent, index: textblocks(state.doc).findIndex(b => b.pos === start) }; }
  return null;
}
export { textblocks };
