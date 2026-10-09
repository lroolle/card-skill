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

// ---- what a card shows of Org's grammar (0.2: tables, fixed-width lines, verse, list details, inline) ----

test('org: a table sets numbers to the right, obeys an alignment row, carries its caption, and names each field by its column', async () => {
  const { renderBlocks } = await import('../skill/lib/md.mjs');
  const html = (src) => renderBlocks(parseOrgBlocks(src, { top: false }), { inline: orgInline });
  const [t] = parseOrgBlocks('#+caption: Runs per engine\n| Engine | Tests | Share |\n|--------+-------+-------|\n| Chromium | 1,204 | 92% |\n| WebKit | 98 | n/a |\n', { top: false });
  assert.deepEqual([t.type, t.info, t.align], ['table', 'Runs per engine', ['', 'right', 'right']], 'at least half of a column are numbers: it is set to the right, as in Org');
  const out = html('#+caption: Runs per engine\n| Engine | /Tests/ |\n|--------+-------|\n| Chromium | 1,204 |\n');
  assert.match(out, /^<p class="tcap">Runs per engine<\/p><div class="table" data-cols="2"><table role="table">/);
  assert.match(out, /<th role="columnheader" class="r"><em>Tests<\/em><\/th>/);
  assert.match(out, /<td role="cell" data-label="Engine">Chromium<\/td><td role="cell" class="r" data-label="Tests">1,204<\/td>/, 'the name of the column, as plain text');
  // A row of <l> <c> <r> is not shown; it decides.
  const [c] = parseOrgBlocks('| <l> | <c> | <r10> |\n| a | b | c |\n|---+---+---|\n| 1 | 2 | x |\n', { top: false });
  assert.deepEqual([c.head, c.align, c.rows], [['a', 'b', 'c'], ['left', 'center', 'right'], [['1', '2', 'x']]]);
  // No head row: still a table, with no names on its fields.
  assert.ok(!/data-label|<thead/.test(html('| a | b |\n| c | d |\n')));
});

test('org: fixed-width lines are code; a verse keeps its lines; a center block is set in the middle', async () => {
  const { renderBlocks } = await import('../skill/lib/md.mjs');
  const html = (src) => renderBlocks(parseOrgBlocks(src, { top: false }), { inline: orgInline });
  assert.equal(html('Before.\n: echo hi\n:   two  spaces\n\nAfter.'), '<p>Before.</p><pre><code>echo hi\n  two  spaces</code></pre><p>After.</p>');
  assert.equal(html('#+RESULTS:\n: 42\n'), '<pre><code>42</code></pre>', 'what a src block printed');
  assert.equal(html('Before.\n:\nAfter.'), '<p>Before.</p><p>After.</p>', 'a lone colon is no box');
  // A paragraph keeps the end of a line that ends in two backslashes, and no other.
  assert.equal(html('one \\\\\ntwo\nthree \\\\ four'), '<p>one <br>two three \\\\ four</p>');
  // With no head row, a row of names over a row of numbers is not a column of numbers.
  assert.deepEqual(parseOrgBlocks('| a | b |\n| 1 | 2 |\n', { top: false })[0].align, ['', '']);
  assert.deepEqual(parseOrgBlocks('| a | b |\n| 1 | 2 |\n| 3 | 4 |\n', { top: false })[0].align, ['right', 'right']);
  assert.equal(html(':PROPERTIES:\n:CUSTOM_ID: x\n:END:\nText.'), '<p>Text.</p>', 'a drawer is not fixed-width text');
  assert.equal(html('#+begin_verse\nA verse keeps\n   its *lines*\n#+end_verse'), '<p class="verse">A verse keeps\n   its <strong>lines</strong></p>');
  assert.equal(html('#+begin_center\nin the middle\n#+end_center'), '<p class="center">in the middle</p>');
});

test('org: a list item may set its number; a task may be partly done', async () => {
  const { renderBlocks } = await import('../skill/lib/md.mjs');
  const html = (src) => renderBlocks(parseOrgBlocks(src, { top: false }), { inline: orgInline });
  assert.equal(html('1. one\n2. [@10] ten\n3. eleven'), '<ol><li>one</li><li value="10">ten</li><li>eleven</li></ol>');
  assert.match(html('- [-] some parts done\n- [X] done\n- [ ] open'), /<li class="task partial"><span class="box" aria-label="partly done">–<\/span><span>some parts done<\/span><\/li><li class="task checked">.*<li class="task">/);
  // On an ask, "[-]" is an option that is not chosen: the option list reads it as before.
  const b = parseBoard('#+title: T\n\n** Pick one of the two\n:PROPERTIES:\n:CUSTOM_ID: p\n:ASK: choose\n:END:\n- [X] a :: A\n- [-] b :: B\n', { fmt: 'org' });
  assert.deepEqual(b.errors, []);
  assert.deepEqual(b.cards[0].anatomy.options.map((o) => [o.value, o.default]), [['a', true], ['b', false]]);
});

test('org: in a line, a break, a date, a link in angle brackets, and text above and below the line; names with _ stay whole', () => {
  assert.equal(orgInline('one \\\\\ntwo'), 'one <br>two');
  assert.equal(orgInline('one \\\\ two'), 'one \\\\ two', 'in the middle of a line two backslashes are text');
  assert.equal(orgInline('a path C:\\\\Users stays'), 'a path C:\\\\Users stays', 'two backslashes inside a word are text');
  assert.equal(orgInline('due <2026-10-15 Thu +1w>, closed [2026-10-09 Fri 10:00]'), 'due <time datetime="2026-10-15">2026-10-15 Thu +1w</time>, closed <time datetime="2026-10-09">2026-10-09 Fri 10:00</time>');
  assert.equal(orgInline('a cookie [2/3] and a note [fn:1] stay'), 'a cookie [2/3] and a note [fn:1] stay');
  assert.equal(orgInline('[2026-10-09 note: fix the thing] is no date'), '[2026-10-09 note: fix the thing] is no date');
  assert.match(orgInline('<2026-10-09 金 10:00-11:30 .+2d -1d>'), /^<time datetime="2026-10-09">2026-10-09 金 10:00-11:30 \.\+2d -1d<\/time>$/);
  assert.match(orgInline('see <https://example.org/a_b> now'), /^see <a href="https:\/\/example\.org\/a_b"[^>]*>https:\/\/example\.org\/a_b<\/a> now$/);
  assert.equal(orgInline('E=mc^{2} and a_{ij} and x^{n+1}'), 'E=mc<sup>2</sup> and a<sub>ij</sub> and x<sup>n+1</sup>');
  assert.equal(orgInline('snake_case_name, H_2O, x^2 and =a_{b}= stay'), 'snake_case_name, H_2O, x^2 and <code>a_{b}</code> stay', 'only braces lift or lower; code is inert');
  assert.equal(orgPlain('E=mc^{2} due <2026-10-15 Thu> \\\\\nnext'), 'E=mc2 due 2026-10-15 Thu next');
});
