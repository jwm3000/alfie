// Alfie's manuscript format: a small, readable Markdown dialect stored in `chapter.text`.
// It round-trips exactly with the editor and stays pleasant in the chapters/*.md files and in Git diffs.
//
//   **bold**  *italic*  ++underline++  ~~strike~~  ==highlight==
//   ## Heading   ### Subheading   > quote   - bullet   1. numbered   * * * (scene break)
//   Blocks are separated by a blank line; a single line break inside a paragraph is kept as a line break.
export type Mark = 'bold' | 'italic' | 'underline' | 'strike' | 'highlight';
export type Run = { text: string; marks: Mark[] };
export type Block =
  | { type: 'p'; text: string }
  | { type: 'h'; level: 2 | 3; text: string }
  | { type: 'quote'; paras: string[] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; start: number; items: string[] }
  | { type: 'hr' };
type JSONNode = { type: string; attrs?: Record<string, unknown>; content?: JSONNode[]; text?: string; marks?: { type: string }[] };

// Order matters: longer delimiters are tried first, and marks are opened in this order when serializing.
const DELIMS: [string, Mark][] = [['**', 'bold'], ['~~', 'strike'], ['++', 'underline'], ['==', 'highlight'], ['*', 'italic']];
const MARK_ORDER: Mark[] = ['bold', 'italic', 'underline', 'strike', 'highlight'];
const ESCAPABLE = '\\*~=+#>-.';

export function parseInline(src: string): Run[] {
  const runs: Run[] = []; const active: Mark[] = []; let buf = '';
  const flush = () => { if (buf) { runs.push({ text: buf, marks: [...active] }); buf = ''; } };
  for (let i = 0; i < src.length;) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
    const hit = DELIMS.find(([d]) => src.startsWith(d, i));
    if (hit) {
      const [d, mark] = hit, at = active.indexOf(mark);
      if (at >= 0) { flush(); active.splice(at, 1); i += d.length; continue; }
      const next = src[i + d.length];
      if (next && !/\s/.test(next) && src.indexOf(d, i + d.length + 1) > 0) { flush(); active.push(mark); i += d.length; continue; }
    }
    buf += ch; i++;
  }
  flush();
  return runs;
}
export const plainInline = (src: string) => parseInline(src).map(r => r.text).join('');

const isBreak = (b: string) => /^(\*\s*){3,}$|^-{3,}$|^_{3,}$|^#$/.test(b);
export function parseBlocks(md: string): Block[] {
  const out: Block[] = [];
  for (const raw of md.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    const b = raw.replace(/^\n+|\s+$/g, ''); if (!b.trim()) continue;
    const lines = b.split('\n');
    if (isBreak(b.trim())) out.push({ type: 'hr' });
    else if (/^#{1,6} /.test(b) && lines.length === 1) out.push({ type: 'h', level: b.startsWith('###') ? 3 : 2, text: b.replace(/^#+ /, '') });
    else if (lines.every(l => l.startsWith('>'))) {
      const inner = lines.map(l => l.replace(/^> ?/, '')).join('\n');
      out.push({ type: 'quote', paras: inner.split(/\n[ \t]*\n/).map(p => p.trim()).filter(Boolean) });
    }
    else if (lines.every(l => /^[-+] /.test(l) || /^\* (?!\*)/.test(l))) out.push({ type: 'ul', items: lines.map(l => l.slice(2)) });
    else if (lines.every(l => /^\d{1,9}[.)] /.test(l))) out.push({ type: 'ol', start: parseInt(lines[0], 10) || 1, items: lines.map(l => l.replace(/^\d+[.)] /, '')) });
    else out.push({ type: 'p', text: b });
  }
  return out;
}
/** Readable text without any markup (excerpts, search, comments). */
export const plainText = (md: string) => parseBlocks(md).map(b => b.type === 'hr' ? '* * *' : b.type === 'quote' ? b.paras.map(plainInline).join('\n') : b.type === 'ul' || b.type === 'ol' ? b.items.map(plainInline).join('\n') : plainInline(b.text)).join('\n\n');

// ---- Markdown → editor document ----
const inlineNodes = (src: string, breaks = true): JSONNode[] => {
  const nodes: JSONNode[] = [];
  for (const r of parseInline(src)) {
    const marks = r.marks.length ? r.marks.map(type => ({ type })) : undefined;
    r.text.split('\n').forEach((part, i) => {
      if (i) nodes.push(breaks ? { type: 'hardBreak' } : { type: 'text', text: ' ', ...(marks ? { marks } : {}) });
      if (part) nodes.push({ type: 'text', text: part, ...(marks ? { marks } : {}) });
    });
  }
  return nodes;
};
const para = (src: string): JSONNode => { const content = inlineNodes(src); return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }; };
export function mdToDoc(md: string): JSONNode {
  const content: JSONNode[] = parseBlocks(md).map(b => {
    switch (b.type) {
      case 'p': return para(b.text);
      case 'h': { const c = inlineNodes(b.text, false); return { type: 'heading', attrs: { level: b.level }, ...(c.length ? { content: c } : {}) }; }
      case 'quote': return { type: 'blockquote', content: (b.paras.length ? b.paras : ['']).map(para) };
      case 'ul': return { type: 'bulletList', content: b.items.map(t => ({ type: 'listItem', content: [para(t)] })) };
      case 'ol': return { type: 'orderedList', attrs: { start: b.start }, content: b.items.map(t => ({ type: 'listItem', content: [para(t)] })) };
      case 'hr': return { type: 'horizontalRule' };
    }
  });
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

// ---- editor document → Markdown ----
const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\*/g, '\\*').replace(/~~/g, '\\~~').replace(/==/g, '\\==').replace(/\+\+/g, '\\++');
const escapeStart = (s: string) => s.replace(/^(#|>|-(?= |-))/, '\\$1').replace(/^(\d+)\. /, '$1\\. ').replace(/^(\+) /, '\\$1 ');
function inlineMd(nodes: JSONNode[] = [], breaks = true): string {
  let out = ''; const stack: Mark[] = [];
  const delim = (m: Mark) => DELIMS.find(([, k]) => k === m)![0];
  // Keep spaces outside of delimiters ("**bold** next", never "**bold **next").
  const closeTo = (depth: number) => { if (stack.length <= depth) return; const ws = out.match(/\s+$/)?.[0] || ''; out = out.slice(0, out.length - ws.length); while (stack.length > depth) out += delim(stack.pop()!); out += ws; };
  for (const n of nodes) {
    if (n.type === 'hardBreak') { out += breaks ? '\n' : ' '; continue; }
    if (n.type !== 'text' || !n.text) continue;
    const marks = MARK_ORDER.filter(m => n.marks?.some(k => k.type === m));
    let keep = 0; while (keep < stack.length && marks.includes(stack[keep])) keep++;
    closeTo(keep);
    let text = escapeText(n.text);
    const open = marks.filter(m => !stack.includes(m));
    if (open.length) { const ws = text.match(/^\s+/)?.[0] || ''; out += ws; text = text.slice(ws.length); for (const m of open) { out += delim(m); stack.push(m); } }
    out += text;
  }
  closeTo(0);
  return out;
}
// List items are kept flat (one line each); nested lists are folded into the outer list.
const itemTexts = (list: JSONNode): string[] => (list.content || []).flatMap(li => (li.content || []).flatMap(child =>
  child.type === 'bulletList' || child.type === 'orderedList' ? itemTexts(child) : child.type === 'paragraph' ? [inlineMd(child.content, false).trim()] : []));
const items = (list: JSONNode, prefix: (i: number) => string) => itemTexts(list).map((t, i) => prefix(i) + t);
export function docToMd(doc: JSONNode): string {
  const blocks: string[] = [];
  for (const n of doc.content || []) {
    if (n.type === 'paragraph') { const t = inlineMd(n.content); if (t.trim()) blocks.push(escapeStart(t)); }
    else if (n.type === 'heading') { const t = inlineMd(n.content, false).trim(); if (t) blocks.push(`${(n.attrs?.level as number) >= 3 ? '###' : '##'} ${t}`); }
    else if (n.type === 'blockquote') { const ps = (n.content || []).map(p => inlineMd(p.content)).filter(t => t.trim()).map(t => t.split('\n').map(l => `> ${l}`).join('\n')); if (ps.length) blocks.push(ps.join('\n>\n')); }
    else if (n.type === 'bulletList') { const ls = items(n, () => '- '); if (ls.length) blocks.push(ls.join('\n')); }
    else if (n.type === 'orderedList') { const s = (n.attrs?.start as number) || 1; const ls = items(n, i => `${s + i}. `); if (ls.length) blocks.push(ls.join('\n')); }
    else if (n.type === 'horizontalRule') blocks.push('* * *');
  }
  return blocks.join('\n\n');
}
