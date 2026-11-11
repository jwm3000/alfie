export interface Version { id: string; parent: string | null; label: string; text: string; createdAt: string }
export interface Chapter { id: string; title: string; subtitle: string; text: string; notes: string; status: 'Draft' | 'Revising' | 'Finished'; head: string | null; versions: Version[] }
export interface Idea { id: string; title: string; text: string; category: 'Spark' | 'Character' | 'World' | 'Question'; chapterId: string | null }
// Sketchbook pages: freehand strokes in a 1600×1000 canvas. Colors are theme tokens so drawings follow light and dark mode.
export const INKS = ['ink', 'accent', 'green', 'red', 'blue'] as const;
export interface Stroke { ink: typeof INKS[number]; size: number; points: number[]; pressure?: number[] }
export interface Sketch { id: string; title: string; strokes: Stroke[] }
export interface Project { format: 'alfie'; schemaVersion: 1; id: string; title: string; author: string; goal: number; chapters: Chapter[]; ideas: Idea[]; sketches?: Sketch[]; updatedAt: string }
export const uid = () => crypto.randomUUID();
export const words = (text: string) => (text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || []).length;
export const totalWords = (p: Project) => p.chapters.reduce((sum, c) => sum + words(c.text), 0);
export const newChapter = (title = 'Untitled chapter'): Chapter => ({ id: uid(), title, subtitle: '', text: '', notes: '', status: 'Draft', head: null, versions: [] });
export function newProject(): Project { return { format: 'alfie', schemaVersion: 1, id: uid(), title: 'An untold story', author: '', goal: 50000, chapters: [newChapter('The beginning')], ideas: [], updatedAt: new Date().toISOString() }; }
export function snapshot(chapter: Chapter, label: string): Chapter {
  const version: Version = { id: uid(), parent: chapter.head, label: label.trim() || `Draft ${chapter.versions.length + 1}`, text: chapter.text, createdAt: new Date().toISOString() };
  return { ...chapter, head: version.id, versions: [...chapter.versions, version] };
}
export function branch(chapter: Chapter, versionId: string, label: string): Chapter {
  const source = chapter.versions.find(v => v.id === versionId);
  if (!source) throw new Error('This version no longer exists.');
  // Preserve the current working copy before moving the branch head.
  const saved = chapter.text !== chapter.versions.find(v => v.id === chapter.head)?.text ? snapshot(chapter, 'Before branching') : chapter;
  return snapshot({ ...saved, text: source.text, head: source.id }, label || `Branch from ${source.label}`);
}
export function graphLayout(versions: Version[]) {
  const positions = new Map<string, { x: number; y: number; lane: number }>();
  const children = new Map<string, number>();
  let nextLane = 0;
  return versions.map((v, i) => {
    const parent = v.parent ? positions.get(v.parent) : undefined;
    const count = v.parent ? (children.get(v.parent) || 0) : 0;
    const lane = parent && count === 0 ? parent.lane : nextLane++;
    if (v.parent) children.set(v.parent, count + 1);
    const point = { x: 38 + lane * 46, y: 36 + i * 84, lane };
    positions.set(v.id, point);
    return { ...v, ...point, parentPoint: parent };
  });
}
export function parseProject(raw: string): Project {
  if (raw.length > 30_000_000) throw new Error('This project exceeds the 30 MB import limit.');
  const p = JSON.parse(raw);
  const str = (v: unknown) => typeof v === 'string';
  const id = (v: unknown) => str(v) && /^[A-Za-z0-9_-]{1,100}$/.test(v as string);
  if (p?.format !== 'alfie' || p.schemaVersion !== 1 || !id(p.id) || !str(p.title) || !str(p.author) || !str(p.updatedAt) || !Number.isInteger(p.goal) || p.goal < 1 || p.goal > 10_000_000 || !Array.isArray(p.chapters) || !p.chapters.length || !Array.isArray(p.ideas)) throw new Error('This is not a supported Alfie project (format v1).');
  const ids = new Set<string>();
  for (const c of p.chapters) {
    if (!id(c.id) || ids.has(c.id) || !str(c.title) || !str(c.subtitle) || !str(c.text) || !str(c.notes) || !['Draft', 'Revising', 'Finished'].includes(c.status) || !Array.isArray(c.versions)) throw new Error('Invalid chapter data.');
    ids.add(c.id);
    const seen = new Set<string>();
    for (const v of c.versions) {
      if (!id(v.id) || seen.has(v.id) || !str(v.text) || !str(v.label) || !str(v.createdAt) || !Number.isFinite(Date.parse(v.createdAt)) || (v.parent !== null && !seen.has(v.parent))) throw new Error('The chapter version graph is invalid.');
      seen.add(v.id);
    }
    if (c.head !== null && !seen.has(c.head)) throw new Error('Invalid active chapter version.');
  }
  const ideaIds = new Set<string>();
  for (const idea of p.ideas) {
    if (!id(idea.id) || ideaIds.has(idea.id) || !str(idea.title) || !str(idea.text) || !['Spark', 'Character', 'World', 'Question'].includes(idea.category) || (idea.chapterId !== null && !ids.has(idea.chapterId))) throw new Error('Invalid brainstorm card.');
    ideaIds.add(idea.id);
  }
  if (p.sketches !== undefined) {
    if (!Array.isArray(p.sketches)) throw new Error('Invalid sketchbook.');
    const sketchIds = new Set<string>();
    for (const s of p.sketches) {
      if (!id(s.id) || sketchIds.has(s.id) || !str(s.title) || !Array.isArray(s.strokes)) throw new Error('Invalid sketchbook page.');
      sketchIds.add(s.id);
      for (const k of s.strokes) if (!INKS.includes(k?.ink) || !Number.isFinite(k.size) || !Array.isArray(k.points) || k.points.some((n: unknown) => !Number.isFinite(n)) || (k.pressure !== undefined && (!Array.isArray(k.pressure) || k.pressure.length * 2 !== k.points.length || k.pressure.some((n: unknown) => !Number.isFinite(n))))) throw new Error('Invalid sketch stroke.');
    }
  }
  return p as Project;
}
export const serialize = (p: Project) => JSON.stringify(p, null, 2) + '\n';
export const manuscript = (p: Project) => `# ${p.title}\n${p.author ? `\nBy ${p.author}\n` : ''}\n` + p.chapters.map(c => `## ${c.title}\n\n${c.text}`).join('\n\n---\n\n');
export function demoProject(): Project {
  const p = newProject(); p.title = 'The Art of Beginning Again'; p.author = 'Neha'; p.goal = 40000;
  const opening = 'The house at the end of the lane had been empty for seven years.\n\nThat was what everyone said, anyway. But on the morning Mira arrived, a thin ribbon of smoke rose from its chimney, and a cat sat in the kitchen window as if it had been expecting her.\n\nShe stood at the gate with a suitcase in one hand and a key in the other. The key was warm. She had been holding it since the station.\n\nSomewhere inside, a clock struck an hour that did not exist.';
  let c = { ...newChapter('The house at the end of the lane'), subtitle: 'Every story begins with a door.', text: opening.replace('The key was warm. She had been holding it since the station.', 'She wondered if she had made a mistake.') };
  c = snapshot(c, 'First spark'); c.versions[0].createdAt = '2026-10-28T09:00:00Z';
  c = snapshot({ ...c, text: opening }, 'A warmer beginning'); c.versions[1].createdAt = '2026-10-29T14:30:00Z';
  c = snapshot({ ...c, head: c.versions[0].id, text: opening.replace('a clock struck an hour that did not exist.', 'someone was playing her mother’s favourite song.') }, 'What if she remembers?'); c.versions[2].createdAt = '2026-10-30T10:15:00Z';
  c = snapshot({ ...c, head: c.versions[1].id, text: opening + '\n\nMira pushed the gate. It opened without a sound.\n\n“Hello?” she called.\n\nThe cat blinked slowly. It was, she would later decide, the kindest answer anyone had given her in months.\n\nShe walked up the path, past the lavender that had somehow survived, past the terracotta pots arranged in pairs. Everything here seemed to be waiting for something. Or someone.\n\nFor the first time since leaving the city, she let herself wonder whether starting over might be a kind of coming home.' }, 'Finding her voice'); c.versions[3].createdAt = '2026-11-01T16:40:00Z';
  c.notes = 'Let the house feel like a character. Keep the magic quiet — a feeling before an explanation.';
  p.chapters = [c, { ...newChapter('Things left behind'), subtitle: 'The shape of an absence.' }, { ...newChapter('A small, ordinary magic') }, { ...newChapter('The language of staying') }];
  p.ideas = [ { id: uid(), title: 'A house that remembers', text: 'What if each room holds a memory of someone who once lived there? Not ghosts. Just small, ordinary things.', category: 'World', chapterId: c.id }, { id: uid(), title: 'Mira', text: 'Collects beautiful notebooks but is afraid to write in them. Starting over means finally using the good paper.', category: 'Character', chapterId: null }, { id: uid(), title: 'The impossible hour', text: 'Why does the clock strike thirteen? Maybe it is the hour for things we never had time to say.', category: 'Question', chapterId: c.id } ];
  return p;
}
export type DiffPart = { text: string; kind: 'same' | 'added' | 'removed' };
export function diffText(left: string, right: string): { left: DiffPart[]; right: DiffPart[] } {
  // Bound the quadratic comparison. Long manuscripts fall back to paragraph-level changes.
  let a: string[] = left.match(/\s+|[^\s]+/g) || [], b: string[] = right.match(/\s+|[^\s]+/g) || [];
  if (a.length * b.length > 2_000_000) { a = left.split(/(?<=\n)/); b = right.split(/(?<=\n)/); }
  if (a.length * b.length > 2_000_000) return { left: [{ text: left, kind: left === right ? 'same' : 'removed' }], right: [{ text: right, kind: left === right ? 'same' : 'added' }] };
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const l: DiffPart[] = [], r: DiffPart[] = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { l.push({ text: a[i++], kind: 'same' }); r.push({ text: b[j++], kind: 'same' }); }
    else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) l.push({ text: a[i++], kind: 'removed' });
    else r.push({ text: b[j++], kind: 'added' });
  }
  return { left: l, right: r };
}
