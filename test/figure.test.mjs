// Figures and the writing checks: sketch, flow, card anatomy, lint.
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlow, layoutFlow, flowIssues, flow, sketch, cols, parseSequence, layoutSequence, sequence } from '../skill/lib/figure.mjs';
import { parseChart, chart } from '../skill/lib/chart.mjs';
import { parseBlocks } from '../skill/lib/md.mjs';
import { parseBoard, canonical } from '../skill/lib/board.mjs';
import { lint, sentences } from '../skill/lib/lint.mjs';
import { pageData } from '../skill/lib/compile.mjs';

const board = (body, head = 'title: T') => `---\n${head}\n---\n${body}`;
const msgs = (src) => lint(parseBoard(board(src))).map((w) => w.msg);

// ---------- flow ----------

test('flow: chains, labels on the last hop, dashed arrows, bold boxes, direction', () => {
  const g = parseFlow('direction: right\n**a** -> b -> c: last hop\nc --> d: x -> y\nb');
  assert.equal(g.dir, 'right');
  assert.deepEqual(g.nodes.map((n) => [n.label, n.strong]), [['a', true], ['b', false], ['c', false], ['d', false]]);
  assert.deepEqual(g.edges.map((e) => [e.a, e.b, e.label, e.dashed]), [[0, 1, '', false], [1, 2, 'last hop', false], [2, 3, 'x -> y', true]]);
  assert.deepEqual(g.problems, []);
});

test('flow: a box that points to itself is a problem, not a crash', () => {
  const g = parseFlow('a -> a\na -> b');
  assert.equal(g.edges.length, 1);
  assert.match(g.problems[0].msg, /points to itself/);
});

test('flow: ranks follow the arrows, boxes in a rank never overlap, a cycle gets one return loop', () => {
  const g = parseFlow('a -> b\na -> c\nb -> d\nc -> d\nd -> a: again\na -> e\ne -> d');
  const L = layoutFlow(g);
  const at = Object.fromEntries(L.boxes.map((b) => [b.label, b]));
  for (const e of g.edges) {
    if (e.label === 'again') continue;
    assert.ok(at[g.nodes[e.b].label].y > at[g.nodes[e.a].label].y, `${g.nodes[e.a].label} above ${g.nodes[e.b].label}`);
  }
  assert.equal(L.edges.filter((e) => e.back).length, 1);
  const rows = {};
  for (const b of L.boxes) (rows[b.y] ||= []).push(b);
  for (const row of Object.values(rows)) {
    row.sort((p, q) => p.x - q.x);
    for (let i = 1; i < row.length; i++) assert.ok(row[i].x >= row[i - 1].x + row[i - 1].w, 'no overlap in a rank');
  }
  assert.deepEqual(layoutFlow(parseFlow('a -> b\na -> c\nb -> d\nc -> d\nd -> a: again\na -> e\ne -> d')), L, 'same text, same picture');
});

test('flow: labels are text in the SVG, never markup', () => {
  const html = flow('<script>x</script> -> b: <img src=x onerror=1>', 'cap <b>', '3.1').html;
  assert.ok(!/<script|<img/.test(html));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.match(html, /<figcaption><b>Fig\. 3\.1<\/b> cap &lt;b&gt;<\/figcaption>/);
  assert.match(html, /aria-label="Diagram: cap &lt;b&gt;\. &lt;script&gt;x&lt;\/script&gt; to b/);
});

// Flows from the design-review board and two shapes that faulted in a field report (invented names).
const FLOWS = [
  'direction: right\nsource card -> card: from=\nneeded card -> card: needs=\noption -> decision: listed as an option\nmentioned card --> card: [[id]], focus only',
  'Send -> cards serve: served page\ncards serve -> log.jsonl\nlog.jsonl -> agent: cards wait\nSend -> clipboard: file page\nclipboard -> chat: you paste\nchat -> agent',
  'user -> client: chat\nclient -> adapter: API\nadapter -> executor: HTTP\nexecutor -> printer: driver\nclient --> model: completions\nadapter -> workers: audit job\nworkers -> printer: driver\nadapter -> package: export\npackage -> scanner: pages\nscanner -> verifiers: lines\nverifiers -> review: sheet',
  'group Browser: web app\ngroup Cloud: *api*, worker, orders, queue\nstore: orders, queue\nweb app -> api: HTTPS\napi -> orders: write\napi -> queue: enqueue\nqueue -> worker\nworker -> orders: update\nworker --> email: notify',
  '*board.org* -> cards render: agent writes\ncards render -> board.html\nboard.html -> you: open\nyou -> log.jsonl: Send\nlog.jsonl -> agent: cards wait\nagent -> board.org: revise\nstore: log.jsonl, board.org',
];

test('flow: arrows run at right angles, and none of these flows has a fault a reader would misread', () => {
  for (const src of FLOWS) {
    const g = parseFlow(src);
    const L = layoutFlow(g);
    for (const e of L.edges) {
      e.xy.slice(1).forEach((q, x) => {
        const p = e.xy[x];
        assert.ok(Math.abs(p[0] - q[0]) < 0.01 || Math.abs(p[1] - q[1]) < 0.01, `a run of ${e.a} -> ${e.b} is not straight`);
      });
    }
    assert.deepEqual(flowIssues(g, L), [], src.split('\n')[0]);
  }
});

test('flow: the checks see a label on a line, a line through a box, a cut name and a drawing too wide', () => {
  const g = parseFlow('a -> b: over');
  const L = layoutFlow(g);
  const e = L.edges[0];
  // Put the label on its own line, and a stranger box across the arrow.
  e.label = { x: e.xy[0][0], y: (e.xy[0][1] + e.xy[1][1]) / 2, anchor: 'middle', text: 'over' };
  L.boxes.push({ k: 99, label: 'stranger', x: e.xy[0][0] - 5, y: e.xy[0][1] + 2, w: 10, h: 4, lines: ['x'], cut: false });
  g.nodes.push({ k: 99, label: 'stranger' });
  const codes = flowIssues(g, L).map((x) => x.code);
  assert.ok(codes.includes('label-on-line'));
  assert.ok(codes.includes('line-through-box'));
  const long = parseFlow('a box whose name runs on and on and on past three whole lines of its text -> b');
  assert.ok(flowIssues(long, layoutFlow(long)).some((x) => x.code === 'box-cut' && /shorten its name/.test(x.msg)));
  const chain = parseFlow('direction: right\n' + Array.from({ length: 9 }, (_, i) => `step ${i} -> step ${i + 1}`).join('\n'));
  const wide = flowIssues(chain, layoutFlow(chain)).find((x) => x.code === 'too-wide');
  assert.match(wide.msg, /write direction: down/);
});

test('flow: a group is one frame around its boxes and no other; a store is a cylinder', () => {
  const g = parseFlow('group Cloud: api, db\nstore: db\nweb -> api -> db\nweb -> cdn\ncdn -> api\napi -> mail');
  assert.deepEqual(g.groups, [{ label: 'Cloud', members: [0, 1] }]);
  assert.equal(g.nodes.find((n) => n.label === 'db').store, true);
  assert.equal('store' in g.nodes.find((n) => n.label === 'api'), false, 'a node keeps its old shape when nothing is said');
  const L = layoutFlow(g);
  assert.equal(L.frames.length, 1);
  assert.deepEqual(flowIssues(g, L), []);
  const html = flow('group Cloud: api, db\nstore: db\nweb -> api -> db', 'Two zones', '2.1').html;
  assert.match(html, /<g class="fg"[^>]*><rect /);
  assert.match(html, /<g class="fn store" data-n="1"[^>]*><path d="M/);
  assert.match(html, /<g class="fg-name"><text[^>]*>Cloud<\/text>/);
  assert.match(parseFlow('group Cloud: a\ngroup Edge: a, b').problems[0].msg, /in two groups/);
  // Many generated flows with a group: the frame never takes in a box that is not in it.
  let seed = 3;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const names = ['api', 'web', 'worker', 'queue', 'db', 'cache', 'auth', 'mail', 'cdn'];
  for (let t = 0; t < 300; t++) {
    const n = 4 + Math.floor(rnd() * 5);
    const lines = [];
    for (let b = 1; b < n; b++) lines.push(`${names[Math.floor(rnd() * b)]} -> ${names[b]}`);
    for (let i = 0; i < 2; i++) { const a = Math.floor(rnd() * n); const b = Math.floor(rnd() * n); if (a !== b) lines.push(`${names[a]} -> ${names[b]}`); }
    const k = 2 + Math.floor(rnd() * 2);
    const s = Math.floor(rnd() * (n - k));
    lines.push(`group Zone: ${names.slice(s, s + k).join(', ')}`);
    if (rnd() < 0.3) lines.unshift('direction: right');
    const gg = parseFlow(lines.join('\n'));
    const LL = layoutFlow(gg);
    assert.deepEqual(flowIssues(gg, LL).filter((x) => x.code === 'frame-cuts-box'), [], lines.join(' | '));
    assert.ok(LL.width < 4000, 'a frame does not push the drawing out of bounds');
  }
});

test('flow: groups in crossed order keep one order; frames that cannot stay apart keep their places and are said', () => {
  // A reviewer's case: 6 boxes once grew to 30,604 px as two bands pushed each other.
  const crossed = parseFlow('a -> x\nb -> y\nc -> z\ngroup G1: a, y, c\ngroup G2: b, x, z');
  assert.ok(layoutFlow(crossed).width < 600, `width ${layoutFlow(crossed).width}`);
  // G1 holds d and a, but b of G2 stands between them on one chain: no two frames can hold that.
  const tangled = parseFlow('b -> a\ne -> f\nd -> b\ngroup G1: d, a\ngroup G2: f, b');
  const L = layoutFlow(tangled);
  assert.equal(L.tangled, true);
  assert.ok(L.width < 600);
  assert.match(flowIssues(tangled, L).find((x) => x.code === 'groups-tangled').msg, /groups "G1" and "G2" take boxes from the same ranks in crossed order/);
});

// ---------- sequence ----------

test('sequence: columns in order of first mention, a row per message, replies dashed, a call to itself', () => {
  const q = parseSequence('client\nclient -> api: POST /order\napi -> api: check stock\napi -> db: insert\ndb --> api: id 42\napi --> client: 201');
  assert.deepEqual(q.parts.map((p) => p.label), ['client', 'api', 'db']);
  assert.deepEqual(q.msgs.map((m) => [m.a, m.b, m.dashed, m.label]), [[0, 1, false, 'POST /order'], [1, 1, false, 'check stock'], [1, 2, false, 'insert'], [2, 1, true, 'id 42'], [1, 0, true, '201']]);
  const L = layoutSequence(q);
  const xs = L.parts.map((p) => p.cx);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], 'columns left to right');
  const ys = L.rows.map((r) => r.y);
  assert.ok(ys.every((y, i) => !i || y > ys[i - 1]), 'rows top to bottom');
  // A label fits between the two lines it joins.
  const r0 = L.rows[0];
  assert.ok(xs[1] - xs[0] >= cols('POST /order') * 7.2 + 24 - 0.01);
  assert.equal(r0.text.anchor, 'middle');
  const html = sequence('a -> b: <x>\nb --> a', 'Calls', '3.1').html;
  assert.match(html, /<svg class="flow seq"/);
  assert.match(html, /<g class="fe dash" data-a="1" data-b="0">/);
  assert.ok(html.includes('&lt;x&gt;') && !html.includes('<x>'));
  assert.match(html, /aria-label="Sequence: Calls\. a to b \(&lt;x&gt;\); b to a"/);
});

// ---------- chart ----------

const BARS = '| queue | p95 ms |\n|-------+--------|\n| NATS  |      4 |\n| Kafka |  1,100 |\n| SQS   |        |';

test('chart: an Org table gives bars for names and a line for numbers or dates; a unit stays in the head', () => {
  const c = parseChart(BARS);
  assert.equal(c.type, 'bar');
  assert.deepEqual(c.xs, ['NATS', 'Kafka', 'SQS']);
  assert.deepEqual(c.series.map((x) => [x.name, x.values.map((v) => v.v)]), [['p95 ms', [4, 1100, null]]]);
  assert.deepEqual(c.problems, []);
  assert.equal(parseChart('| month | asks |\n|---|---|\n| 2026-08 | 9 |\n| 2026-09 | 6 |\n| 2026-10 | 3 |').type, 'line');
  assert.equal(parseChart('type: bar\n| year | n |\n|---|---|\n| 2024 | 1 |\n| 2025 | 2 |\n| 2026 | 3 |').type, 'bar');
  const bad = parseChart('| q | ms |\n|---|---|\n| NATS | fast |\n| SQS | 38 ms |');
  assert.deepEqual(bad.problems.map((p) => p.msg.slice(0, 32)), ['"fast" in the column "ms" is not', '"38 ms" in the column "ms" is no']);
  assert.match(parseChart('| a | 1 |\n| b | 2 |').problems[0].msg, /first row is read as the names of the columns/);
  const html = chart(BARS, 'p95 by queue', '4.1').html;
  assert.equal((html.match(/<rect class="c-bar s0"/g) || []).length, 2, 'an empty cell draws no bar');
  assert.match(html, /aria-label="Chart: p95 by queue\. p95 ms: NATS 4, Kafka 1,100, SQS -"/);
  const line = chart('| round | asks | cards |\n|---|---|---|\n| 1 | 9 | 22 |\n| 2 | 6 | 27 |\n| 3 | 3 | 30 |', 'Per round', '4.2').html;
  assert.equal((line.match(/<path class="c-ln s\d"/g) || []).length, 2);
  assert.match(line, />asks<\/text>/, 'each line is named at its end');
});

test('chart: hostile numbers end at once and draw no NaN; no numbers yet is said', () => {
  const cases = [
    '| d | bytes |\n|---|---|\n| 1 | 1.2e16 |\n| 2 | 1.2e16 |\n| 3 | 1.2e16 |',
    '| q | n |\n|---|---|\n| a | 1e999 |\n| b | 2 |',
    'type: line\n| d | n |\n|---|---|\n| 2026-10 | 5 |',
    '| d | n |\n|---|---|\n| 1 | 1e-300 |\n| 2 | 1e-300 |\n| 3 | 1e-300 |',
    '| x | n |\n|---|---|\n| 9007199254740993 | 1 |\n| 9007199254740993 | 2 |\n| 9007199254740993 | 3 |',
  ];
  for (const src of cases) {
    const t = Date.now();
    const r = chart(src, 'c', '1.1');
    assert.ok(Date.now() - t < 500, src);
    assert.ok(!/NaN|Infinity/.test(r.html), src);
  }
  assert.match(chart(cases[1], 'c', '1.1').problems[0].msg, /"1e999" in the column "n" is not a number/);
  const empty = chart('| d | n |\n|---|---|\n| 1 | |\n| 2 | - |', 'c', '1.1');
  assert.match(empty.html, /class="chart-none"/);
  assert.equal(empty.issues[0].code, 'no-numbers');
});

test('lint: sequence and chart are drawn kinds; their faults are said with a fix; a wide flow says how to fit', () => {
  const m = msgs('## A card with a chart and a sequence {#a}\nGist.\n\n```chart Numbers\n| q | ms |\n|---|---|\n| NATS | fast |\n```\n\n```sequence Calls\na\n```\n');
  assert.ok(!m.some((x) => /shown as code/.test(x)), m.join('\n'));
  assert.ok(m.some((x) => x.startsWith('chart: "fast" in the column "ms" is not a number')));
  assert.ok(m.some((x) => x.startsWith('sequence has no messages')));
  const wide = msgs('## A wide flow is said to be too wide {#a}\nGist.\n\n```flow Steps\ndirection: right\n' + Array.from({ length: 9 }, (_, i) => `step ${i} -> step ${i + 1}`).join('\n') + '\n```\n');
  assert.ok(wide.some((x) => /^flow: the drawing is \d+ px wide, and a card on the desk shows \d+ px of it; write direction: down/.test(x)), wide.join('\n'));
});

test('versions: a chart table re-aligned is the same chart; a flow with no group or store means what it meant', () => {
  const card = (body) => parseBoard(board(`## A card with a figure here {#a}\nGist.\n\n${body}\n`)).cards[0];
  const a = card('```chart N\n| q | ms |\n|---|---|\n| NATS | 4 |\n```');
  const b = card('```chart N\n|  q   |  ms |\n|------+-----|\n| NATS |   4 |\n```');
  const c = card('```chart N\n| q | ms |\n|---|---|\n| NATS | 5 |\n```');
  assert.equal(canonical(a), canonical(b));
  assert.notEqual(canonical(a), canonical(c));
  // The meaning of an old flow is the JSON it had before groups and stores existed.
  const f = card('```flow F\n*a* -> b: x\nb --> c\n```');
  const g = parseFlow('*a* -> b: x\nb --> c');
  assert.ok(canonical(f).includes(JSON.stringify([g.dir, g.nodes, g.edges]).replace(/"/g, '&quot;')), canonical(f));
});

// ---------- sketch ----------

test('sketch: shown as written, escaped, measured in columns', () => {
  const s = sketch('\n┌──┐ <b>\n└──┘\n\n', 'Two boxes', '4.1');
  assert.match(s.html, /<pre class="sketch"[^>]*>┌──┐ &lt;b&gt;\n└──┘<\/pre>/);
  assert.equal(s.cols, 8);
  assert.equal(cols('中文ab'), 6, 'wide characters take two columns');
});

test('md: a fence keeps its caption; a backtick in it still means no fence', () => {
  const [b] = parseBlocks('```sketch The rack, card 6 in focus\nx\n```');
  assert.deepEqual([b.lang, b.info], ['sketch', 'The rack, card 6 in focus']);
  assert.equal(parseBlocks('```sketch a ` b\nx\n```')[0].type, 'paragraph');
});

// ---------- anatomy and compile ----------

const FIG_CARD = '# S\n\n## A card with two figures {#a}\nGist.\n\n```sketch First\n' + '─'.repeat(60) +
  '\n```\n\nDepth.\n\n```flow Second\nx -> y\n```\n\n## Another card here {#b}\nGist.\n';

test('anatomy: the first figure shows with the gist; later figures stay in depth', () => {
  const b = parseBoard(board(FIG_CARD));
  const a = b.cards[0].anatomy;
  assert.equal(a.figure.lang, 'sketch');
  assert.deepEqual(a.depth.map((x) => x.lang || x.type), ['paragraph', 'flow']);
});

test('compile: figures are numbered per card in source order; a wide figure widens its card', () => {
  const b = parseBoard(board(FIG_CARD), { id: 'f' });
  const st = { cards: new Map([['a', { n: 7, v: 1, rev: 1, history: [] }], ['b', { n: 8, v: 1, rev: 1, history: [] }]]), rev: 1, sends: [], read: 0 };
  const d = pageData(b, st, { file: '/x/board.md' }, { cwd: '/x' });
  assert.match(d.cards.a.figure_html, /Fig\. 7\.1<\/b> First/);
  assert.match(d.cards.a.depth_html, /Fig\. 7\.2<\/b> Second/);
  assert.equal(d.cards.a.wide, true);
  assert.ok(d.cards.a.fig_w > 330);
  assert.equal(d.cards.b.figure_html, '');
  assert.equal(d.cards.b.wide, false);
});

// ---------- lint: figures ----------

test('lint: figures need a caption, a sketch has a width limit, a flow has a box limit', () => {
  const big = Array.from({ length: 13 }, (_, i) => `n${i} -> n${i + 1}`).join('\n');
  const m = msgs(`## A card with figures {#a}\nGist.\n\n\`\`\`sketch\n${'x'.repeat(80)}\n\`\`\`\n\n\`\`\`flow Big\n${big}\n\`\`\`\n`);
  assert.ok(m.some((x) => x.startsWith('```sketch has no caption')));
  assert.ok(m.some((x) => x.startsWith('sketch is 80 columns wide')));
  assert.ok(m.some((x) => x.startsWith('flow has 14 boxes')));
});

test('lint: in a compare section, draw every option or none', () => {
  const m = msgs('# Options {compare}\n\n## Option one is drawn {#a}\nGist.\n\n```sketch One\nx\n```\n\n## Option two is not drawn {#b}\nGist.\n');
  assert.ok(m.some((x) => x.includes('1 of 2 options have a figure')));
});

// ---------- lint: asks ----------

test('lint: an ask that is not a real decision is said; a named step with its stakes, or an open question, is not', () => {
  const m = msgs([
    '## Shall I proceed? {#a ask=approve}\nShort.\n',
    '## Which queue? {#b ask=choose}\nNATS covers the peak with one binary, and Kafka costs a cluster to run.\n\n- [x] NATS\n- [ ] Kafka\n',
    '## Pick the one option here {#e ask=choose}\nThis choice has only one option to take, which is no choice at all.\n\n- [x] only\n',
    '## Freeze writes on the search API for 10 minutes at 02:00 UTC {#c ask=approve}\nThe final swap needs a write freeze, and nobody can save a search for those minutes.\n',
    '## Which sessions can we drop instead of copying? {#d ask=answer}\nSessions idle for 30 days are most rows; only you know whether a customer needs them.\n',
  ].join('\n'));
  const about = (re) => m.filter((x) => re.test(x));
  assert.equal(about(/asks for permission or feedback/).length, 1);
  assert.match(about(/asks for permission or feedback/)[0], /^ask "Shall I proceed\?"/);
  assert.equal(about(/claim of this choice is a question/).length, 1);
  assert.equal(about(/needs its stakes/).length, 1, 'only the ask with a one-word gist');
  assert.equal(about(/one option is not a choice/).length, 1);
  for (const ok of ['Any feedback on the plan?', 'Is this OK?', 'Can we continue with the migration?', 'Does this look good to you?']) {
    assert.ok(msgs(`## ${ok} {#x ask=approve}\nThe stakes go here in one sentence of enough words.\n`).some((x) => /permission or feedback/.test(x)), ok);
  }
  for (const real of ['Can I make the search API read-only for 10 minutes?', 'Push 0.3.0 to main and tag it', 'Approve the payment fix before it ships']) {
    assert.ok(!msgs(`## ${real} {#x ask=approve}\nThe stakes go here in one sentence of enough words.\n`).some((x) => /permission or feedback/.test(x)), real);
  }
});

// ---------- lint: writing ----------

test('lint: long sentences and listed words are flagged with the plain word', () => {
  const long = 'This sentence goes on and on with many words so that the checker sees more than twenty five of them in one single place right here today.';
  const m = msgs(`## Agents utilize the queue {#a}\n${long} We leverage it.\n`);
  assert.ok(m.includes('"utilize": write use (writing.md word list)'));
  assert.ok(m.includes('"leverage": write use (writing.md word list)'));
  assert.ok(m.some((x) => /^sentence has 27 words; split it/.test(x)));
});

test('lint: quotes and code are not the writer\'s words; other languages skip the checks', () => {
  assert.deepEqual(msgs('## A quote is fine here {#a}\nHe said "we utilize it" and `utilize()` runs.\n'), []);
  const zh = lint(parseBoard(board('## 我们 utilize 这个队列 {#a}\n要点。\n', 'title: T\nlang: zh-Hans'))).map((w) => w.msg);
  assert.deepEqual(zh, []);
});

test('lint: a paragraph past six sentences is flagged', () => {
  const m = msgs('## A long paragraph here {#a}\nGist.\n\nOne. Two. Three. Four. Five. Six. Seven.\n');
  assert.ok(m.some((x) => x.startsWith('paragraph has 7 sentences')));
});

test('sentences: e.g. and decimals do not split a sentence', () => {
  assert.deepEqual(sentences('Use a queue, e.g. NATS. It takes 1.5 ms. Done!'), ['Use a queue, e.g. NATS.', 'It takes 1.5 ms.', 'Done!']);
});
