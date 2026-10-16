// Sheets and pins: a card that is one drawing, and cards pinned on its parts.
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, canonical, pinsOn } from '../skill/lib/board.mjs';
import { lint } from '../skill/lib/lint.mjs';
import { pageData } from '../skill/lib/compile.mjs';
import { partKey, partsOf, flow, parseFlow, layoutFlow, flowIssues, sequence, textBox } from '../skill/lib/figure.mjs';
import { chart } from '../skill/lib/chart.mjs';

const org = (body) => `#+title: T\n\n${body}`;
const card = (claim, id, props = '', body = 'A gist of a few words here.') =>
  `** ${claim}\n:PROPERTIES:\n:CUSTOM_ID: ${id}\n${props}:END:\n${body}\n`;
const SYSTEM = card('Every upload passes one queue  :sheet:', 'system', '', [
  'Read from the deploy files.',
  '',
  '#+begin_src flow',
  '  group Cloud: api, queue, resizer',
  '  store: photos',
  '  Web App -> api: HTTPS',
  '  api -> queue: job',
  '  queue -> resizer',
  '  api -> photos',
  '#+end_src',
].join('\n'));
const parse = (body) => parseBoard(org(body), { fmt: 'org' });
const errs = (body) => parse(body).errors.map((e) => `${e.msg} | ${e.fix}`);
const st = (board) => ({ rev: 1, sends: [], read: 0, says: [], cards: new Map(board.cards.map((c, i) => [c.id, { n: i + 1, v: 1, rev: 1, history: [] }])) });
const data = (board) => pageData(board, st(board), { file: '/x/board.org' }, { cwd: '/x' });

test('a part is its name, folded; :ON: names a part by it', () => {
  assert.equal(partKey('Web App'), 'web-app');
  assert.equal(partKey('board.org'), 'board.org');
  assert.equal(partKey(' 订单 服务 '), '订单-服务');
  assert.equal(partKey('POST /charges'), 'post-charges');
  // What tells two names apart stays: C, C++ and C# are three parts; -1 is not 1.
  assert.deepEqual(['C', 'C++', 'C#', '-1', '1', '-x-'].map(partKey), ['c', 'c++', 'c#', '-1', '1', 'x']);
  const parts = partsOf({ type: 'code', lang: 'flow', text: 'group Cloud: api\nWeb App -> api' });
  assert.deepEqual([...parts.keys()], ['api', 'web-app', 'cloud']);
  const b = parse(`* S\n${SYSTEM}${card('The queue has no dead-letter topic', 'dlq', ':ON: system/queue system/WEB-app\n')}`);
  assert.deepEqual(b.errors, []);
  assert.deepEqual(b.cards[1].on.map((p) => [p.sheet, p.part]), [['system', 'queue'], ['system', 'web-app']]);
  assert.equal(b.cards[0].sheet, true);
  assert.equal(b.cards[1].sheet, false);
});

test(':ON: that names no part of a sheet is an error that lists the parts', () => {
  const sys = `* S\n${SYSTEM}`;
  assert.match(errs(`${sys}${card('A finding with a pin', 'f', ':ON: system/quue\n')}`)[0], /has no part "quue" \| its parts: system\/api system\/queue .*system\/web-app system\/cloud/);
  assert.match(errs(`${sys}${card('A finding with a pin', 'f', ':ON: nope/api\n')}`)[0], /nope names no card/);
  assert.match(errs(`${sys}${card('A finding with a pin', 'f', ':ON: system\n')}`)[0], /name a part of a sheet, after a slash/);
  assert.match(errs(`${sys}${card('A plain card here', 'p')}${card('A finding with a pin', 'f', ':ON: p/api\n')}`)[0], /p is not a sheet.*\| \*\* A plain card here  :sheet:/);
  assert.match(errs(`* S\n${SYSTEM.replace(':END:', ':ON: system/api\n:END:')}`)[0], /not pinned on itself/);
  const sketchSheet = card('A layout to look at  :sheet:', 'lay', '', 'Gist.\n\n#+begin_src sketch\n  [ a ]\n#+end_src');
  assert.match(errs(`* S\n${sketchSheet}${card('A finding with a pin', 'f', ':ON: lay/a\n')}`)[0], /draws nothing with parts/);
});

test('pins: the part carries the numerals of the cards pinned on it, in order, and a click target per card', () => {
  const b = parse(`* S\n${SYSTEM}${card('A second finding here', 'b2', ':ON: system/api\n')}${card('A first finding here', 'b1', ':ON: system/api system/cloud\n')}`);
  const pins = pinsOn(b, (id) => ({ system: 1, b2: 7, b1: 3 })[id]);
  assert.deepEqual(pins.get('system').get('api').map((p) => [p.id, p.n]), [['b1', 3], ['b2', 7]]);
  const html = data(b).cards.system.figure_html;
  assert.match(html, /<g class="fn pinned" data-n="\d+" data-part="api">.*<g class="pin" data-card="b2">.*<text[^>]*>2<\/text><\/g><g class="pin" data-card="b1">/);
  assert.match(html, /<g class="fg pinned" data-part="cloud">/);
  assert.match(html, /<g class="fg-name">.*<g class="pin" data-card="b1">/);
  // The sheet's figure has no "Fig. n.1" of its own: the sheet's numeral is its number.
  assert.doesNotMatch(html, /<figcaption/);
  const d = data(b);
  assert.equal(d.cards.system.sheet, true);
  assert.deepEqual(d.cards.system.tags, []);
  assert.deepEqual(d.cards.b1.on, [['system', 'api'], ['system', 'cloud']]);
});

test('pins: a box with numerals grows to hold them, and the drawing stays clean', () => {
  const text = 'group Cloud: api, queue\nweb -> api: HTTPS\napi -> queue: job\nqueue -> worker';
  const g = parseFlow(text);
  const plain = layoutFlow(g);
  g.nodes.forEach((nd) => { nd.pins = nd.label === 'api' ? [{ id: 'a', n: 12 }, { id: 'b', n: 3 }] : null; });
  g.groups.forEach((gr) => { gr.pins = [{ id: 'c', n: 4 }]; });
  const L = layoutFlow(g);
  const box = (lay) => lay.boxes.find((x) => x.label === 'api');
  assert.ok(box(L).w > box(plain).w + 40, `${box(L).w} vs ${box(plain).w}`);
  assert.deepEqual(flowIssues(g, L), []);
  // The group's name and its numeral clear every line.
  const f = L.frames[0];
  assert.ok(f.text.pad > 18);
  const r = textBox(f.text);
  for (const e of L.edges) for (let i = 1; i < e.xy.length; i++) {
    const [[ax, ay], [bx, by]] = [e.xy[i - 1], e.xy[i]];
    assert.ok(Math.max(ax, bx) <= r.x0 || Math.min(ax, bx) >= r.x1 || Math.max(ay, by) <= r.y0 || Math.min(ay, by) >= r.y1, 'a line crosses the group name');
  }
});

test('pins: a sequence part, a bar, a line and a point of a line chart carry numerals', () => {
  const pins = new Map([['api', [{ id: 'x', n: 2 }]]]);
  assert.match(sequence('web -> api: GET\napi --> web: 200', '', '', { pins }).html, /data-part="api">.*<g class="pin" data-card="x">/);
  const bars = chart('| queue | ms |\n|---+---|\n| NATS | 4 |\n| Kafka | 11 |', '', '', { pins: new Map([['kafka', [{ id: 'k', n: 5 }]]]) });
  assert.match(bars.html, /<g class="c-row pinned" data-part="kafka"><g class="pin" data-card="k">/);
  const days = '| day | p95 | p50 |\n|---+---+---|\n| 2026-10-01 | 4 | 2 |\n| 2026-10-02 | 9 | 3 |\n| 2026-10-03 | 8 | 3 |';
  const line = chart(days, '', '', { pins: new Map([['2026-10-02', [{ id: 'd', n: 6 }]], ['p50', [{ id: 'e', n: 7 }]]]) });
  assert.match(line.html, /<g class="c-at pinned" data-part="2026-10-02"><path class="c-rule"/);
  assert.match(line.html, /<g class="c-end pinned" data-part="p50"><g class="pin" data-card="e">/);
});

test('a sheet has room: what a card warns about, a sheet holds', () => {
  const names = Array.from({ length: 18 }, (_, i) => `box ${i}`);
  const lines = names.slice(1).map((nm, i) => `  ${names[Math.floor(i / 2)]} -> ${nm}`).join('\n');
  const drawing = `Gist of a few words.\n\n#+caption: Many boxes\n#+begin_src flow\n${lines}\n#+end_src`;
  const asCard = lint(parse(`* S\n${card('Eighteen boxes in one drawing', 'big', '', drawing)}`)).map((w) => w.msg);
  assert.ok(asCard.some((m) => /flow has 18 boxes; split it \(<= 12\), or make it a sheet/.test(m)), asCard.join('\n'));
  const asSheet = lint(parse(`* S\n${card('Eighteen boxes in one drawing  :sheet:', 'big', '', drawing)}`)).map((w) => w.msg);
  assert.ok(!asSheet.some((m) => /boxes; split it|too-wide|a card on the desk shows/.test(m)), asSheet.join('\n'));
  // A chart on a sheet takes more room than in a card.
  const tbl = '| day | ms |\n|---+---|\n| 2026-10-01 | 4 |\n| 2026-10-02 | 9 |\n| 2026-10-03 | 8 |';
  assert.ok(chart(tbl, '', '', { room: 'sheet' }).width > chart(tbl, '', '', {}).width + 300);
});

test('lint: a sheet shows a drawing, needs no caption on it, and is not an option of a compare section', () => {
  const m = (body) => lint(parse(body)).map((w) => w.msg);
  assert.ok(m(`* S\n${card('Nothing drawn on this one  :sheet:', 'e')}`).some((x) => /a sheet shows a drawing/.test(x)));
  assert.deepEqual(m(`* S\n${SYSTEM}`), []);
  const opt = (id) => card(`Option ${id} has a sketch`, id, '', `Gist of the option.\n\n#+caption: It\n#+begin_src sketch\n  [ ${id} ]\n#+end_src`);
  assert.ok(!m(`* Options  :compare:\n${SYSTEM}${opt('a')}${opt('b')}`).some((x) => /draw every option or none/.test(x)));
  assert.ok(m('#+caption: Loose\n#+begin_src sketch\n  [ a ]\n#+end_src\n\n* S\n' + card('A plain card here', 'p')).some((x) => /a sheet \(\*\* The claim it shows  :sheet:\)/.test(x)));
});

test('versions: the tag makes a card a sheet, a pin is the pinned card\'s meaning, not the sheet\'s', () => {
  const plainCard = parse(`* S\n${SYSTEM.replace('  :sheet:', '')}`).cards[0];
  const sheet = parse(`* S\n${SYSTEM}`).cards[0];
  assert.notEqual(canonical(plainCard), canonical(sheet));
  const before = parse(`* S\n${SYSTEM}${card('A finding here now', 'f')}`);
  const after = parse(`* S\n${SYSTEM}${card('A finding here now', 'f', ':ON: system/api\n')}`);
  assert.equal(canonical(before.cards[0]), canonical(after.cards[0]));
  assert.notEqual(canonical(before.cards[1]), canonical(after.cards[1]));
  // A card with no pin means what it meant before pins existed.
  assert.doesNotMatch(canonical(before.cards[1]), /"on"/);
});

test('chart: the names on x never touch, in a card or on a sheet', () => {
  const rows = Array.from({ length: 9 }, (_, i) => `| 2026-10-${String(i + 1).padStart(2, '0')} | ${i * 3 + 1} |`).join('\n');
  for (const room of [undefined, 'sheet']) {
    const html = chart(`| day | ms |\n|---+---|\n${rows}`, '', '', { room }).html;
    const ticks = [...html.matchAll(/<text class="c-tick" x="([\d.]+)" y="([\d.]+)" text-anchor="(\w+)"[^>]*>(2026-[^<]+)<\/text>/g)]
      .map((m) => { const w = m[4].length * 7.2; const x = +m[1]; return m[3] === 'start' ? [x, x + w] : m[3] === 'end' ? [x - w, x] : [x - w / 2, x + w / 2]; });
    assert.ok(ticks.length >= 2);
    for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i][0] >= ticks[i - 1][1] + 4, `${room || 'card'}: names ${i - 1} and ${i} touch`);
  }
});

test('review of 0.4: two parts that fold to one name are an error, not two numerals', () => {
  const sheet = (body) => card('Languages we compile  :sheet:', 'ch', '', `Gist of the chart.\n\n#+begin_src ${body}\n#+end_src`);
  const e = (draw, pin) => errs(`* S\n${sheet(draw)}${card('A finding with a pin', 'f', `:ON: ${pin}\n`)}`);
  assert.deepEqual(e('chart\n  | lang | n |\n  |---+---|\n  | C | 1 |\n  | C++ | 2 |\n  | C# | 3 |', 'ch/c'), []);
  assert.match(e('flow\n  Web App -> web-app', 'ch/web-app')[0], /"Web App" and "web-app" on the sheet ch share the name web-app \| rename one of them/);
  assert.match(e('flow\n  group api: API, db\n  API -> db', 'ch/api')[0], /"API" and "api" .* share the name api/);
  // A line chart draws four series; a fifth is no part.
  assert.match(e('chart\n  | x | a | b | c | d | e |\n  |---+---+---+---+---+---|\n  | 1 | 1 | 2 | 3 | 4 | 5 |\n  | 2 | 1 | 2 | 3 | 4 | 5 |\n  | 3 | 1 | 2 | 3 | 4 | 5 |', 'ch/e')[0], /has no part "e"/);
});

test('review of 0.4: a pin is the same pin however it is spelled; a compare section counts its options', () => {
  const v = (on) => canonical(parse(`* S\n${SYSTEM}${card('A finding here now', 'f', `:ON: ${on}\n`)}`).cards[1]);
  assert.equal(v('system/API system/queue'), v('system/queue system/api'));
  assert.notEqual(v('system/api'), v('system/queue'));
  const m = lint(parse(`* Options  :compare:\n${SYSTEM}${card('The only option here', 'o')}`)).map((w) => w.msg);
  assert.ok(m.some((x) => /fewer than two cards to compare/.test(x)), m.join('\n'));
});

test('review of 0.4: a group keeps room for its name only where a line would cross it', () => {
  // This flow was clean at 435 px; room for every name made it 957 px and too wide for a card.
  const g = parseFlow('group Payments zone (PCI): api, web\napi -> web\napi -> worker\nweb -> queue\napi -> db\napi -> cache\napi -> auth\nauth -> worker\nauth -> queue');
  const L = layoutFlow(g);
  assert.ok(L.width < 502, `${L.width} px`);
  assert.deepEqual(flowIssues(g, L), []);
  // Here the name lay on the line into the group's first box; the frame now makes room for it.
  const h = parseFlow('group Payments zone (PCI): api, ledger\nweb -> api: POST /charges\napi -> ledger\napi -> queue\nqueue -> mailer');
  assert.deepEqual(flowIssues(h, layoutFlow(h)), []);
  // Running right, numerals on a group never land on a box.
  let seed = 5;
  // mulberry32: an LCG on doubles loses its low bits and repeats after a few thousand draws.
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const names = ['api', 'web', 'worker', 'queue', 'db', 'cache', 'auth', 'mail'];
  for (let t = 0; t < 200; t++) {
    const n = 4 + Math.floor(rnd() * 4);
    const lines = ['direction: right'];
    for (let b = 1; b < n; b++) lines.push(`${names[Math.floor(rnd() * b)]} -> ${names[b]}`);
    lines.push(`group Private network zone: ${names.slice(1, 3).join(', ')}`);
    const gg = parseFlow(lines.join('\n'));
    gg.groups[0].pins = [{ id: 'a', n: 3 }, { id: 'b', n: 27 }];
    assert.deepEqual(flowIssues(gg, layoutFlow(gg)).filter((x) => /numerals/.test(x.msg) && x.code === 'label-on-box'), [], lines.join(' | '));
  }
});

test('review of 0.4: names on x stand where their points are, also when the points are uneven', () => {
  const ticks = (html) => [...html.matchAll(/<text class="c-tick" x="([\d.]+)" y="[\d.]+" text-anchor="(\w+)"[^>]*>([^<]+)<\/text>/g)]
    .filter((m) => /^\d{4}-|^\d+$/.test(m[3]) && !/^\d+$/.test(m[3]) || /-/.test(m[3]))
    .map((m) => { const w = m[3].length * 7.2; const x = +m[1]; return m[2] === 'start' ? [x, x + w] : m[2] === 'end' ? [x - w, x] : [x - w / 2, x + w / 2]; });
  const days = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-30'];
  for (const room of [undefined, 'sheet']) {
    const t = ticks(chart(`| day | ms |\n|---+---|\n${days.map((d, i) => `| ${d} | ${i + 1} |`).join('\n')}`, '', '', { room }).html);
    assert.ok(t.length >= 2);
    for (let i = 1; i < t.length; i++) assert.ok(t[i][0] >= t[i - 1][1] + 4, `${room || 'card'}: ${JSON.stringify(t)}`);
  }
});
