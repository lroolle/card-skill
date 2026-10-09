// Org boards: the reader, the board model, and meaning-based versions.
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseOrgBlocks, orgInline, orgPlain } from '../skill/lib/org.mjs';
import { parseBoard, canonical } from '../skill/lib/board.mjs';
import { sync, fold, readLog } from '../skill/lib/store.mjs';
import { lint } from '../skill/lib/lint.mjs';

const BOARD = `#+title: Pick a queue
#+language: en
#+todo: TODO DOING BLOCKED | DONE

Lede with a [[#nats]] reference.

* Options  :compare:

** NATS covers the peak with one binary  :ops:
:PROPERTIES:
:CUSTOM_ID: nats
:BASIS: inference
:END:
Gist here.

- peak :: 120k msg/s
- :: on 3 nodes

Depth with =code= and ~from=~.

** Kafka needs a cluster to run
:PROPERTIES:
:CUSTOM_ID: kafka
:END:
Gist.

* Decision

** DOING Pick NATS unless replay matters [2/3]
:PROPERTIES:
:CUSTOM_ID: pick
:ASK: choose
:FROM: nats kafka
:END:
Why.

- [X] [[#nats]]
- [ ] [[#kafka]] if replay matters
`;

test('org: sections, cards, drawer, TODO keyword, cookie, tags, facts, options', () => {
  const b = parseBoard(BOARD, { fmt: 'org' });
  assert.deepEqual(b.errors, []);
  assert.deepEqual([b.fmt, b.title, b.lang, b.lede], ['org', 'Pick a queue', 'en', 'Lede with a [[#nats]] reference.']);
  assert.deepEqual(b.sections.map((s) => [s.id, s.layout, s.cards]), [['options', 'compare', ['nats', 'kafka']], ['decision', 'grid', ['pick']]]);
  const [nats, , pick] = b.cards;
  assert.deepEqual([nats.basis, nats.tags, nats.anatomy.gist.text], ['inference', ['ops'], 'Gist here.']);
  assert.equal(nats.anatomy.facts.text, 'peak: 120k msg/s\n: on 3 nodes');
  assert.deepEqual([pick.status, pick.progress, pick.from, pick.ask], ['doing', { done: 2, total: 3 }, ['nats', 'kafka'], 'choose']);
  assert.deepEqual(pick.anatomy.options.map((o) => [o.value, o.default, o.text]), [['nats', true, ''], ['kafka', false, 'if replay matters']]);
  assert.deepEqual(lint(b), []);
});

test('org: errors carry the line and an Org fix', () => {
  const b = parseBoard('** No id here\nGist.\n\n** Old syntax {#x}\n\n** Status in a drawer\n:PROPERTIES:\n:CUSTOM_ID: z\n:STATUS: done\n:END:\n', { fmt: 'org' });
  const by = Object.fromEntries(b.errors.map((e) => [e.msg, e]));
  assert.ok(by['board has no title']);
  assert.match(by['card has no id'].fix, /:CUSTOM_ID: no-id-here/);
  assert.match(by['org headings take no {...} attributes'].fix, /:PROPERTIES:/);
  assert.equal(by['unknown property :STATUS:'].line, 9);
  assert.match(by['unknown property :STATUS:'].fix, /TODO keyword/);
});

test('org: a list ends where the item kind changes; two blank lines end it too', () => {
  const kinds = parseOrgBlocks('- a :: 1\n- b :: 2\n\n- [X] yes\n- [ ] no\n\n+ plain\n').map((x) => x.lang || x.type);
  assert.deepEqual(kinds, ['facts', 'list', 'list']);
});

test('org: inline markup escapes everything the author wrote', () => {
  const html = orgInline('<script>x</script> *b* /i/ +s+ =<v>= [[javascript:alert(1)][x]] [[https://a.b][ok]] [[#nats]]', { ref: (id) => `[R:${id}]` });
  assert.ok(!/<script|<v>|href="javascript/.test(html));
  assert.match(html, /<strong>b<\/strong> <em>i<\/em> <del>s<\/del> <code>&lt;v&gt;<\/code>/);
  assert.match(html, /<a href="https:\/\/a.b"[^>]*>ok<\/a> \[R:nats\]/);
  assert.equal(orgPlain('a *b* and [[#c][the c card]] and =d='), 'a b and the c card and d');
  assert.equal(orgInline('docs/research/ and 2*3*4 and snake_case_name'), 'docs/research/ and 2*3*4 and snake_case_name');
});

test('versions follow meaning: the same card in markdown and in Org is the same version', () => {
  const md = parseBoard('---\ntitle: T\n---\n# Options {compare}\n\n## NATS covers the peak with one binary {#nats basis=inference .ops}\nGist here.\n\n```facts\npeak: 120k msg/s\n: on 3 nodes\n```\n\nDepth with `code` and `from=`.\n', { fmt: 'md' });
  const org = parseBoard(BOARD, { fmt: 'org' });
  assert.equal(canonical(md.cards[0]), canonical(org.cards[0]));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-org-'));
  sync(dir, md);
  const r = sync(dir, parseBoard(BOARD, { fmt: 'org' }));
  const st = fold(readLog(dir));
  assert.equal(st.cards.get('nats').v, 1, 'converting to Org is not a revision');
  assert.ok(!r.changed.includes('nats'));
  sync(dir, parseBoard(BOARD.replace('Gist here.', 'A new gist.'), { fmt: 'org' }));
  assert.equal(fold(readLog(dir)).cards.get('nats').v, 2, 'a change in meaning is');
  assert.equal(fold(readLog(dir)).cards.get('nats').fmt, 'org');
});

test('lint: a warning points at the line with the problem, not at the card heading', () => {
  const src = '#+title: T\n\n** A card with a long sentence\n:PROPERTIES:\n:CUSTOM_ID: a\n:END:\nGist is fine.\n\nWe utilize it here.\n\n#+begin_src sketch\n  x\n#+end_src\n';
  const ws = lint(parseBoard(src, { fmt: 'org' }));
  assert.deepEqual(ws.map((w) => [w.line, w.msg.slice(0, 12)]), [[9, '"utilize": w'], [11, 'the sketch b']]);
  const md = lint(parseBoard('---\ntitle: T\n---\n## A card with a long sentence {#a}\nGist is fine.\n\nWe utilize it here.\n', { fmt: 'md' }));
  assert.equal(md[0].line, 7);
});
