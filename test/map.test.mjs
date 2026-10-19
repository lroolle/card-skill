// The map of a project's boards: what a board says of itself (#+category:, #+from:,
// #+needs:, a link to a card on another board), what the map draws from it, what a
// board page names under its title, and what `cards check` says about the links.
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { parseBoard, boardLinksOf } from '../skill/lib/board.mjs';
import { orgInline, orgPlain } from '../skill/lib/org.mjs';
import { mapData, ownsIndex } from '../skill/lib/index.mjs';
import { buildBoard } from '../skill/lib/compile.mjs';
import { resolveBoard, listBoards } from '../skill/lib/store.mjs';
import { serve } from '../skill/lib/serve.mjs';
import '../skill/runtime/digest.js';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const CLI = path.join(ROOT, 'skill', 'bin', 'cards.mjs');
const cards = (cwd, args) => execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CARDS_CJK_FONT: 'none' } });
const data = (html) => JSON.parse(html.match(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/)[1]);
const card = (title, id, body, props = '') => `** ${title}\n:PROPERTIES:\n:CUSTOM_ID: ${id}\n${props}:END:\n${body}\n`;

// Six boards of an invented project: a plan with a drawing, its review (and the review in
// Chinese), two releases, and a board that names no group.
const BOARDS = {
  plan: `#+title: Plan the ingest rewrite
#+description: Three steps, one decision on the queue.
#+category: Ingest
#+todo: TODO DOING BLOCKED | DONE

* The shape
${card('The pipeline after the rewrite  :sheet:', 'pipeline', 'Where the queue sits.\n\n#+begin_src flow\n  api -> queue: events\n  queue -> worker\n#+end_src')}
* Steps
${card('DONE The old schema is frozen', 'step-1', 'Done in the first week.')}
${card('The queue is NATS, unless you pick Kafka', 'pick-queue', 'NATS needs no cluster. Kafka keeps a week of events; a wrong pick costs a migration.\n\n- [X] nats :: NATS\n- [ ] kafka :: Kafka', ':ASK: choose\n')}`,
  review: `#+title: Review of the ingest plan
#+description: What a second reader found.
#+category: Ingest
#+from: plan

* Findings
${card('The plan has no way back from step 3', 'rollback', 'It rests on [[file:../plan/board.org::#pick-queue][the queue pick]], and on [[file:../plan/board.org::#step-1]].')}
${card('The review holds, if you approve it', 'ok', 'Approve, and release 2 can go on; reject, and it waits for a second review.', ':ASK: approve\n')}`,
  'review-zh': `#+title: 摄取计划评审
#+language: zh-Hans
#+translation_of: review

* 发现
${card('计划在第三步之后无法回退', 'rollback', '没有回退的路。')}
${card('批准后评审成立', 'ok', '批准后第二版可以继续；驳回则等待第二次评审。', ':ASK: approve\n')}`,
  'release-1': `#+title: Release 1: how it went
#+category: Releases
#+from: plan

* Facts
${card('Release 1 shipped on the agreed day', 'shipped', 'It went out on time.')}`,
  'release-2': `#+title: Release 2 waits on the review
#+category: Releases
#+from: release-1
#+needs: review

* Facts
${card('Release 2 starts after the review', 'waits', 'See [[file:../review/board.org][the review]].')}`,
  notes: `#+title: Loose notes

* Notes
${card('The notes hold nothing yet', 'note', 'Nothing.')}`,
};

function project(boards = BOARDS, order = Object.keys(boards)) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-map-'));
  for (const id of order) {
    const ref = resolveBoard(id, cwd);
    fs.mkdirSync(ref.dir, { recursive: true });
    fs.writeFileSync(ref.file, boards[id]);
  }
  return cwd;
}
const renderAll = (cwd, ids = Object.keys(BOARDS)) => ids.map((id) => cards(cwd, ['render', id, '--quiet']));

test('map, format: a board names its group, where it comes from and what it waits on; links name boards and cards', () => {
  const b = parseBoard(BOARDS['release-2'], { id: 'release-2', file: 'board.org' });
  assert.deepEqual(b.errors, []);
  assert.deepEqual([b.category, b.fromBoards, b.needsBoards], ['Releases', ['release-1'], ['review']]);
  assert.deepEqual(boardLinksOf(parseBoard(BOARDS.review, { id: 'review', file: 'board.org' })).map((l) => [l.board, l.card, l.from]),
    [['plan', 'pick-queue', 'rollback'], ['plan', 'step-1', 'rollback']]);
  // A name that is no board's name is a warning with the line to write; the board still renders.
  const bad = parseBoard('#+title: T\n#+from: Plan B\n', { id: 't', file: 'board.org' });
  assert.deepEqual([bad.errors, bad.keyProblems.map((e) => e.line)], [[], [2]]);
  // Code is inert; a link to a board is not a file to show.
  assert.deepEqual(boardLinksOf(parseBoard('#+title: T\n\n' + card('A claim that stands', 'a', 'Not a link: =[[file:../plan/board.org]]=.'), { id: 't', file: 'board.org' })), []);
  // Without a project around it, a link to a board is a link to the file, as in Org.
  assert.equal(orgInline('[[file:../plan/board.org::#step-1][the step]]'), '<a href="../plan/board.org">the step</a>');
  assert.equal(orgPlain('see [[file:../plan/board.org::#step-1]] and [[file:../plan/board.org]]'), 'see plan#step-1 and plan');
});

test('map, page: a tile per board, a frame per group, lines from what the boards say, the asks of every board', () => {
  const cwd = project();
  // A board linked in from a part of the project counts as one of its boards.
  const part = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-part-'));
  fs.mkdirSync(path.join(part, 'design'));
  fs.writeFileSync(path.join(part, 'design', 'board.org'), `#+title: The design of a part\n#+category: Ingest\n\n* Design\n${card('The part keeps its own queue', 'own-queue', 'It reads from [[file:../plan/board.org::#pick-queue]].')}`);
  fs.symlinkSync(path.join(part, 'design'), path.join(cwd, '.cards', 'part-design'), 'dir');
  renderAll(cwd);
  cards(cwd, ['render', 'part-design', '--quiet']);
  assert.deepEqual(listBoards(cwd).map((r) => r.id), ['notes', 'part-design', 'plan', 'release-1', 'release-2', 'review', 'review-zh']);
  const html = fs.readFileSync(path.join(cwd, '.cards', 'index.html'), 'utf8');
  const map = data(html);
  assert.equal(map.kind, 'map');
  assert.ok(ownsIndex(path.join(cwd, '.cards')), 'a render may write the map again');
  // Groups: the oldest first; a board after the boards it comes from; the boards with no group last, with no frame.
  assert.deepEqual(map.sections.map((s) => [s.title, s.frame, s.cards]), [
    ['Ingest', true, ['plan', 'review', 'part-design']],
    ['Releases', true, ['release-1', 'release-2']],
    ['', false, ['notes']],
  ]);
  // A translation is no tile of its own: its source shows both languages.
  assert.equal(map.cards['review-zh'], undefined);
  assert.deepEqual(map.cards.review.map.langs.map((l) => [l.id, l.lang, l.href]), [['review', 'en', 'review/board.html'], ['review-zh', 'zh-Hans', 'review-zh/board.html']]);
  // Lines: comes from, waits on, links to. A board's tile carries its first drawing.
  assert.deepEqual([map.cards.review.from, map.cards['release-2'].from, map.cards['release-2'].needs, map.cards['part-design'].refs], [['plan'], ['release-1'], ['review'], ['plan']]);
  assert.match(map.cards.plan.figure_html, /<svg class="flow"/);
  assert.deepEqual(map.cards.plan.map.sheet, { n: 1, title: 'The pipeline after the rewrite' });
  assert.deepEqual(map.cards.plan.progress, { done: 1, total: 3 });
  // Every ask that waits, on every board, with the address of its card.
  assert.deepEqual(Object.values(map.cards).flatMap((c) => c.map.asks.map((a) => `${c.id} ${a.n} ${a.kind} ${a.href}`)),
    ['plan 3 choose plan/board.html#c-pick-queue', 'review 2 approve review/board.html#c-ok']);
  assert.equal(map.board.waiting, 2);
  assert.deepEqual([map.board.boards, map.board.groups], [6, 2]);
  // A board not rendered yet has no page to open.
  fs.mkdirSync(path.join(cwd, '.cards', 'later'));
  fs.writeFileSync(path.join(cwd, '.cards', 'later', 'board.org'), '#+title: Later\n#+category: Releases\n');
  assert.equal(mapData(path.join(cwd, '.cards')).cards.later.map.href, '');
});

test('map, board page: a link to a card on another board shows that board and numeral; the board names its neighbours', () => {
  const cwd = project();
  renderAll(cwd);
  const review = data(fs.readFileSync(path.join(cwd, '.cards', 'review', 'board.html'), 'utf8'));
  assert.match(review.cards.rollback.gist_html, /<a class="ref xref" href="\.\.\/plan\/board\.html#c-pick-queue"><span class="ref-n">plan 3<\/span><span class="ref-t">the queue pick<\/span><\/a>/);
  assert.match(review.cards.rollback.gist_html, /<a class="ref xref" href="\.\.\/plan\/board\.html#c-step-1"><span class="ref-n">plan 2<\/span><span class="ref-t">The old schema is frozen<\/span><\/a>/);
  assert.equal(review.board.category, 'Ingest');
  // A link to a whole board in the author's words reads as those words alone.
  const r2 = data(fs.readFileSync(path.join(cwd, '.cards', 'release-2', 'board.html'), 'utf8'));
  assert.match(r2.cards.waits.gist_html, /<a class="ref xref" href="\.\.\/review\/board\.html"><span class="ref-t">the review<\/span><\/a>/);
  assert.deepEqual(review.board.related.map((r) => [r.rel, r.boards.map((b) => `${b.id} ${b.href}`)]), [
    ['from', ['plan ../plan/board.html']],
    ['blocks', ['release-2 ../release-2/board.html']],
  ]);
  const plan = data(fs.readFileSync(path.join(cwd, '.cards', 'plan', 'board.html'), 'utf8'));
  assert.deepEqual(plan.board.related.map((r) => [r.rel, r.boards.map((b) => b.id)]), [['followups', ['release-1', 'review']]]);
  // A published copy links to the other board's published page; it names no path on this disk.
  const out = path.join(cwd, 'out');
  cards(cwd, ['export', 'review', '--out', path.join(out, 'review')]);
  const pub = data(fs.readFileSync(path.join(out, 'review', 'index.html'), 'utf8'));
  // A published copy says only what its own source says: no other board's claim, no link, no neighbours.
  assert.match(pub.cards.rollback.gist_html, /<span class="ref xref"><span class="ref-n">plan 3<\/span><span class="ref-t">the queue pick<\/span><\/span>/);
  assert.match(pub.cards.rollback.gist_html, /<span class="ref xref"><span class="ref-n">plan 2<\/span><\/span>/);
  assert.doesNotMatch(JSON.stringify(pub), /The old schema is frozen|Plan the ingest rewrite|release-2/);
  assert.deepEqual(pub.board.related, []);
  assert.ok(!fs.existsSync(path.join(out, 'index.html')), 'an export writes no map');
});

test('map, check: a link to no board or no card, another board named as code, a board outside every group', () => {
  const cwd = project();
  renderAll(cwd);
  const file = path.join(cwd, '.cards', 'notes', 'board.org');
  fs.writeFileSync(file, `#+title: Loose notes
#+from: nowhere

* Notes
${card('The notes point at the plan', 'note', 'See =release-1=, =plan= and [[file:../plan/board.org::#no-such-card]] and [[file:../gone/board.org]].')}`);
  const out = cards(cwd, ['check', 'notes']);
  assert.match(out, /:2 {2}warn: #\+from: nowhere names no board of this project \(boards here: plan, release-1, release-2, review, review-zh\)/);
  assert.match(out, /warn: note names the board release-1 as code, and the reader cannot follow it; link it: \[\[file:\.\.\/release-1\/board\.org\]\[release-1\]\]/);
  // =plan= may be a word of code: only a name with a dash or a digit is taken for a board.
  assert.doesNotMatch(out, /names the board plan as code/);
  assert.match(out, /warn: a link names the card no-such-card on plan, which that board does not have \(cards there: pipeline, step-1, pick-queue\)/);
  assert.match(out, /warn: a link names the board gone, which this project does not have/);
  assert.match(out, /:1 {2}warn: the other boards of this project name their group, and this one lies outside every group on the map: #\+category: Ingest, or #\+category: Releases/);
  // The page still renders; the missing card is said in the page, not linked.
  cards(cwd, ['render', 'notes', '--quiet']);
  const notes = data(fs.readFileSync(path.join(cwd, '.cards', 'notes', 'board.html'), 'utf8'));
  assert.match(notes.cards.note.gist_html, /<span class="ref missing">plan#no-such-card<\/span>/);
  // A translation takes its group from its source: no warning there.
  assert.doesNotMatch(cards(cwd, ['check', 'review-zh']), /#\+category/);
});

test('map, cli: cards new writes the group and the links; cards ls shows the map as text', () => {
  const cwd = project();
  renderAll(cwd);
  cards(cwd, ['new', 'release-3', '--pattern', 'status', '--category', 'Releases', '--from', 'release-2, plan']);
  const src = fs.readFileSync(path.join(cwd, '.cards', 'release-3', 'board.org'), 'utf8');
  assert.match(src, /^#\+title: .*\n#\+category: Releases\n#\+from: release-2 plan\n/);
  assert.throws(() => cards(cwd, ['new', 'x', '--from', 'Plan B']), /--from Plan: name a board/);
  const ls = cards(cwd, ['ls']);
  assert.match(ls, /^Ingest\n {2}plan .*Plan the ingest rewrite\n {2}review .*\n {27}from plan\n {2}review-zh .*\n {27}translation of review\n/m);
  assert.match(ls, /\n {2}release-2 .*\n {27}from release-1; needs review\n/);
  assert.match(ls, /\n\(no #\+category:\)\n {2}notes /);
});

test('map, serve: the address / is the map, with live links', async () => {
  const cwd = project();
  renderAll(cwd);
  const old = process.cwd();
  process.chdir(cwd);
  const { server, url } = await serve({ port: 0 });
  process.chdir(old);
  try {
    const page = await new Promise((resolve, reject) => http.get(`${url}/`, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(b)); }).on('error', reject));
    const map = data(page);
    assert.equal(map.kind, 'map');
    assert.equal(map.cards.plan.map.href, '/b/plan');
    assert.equal(map.cards.plan.map.asks[0].href, '/b/plan#c-pick-queue');
  } finally {
    server.close();
  }
});

test('map, a board alone: no project around it, no map, no neighbours', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-alone-'));
  fs.writeFileSync(path.join(dir, 'board.org'), `#+title: Alone\n\n* S\n${card('A board can stand alone', 'a', 'It links to [[file:../plan/board.org][a plan]] that is not there.')}`);
  const r = buildBoard({ id: 'alone', dir, file: path.join(dir, 'board.org') }, { write: false });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.data.board.related, []);
  assert.match(r.data.cards.a.gist_html, /<span class="ref missing">a plan<\/span>/);
});

test('map, review of 0.6: one key per project, one group per name, held asks, translations of translations, and what a link shows', () => {
  // Every project's map has the same path; its key in the browser is its own.
  const a = project();
  const b = project();
  renderAll(a);
  renderAll(b);
  const ka = data(fs.readFileSync(path.join(a, '.cards', 'index.html'), 'utf8')).board.key;
  const kb = data(fs.readFileSync(path.join(b, '.cards', 'index.html'), 'utf8')).board.key;
  assert.match(ka, /^map:[0-9a-f]{12}$/);
  assert.notEqual(ka, kb);
  assert.equal(mapData(path.join(a, '.cards')).board.key, ka, 'the same project keeps its key');

  // "Ingest" and "ingest" are one group; "C++" and "C#" are two, with two ids.
  const cwd = project({
    one: `#+title: One\n#+category: Ingest\n\n* S\n${card('The first board stands', 'a', 'Yes.')}`,
    two: `#+title: Two\n#+category: ingest\n\n* S\n${card('The second board stands', 'a', 'Yes.')}`,
    cpp: `#+title: Three\n#+category: C++\n\n* S\n${card('The third board stands', 'a', 'Yes.')}`,
    cs: `#+title: Four\n#+category: C#\n\n* S\n${card('The fourth board stands', 'a', 'Yes.')}`,
  });
  for (const id of ['one', 'two', 'cpp', 'cs']) cards(cwd, ['render', id, '--quiet']);
  const groups = mapData(path.join(cwd, '.cards')).sections.map((x) => [x.id, x.title, x.cards.join(' ')]);
  assert.deepEqual(groups, [['g-ingest', 'Ingest', 'one two'], ['g-c', 'C++', 'cpp'], ['g-c-2', 'C#', 'cs']]);

  // An ask held by the ask it needs does not wait on you yet: the map counts as the board does.
  const held = project({
    gate: `#+title: Gate\n#+category: G\n\n* S\n${card('The band is the sport one', 'band', 'A wrong band means a return.\n\n- [X] sport :: Sport\n- [ ] link :: Link', ':ASK: choose\n')}${card('The order goes out, if you approve', 'order', 'Approve, and it ships; reject, and nothing is bought.', ':ASK: approve\n:NEEDS: band\n')}`,
  });
  cards(held, ['render', 'gate', '--quiet']);
  assert.deepEqual(mapData(path.join(held, '.cards')).cards.gate.map.asks.map((x) => x.id), ['band']);

  // A translation of a translation is one more language of the same tile; #+from: a translation draws to its source.
  const tr = project({
    plan: `#+title: Plan\n#+category: P\n\n* S\n${card('The plan has one step', 'a', 'Yes.')}`,
    'plan-zh': `#+title: 计划\n#+language: zh-Hans\n#+translation_of: plan\n\n* S\n${card('计划只有一步', 'a', '是。')}`,
    'plan-ja': `#+title: 計画\n#+language: ja\n#+translation_of: plan-zh\n\n* S\n${card('計画は一歩です', 'a', 'はい。')}`,
    later: `#+title: Later\n#+category: P\n#+from: plan-zh\n\n* S\n${card('The later board comes after', 'a', 'Yes.')}`,
  });
  for (const id of ['plan', 'plan-zh', 'plan-ja', 'later']) cards(tr, ['render', id, '--quiet']);
  const tm = mapData(path.join(tr, '.cards'));
  assert.deepEqual(Object.keys(tm.cards).sort(), ['later', 'plan']);
  assert.deepEqual(tm.cards.plan.map.langs.map((l) => l.id), ['plan', 'plan-ja', 'plan-zh']);
  assert.deepEqual(tm.cards.later.from, ['plan']);

  // A linked card's claim keeps its words, and none of its links: a link inside a link breaks the outer one.
  const nest = project({
    plan: `#+title: Plan\n#+category: P\n\n* S\n${card('Use [[https://nats.io][NATS]] as in [[#two]] and =code=', 'one', 'Yes.')}${card('The second step waits', 'two', 'Yes.')}`,
    rev: `#+title: Review\n#+category: P\n\n* S\n${card('The review reads the plan', 'r', 'It reads [[file:../plan/board.org::#one]].\n\nAnd [[file:../plan/board.org]] again.')}`,
  });
  cards(nest, ['render', 'plan', '--quiet']);
  cards(nest, ['render', 'rev', '--quiet']);
  const rv = data(fs.readFileSync(path.join(nest, '.cards', 'rev', 'board.html'), 'utf8'));
  assert.match(rv.cards.r.gist_html, /<a class="ref xref" href="\.\.\/plan\/board\.html#c-one"><span class="ref-n">plan 1<\/span><span class="ref-t">Use NATS as in two and <code>code<\/code><\/span><\/a>/);
  // Find reads a link to a board as the board's name, not as a file called board.org.
  assert.match(rv.cards.r.text, /plan#one/);
  assert.doesNotMatch(rv.cards.r.text, /board\.org/);
});

test('map, review of 0.6: header lines that are not board names warn and still render; an md board is not asked for a group', () => {
  const cwd = project({
    org: `#+title: Org\n#+category: G\n#+from: The Plan, plan\n\n* S\n${card('The board renders anyway', 'a', 'Yes.')}`,
    plan: `#+title: Plan\n#+category: G\n\n* S\n${card('The plan has one step', 'a', 'Yes.')}`,
  });
  const out = cards(cwd, ['render', 'org', '--quiet']);
  assert.match(out, /warn: #\+from: "The", "Plan" is not the name of a board/);
  assert.match(out, /^rev 1/m);
  assert.deepEqual(parseBoard(BOARDS.plan.replace('#+category: Ingest', '#+from: Plan B'), { id: 'p', file: 'board.org' }).errors, []);
  const md = path.join(cwd, '.cards', 'old');
  fs.mkdirSync(md);
  fs.writeFileSync(path.join(md, 'board.md'), '---\ntitle: Old\n---\n\n# S\n\n## The old board still renders {#a}\n\nYes.\n');
  assert.doesNotMatch(cards(cwd, ['check', 'old']), /#\+category/);
});
