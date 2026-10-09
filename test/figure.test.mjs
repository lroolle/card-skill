// Figures and the writing checks: sketch, flow, card anatomy, lint.
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlow, layoutFlow, flow, sketch, cols } from '../skill/lib/figure.mjs';
import { parseBlocks } from '../skill/lib/md.mjs';
import { parseBoard } from '../skill/lib/board.mjs';
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

test('flow: a label never sits on a line, its own included', () => {
  // The figure from the design-review board where a dashed line ran through "[[id]]".
  for (const src of [
    'direction: right\nsource card -> card: from=\nneeded card -> card: needs=\noption -> decision: listed as an option\nmentioned card --> card: [[id]], focus only',
    'Send -> cards serve: served page\ncards serve -> log.jsonl\nlog.jsonl -> agent: cards wait\nSend -> clipboard: file page\nclipboard -> chat: you paste\nchat -> agent',
  ]) {
    const L = layoutFlow(parseFlow(src));
    const bez = (s0, p0, s1, p1, t) => [s0 * (1 - 3 * t * t + 2 * t ** 3) + s1 * (3 * t * t - 2 * t ** 3),
      p0 * (1 - 1.5 * t + 1.5 * t * t - t ** 3) + p1 * (1.5 * t - 1.5 * t * t + t ** 3)];
    const down = L.dir === 'down';
    const points = L.edges.flatMap((e) => (e.pts || []).slice(1).flatMap((q, x) => {
      const [s0, p0] = e.pts[x];
      return Array.from({ length: 33 }, (_, k) => bez(s0, p0, q[0], q[1], k / 32)).map(([sv, pv]) => (down ? [sv, pv] : [pv, sv]));
    }));
    for (const e of L.edges.filter((x) => x.label)) {
      const tw = cols(e.label.text) * 7.2;
      const x0 = e.label.anchor === 'start' ? e.label.x : e.label.anchor === 'end' ? e.label.x - tw : e.label.x - tw / 2;
      const hits = points.filter(([x, y]) => x > x0 && x < x0 + tw && y > e.label.y - 6 && y < e.label.y + 6);
      assert.equal(hits.length, 0, `"${e.label.text}" touches a line`);
    }
  }
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
