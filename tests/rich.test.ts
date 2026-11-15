import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdToDoc, docToMd, parseInline, plainText } from '../src/rich.ts';

const roundTrip = (md: string) => docToMd(mdToDoc(md));
test('plain prose survives unchanged', () => {
  const md = 'The house at the end of the lane.\n\nShe stood at the gate,\nkey in hand.\n\nSomewhere inside, a clock struck.';
  assert.equal(roundTrip(md), md);
});
test('inline marks round-trip', () => {
  for (const md of ['Some **bold**, *italic*, ++underlined++, ~~struck~~ and ==marked== words.', '***Both*** at once.', '**Bold with *italic inside* it**.', 'A **bold line\nthat breaks**.']) assert.equal(roundTrip(md), md);
});
test('blocks round-trip', () => {
  const md = '## Part one\n\n### A smaller heading\n\n> A quote\n> over two lines\n>\n> and a second paragraph\n\n- milk\n- **eggs**\n\n3. three\n4. four\n\n* * *\n\nAfter the break.';
  assert.equal(roundTrip(md), md);
});
test('literal symbols are escaped and come back as text', () => {
  const text = '2 * 3 = 6, a++ and a == b, ~~ not strike, # not heading';
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
  const md = docToMd(doc);
  assert.equal(plainText(md), text);
  assert.equal(docToMd(mdToDoc(md)), md);
  for (const start of ['# hash', '> gt', '- dash', '1. one', '--- rule']) { const d = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: start }] }] }; assert.equal(plainText(docToMd(d)), start); }
});
test('spaces stay outside delimiters', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'bold ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'end' }] }] };
  assert.equal(docToMd(doc), 'a **bold** end');
});
test('lone asterisks are text', () => { assert.deepEqual(parseInline('2 * 3'), [{ text: '2 * 3', marks: [] }]); });
