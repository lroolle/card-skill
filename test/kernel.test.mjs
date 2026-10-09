// Kernel tests: markdown subset, board parser, lint, store, compile, digest.
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inline, renderMarkdown, parseBlocks } from '../skill/lib/md.mjs';
import { parseBoard } from '../skill/lib/board.mjs';
import { lint } from '../skill/lib/lint.mjs';
import { sync, fold, readLog, addSend, markRead, unread, resolveBoard } from '../skill/lib/store.mjs';
import { buildBoard } from '../skill/lib/compile.mjs';
import '../skill/runtime/digest.js';

const SKILL = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'skill');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cards-'));
const board = (body, title = 'T') => `---\ntitle: ${title}\n---\n${body}`;
// These fixtures are the older markdown format; a board directory holds board.md for them.
const mdRef = (id, cwd) => { const r = resolveBoard(id, cwd); return { ...r, file: path.join(r.dir, 'board.md') }; };

// ---------- markdown ----------

test('md: raw HTML is escaped, never passed through', () => {
  const html = renderMarkdown('<script>alert(1)</script> and <b>bold</b>');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('md: unsafe link schemes render as text', () => {
  assert.equal(inline('[x](javascript:alert(1))').includes('href'), false);
  assert.ok(inline('[x](https://a.b/c)').includes('href="https://a.b/c"'));
});

test('md: code spans protect their contents', () => {
  assert.equal(inline('`**a** <b>`'), '<code>**a** &lt;b&gt;</code>');
  assert.equal(inline('snake_case_name'), 'snake_case_name');
  assert.equal(inline('**a** and *b*'), '<strong>a</strong> and <em>b</em>');
});

test('md: refs call the resolver; links and code in link text survive', () => {
  assert.equal(inline('see [[kafka]]', { ref: (id) => `<R ${id}>` }), 'see <R kafka>');
  assert.equal(inline('[`x` y](https://a.b)'), '<a href="https://a.b" target="_blank" rel="noopener noreferrer"><code>x</code> y</a>');
});

test('md: lists nest, tasks are recognised, tables and fences parse', () => {
  const b = parseBlocks('- a\n  - b\n- [x] c\n\n| h | i |\n|---|--:|\n| 1 | 2 |\n\n```facts\nk: v\n```');
  assert.equal(b[0].type, 'list');
  assert.equal(b[0].items[0].blocks[1].type, 'list');
  assert.equal(b[0].items[1].task, true);
  assert.equal(b[1].type, 'table');
  assert.deepEqual(b[1].align, ['', 'right']);
  assert.equal(b[2].lang, 'facts');
  assert.ok(renderMarkdown('```facts\npeak: 80k\n```').includes('<dt>peak</dt><dd>80k</dd>'));
});

// ---------- parser ----------

test('board: sections, cards, anatomy', () => {
  const b = parseBoard(board('Lede.\n\n# Options {compare}\n\n## NATS covers the peak {#nats basis=inference .ops}\nGist here.\n\n```facts\npeak: 80k\n```\n\nDepth.\n\n## Kafka needs a cluster {#kafka}\nGist.\n\n# Decision\n\n## Pick NATS {#pick ask=choose from=nats,kafka}\nWhy.\n\n- [x] [[nats]]\n- [ ] [[kafka]] if replay matters\n'));
  assert.deepEqual(b.errors, []);
  assert.equal(b.lede, 'Lede.');
  assert.equal(b.sections[0].layout, 'compare');
  const nats = b.cards[0];
  assert.equal(nats.basis, 'inference');
  assert.deepEqual(nats.tags, ['ops']);
  assert.equal(nats.anatomy.gist.text, 'Gist here.');
  assert.equal(nats.anatomy.facts.lang, 'facts');
  assert.equal(nats.anatomy.depth.length, 1);
  const pick = b.cards[2];
  assert.deepEqual(pick.from, ['nats', 'kafka']);
  assert.deepEqual(pick.anatomy.options.map((o) => [o.value, o.default, o.text]), [['nats', true, ''], ['kafka', false, 'if replay matters']]);
});

test('board: errors carry a line and a fix', () => {
  const b = parseBoard('# S\n\n## Claim without id\nx\n\n## Bad {#ok ask=pick color=red}\n\n## Ref {#r from=ghost}\nSee [[nope]].\n');
  const msgs = b.errors.map((e) => e.msg);
  assert.ok(msgs.includes('board has no title'));
  assert.ok(msgs.includes('card has no id'));
  assert.ok(msgs.some((m) => m.startsWith('ask=pick is not one of')));
  assert.ok(msgs.some((m) => m.startsWith('unknown key "color="')));
  assert.ok(msgs.includes('from=ghost names no card'));
  assert.ok(msgs.includes('[[nope]] names no card'));
  const noId = b.errors.find((e) => e.msg === 'card has no id');
  assert.equal(noId.line, 3);
  assert.equal(noId.fix, '## Claim without id {#claim-without-id}');
});

test('board: choose needs two options and one default unless multi', () => {
  const one = parseBoard(board('## Pick {#p ask=choose}\nx\n\n- [x] a\n'));
  assert.ok(one.errors.some((e) => e.msg.startsWith('ask=choose needs at least two options')));
  const two = parseBoard(board('## Pick {#p ask=choose}\nx\n\n- [x] a\n- [x] b\n'));
  assert.ok(two.errors.some((e) => e.msg.startsWith('single choice has more than one')));
  const multi = parseBoard(board('## Pick {#p ask=choose multi}\nx\n\n- [x] a\n- [x] b\n'));
  assert.deepEqual(multi.errors, []);
});

test('board: [[id]] inside a code span is text, not a reference', () => {
  const b = parseBoard(board('## Mentions use the `[[id]]` form {#a}\nWrite `[[id]]` to link.\n'));
  assert.deepEqual(b.errors, []);
  assert.deepEqual(b.cards[0].anatomy.refs, []);
});

test('board: headings inside code fences are not cards', () => {
  const b = parseBoard(board('## Real card here {#a}\nx\n\n```\n## not a card\n# not a section\n```\n'));
  assert.deepEqual(b.errors, []);
  assert.equal(b.cards.length, 1);
  assert.equal(b.sections.length, 1);
});

test('templates: every pattern is an org board with no errors and no warnings', () => {
  const files = fs.readdirSync(path.join(SKILL, 'templates'));
  assert.deepEqual(files.filter((f) => !f.endsWith('.org')), []);
  for (const f of files) {
    const b = parseBoard(fs.readFileSync(path.join(SKILL, 'templates', f), 'utf8'), { file: f });
    assert.equal(b.fmt, 'org', f);
    assert.deepEqual(b.errors, [], f);
    assert.deepEqual(lint(b), [], f);
  }
});

test('docs: the example board in SKILL.md parses cleanly', () => {
  const md = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const example = md.match(/```org\n([\s\S]*?)\n```\n/)[1];
  const b = parseBoard(example, { fmt: 'org' });
  assert.deepEqual(b.errors, []);
  assert.deepEqual(lint(b), []);
  assert.equal(b.cards.find((c) => c.id === 'pick').ask, 'choose');
});

// ---------- lint ----------

test('lint: topic headings, long gists, missing recommendation, too many asks', () => {
  const asks = Array.from({ length: 6 }, (_, k) => `## Should we do thing ${k}? {#a${k} ask=answer}\nWhy.\n`).join('\n');
  const b = parseBoard(board(`## NATS {#nats}\n${'word '.repeat(70)}\n\n## Pick one of these {#p ask=choose}\nx\n\n- [ ] a\n- [ ] b\n\n${asks}`));
  const msgs = lint(b).map((w) => w.msg).join('\n');
  assert.match(msgs, /reads like a topic/);
  assert.match(msgs, /gist is 70 words/);
  assert.match(msgs, /no recommended option/);
  assert.match(msgs, /7 open asks/);
});

// ---------- store ----------

test('store: sync records new cards, revisions, removals, and stable numerals', () => {
  const dir = tmp();
  const v1 = parseBoard(board('## Alpha claim here {#a}\nx\n\n## Beta claim here {#b}\ny\n'));
  assert.deepEqual(sync(dir, v1), { rev: 1, changed: ['a', 'b'], removed: [] });
  assert.equal(sync(dir, v1).rev, 1, 'no change, no new rev');
  const v2 = parseBoard(board('## Gamma claim here {#c}\nz\n\n## Alpha claim, revised {#a}\nx\n'));
  assert.deepEqual(sync(dir, v2), { rev: 2, changed: ['c', 'a'], removed: ['b'] });
  const st = fold(readLog(dir));
  assert.equal(st.cards.get('a').n, 1);
  assert.equal(st.cards.get('a').v, 2);
  assert.equal(st.cards.get('c').n, 3, 'numerals are never reused or shifted');
  assert.equal(st.cards.get('a').history.length, 2);
});

test('store: sends get rounds; reads clear the inbox', () => {
  const dir = tmp();
  addSend(dir, { rev: 1, items: [{ kind: 'note', text: 'hi' }] });
  addSend(dir, { rev: 1, items: [{ kind: 'note', text: 'again' }] });
  assert.deepEqual(unread(fold(readLog(dir))).map((s) => s.round), [1, 2]);
  markRead(dir, 2);
  assert.equal(unread(fold(readLog(dir))).length, 0);
});

test('store: a torn last log line is skipped', () => {
  const dir = tmp();
  addSend(dir, { rev: 1, items: [] });
  fs.appendFileSync(path.join(dir, 'log.jsonl'), '{"t":"send","rou');
  assert.equal(readLog(dir).length, 1);
});

// ---------- compile ----------

test('compile: one self-contained file; data escapes </script>', () => {
  const cwd = tmp();
  const ref = mdRef('demo', cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  fs.writeFileSync(ref.file, board('## The tag </script><script>x()</script> is inert {#a}\nSee [[a]].\n'));
  const r = buildBoard(ref, { cwd });
  assert.deepEqual(r.errors, []);
  assert.ok(!/<script>x\(\)/.test(r.html));
  assert.ok(!/<link (?!rel="icon" type="image\/svg\+xml" href="data:)|src="http|href="http[^"]*\.(css|js)"/.test(r.html), 'no external assets: the page icon is a data URI');
  const json = r.html.match(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/)[1];
  const data = JSON.parse(json);
  assert.equal(data.cards.a.n, 1);
  assert.match(data.cards.a.gist_html, /class="ref"/);
  assert.ok(fs.existsSync(path.join(ref.dir, 'board.html')));
});

test('compile: past versions are carried for the history view', () => {
  const cwd = tmp();
  const ref = mdRef('demo', cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  fs.writeFileSync(ref.file, board('## First wording of claim {#a}\nOld gist.\n'));
  buildBoard(ref, { cwd });
  fs.writeFileSync(ref.file, board('## Second wording of claim {#a}\nNew gist.\n'));
  const r = buildBoard(ref, { cwd });
  assert.equal(r.data.cards.a.v, 2);
  assert.equal(r.data.cards.a.history[0].title_html, 'First wording of claim');
});

// ---------- digest ----------

test('digest: untouched is not consent; stale answers are flagged', () => {
  const text = globalThis.cardsDigest({
    board: { id: 'q', title: 'Q', path: '.cards/q/board.md' }, round: 1, rev: 2,
    items: [
      { card: 'pick', kind: 'choose', value: ['sqs'], default: ['nats'], state: 'changed', v: 1 },
      { card: 'gate', kind: 'approve', state: 'untouched', v: 1 },
      { card: 'nats', kind: 'mark', value: 'more', v: 1 },
      { section: 'options', kind: 'order', value: ['sqs', 'nats'] },
      { kind: 'note', text: 'keep it cheap' },
    ],
  }, { pick: { n: 6, v: 2 }, gate: { n: 7, v: 1 }, nats: { n: 3, v: 1 } });
  assert.match(text, /#6 pick\s+choose\s+changed: sqs\s+\(you suggested nats\)\s+\[answered on v1, card is now v2\]/);
  assert.match(text, /#7 gate\s+approve\s+untouched \(no answer; not consent\)/);
  assert.match(text, /§options\s+order\s+sqs, nats/);
  assert.match(text, /board\s+note\s+"keep it cheap"/);
});
