// Class diagrams: Mermaid's classDiagram lines, drawn by the compiler with the flow's layout.
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, canonical } from '../skill/lib/board.mjs';
import { lint } from '../skill/lib/lint.mjs';
import { pageData } from '../skill/lib/compile.mjs';
import { parseClass, classDiagram, classIssues, layoutFlow, partsOf, ROOMS } from '../skill/lib/figure.mjs';

const org = (body) => `#+title: T\n\n${body}`;
const card = (claim, id, props = '', body = 'A gist of a few words here.') =>
  `** ${claim}\n:PROPERTIES:\n:CUSTOM_ID: ${id}\n${props}:END:\n${body}\n`;
const parse = (body) => parseBoard(org(body), { fmt: 'org' });
const st = (board) => ({ rev: 1, sends: [], read: 0, says: [], cards: new Map(board.cards.map((c, i) => [c.id, { n: i + 1, v: 1, rev: 1, history: [] }])) });
const data = (board) => pageData(board, st(board), { file: '/x/board.org' }, { cwd: '/x' });
const names = (g) => (e) => `${g.nodes[e.a].label} ${e.ends.a || '-'}/${e.ends.b || '-'} ${g.nodes[e.b].label}`;

const SHOP = [
  'classDiagram',
  'class Order {',
  '  +id: str',
  '  +total() int',
  '  (orders.py:12)',
  '  +count()$',
  '  +price() int*',
  '}',
  '<<interface>> Store',
  'Order "1" *-- "1..*" Line',
  'Order --> Customer : placed by',
  'Store <|.. PgStore',
  'Order o-- Coupon',
  'Order ..> Receipt',
  'Line -- Product',
].join('\n');

test('class: members, methods, statics and annotations, as Mermaid writes them', () => {
  const g = parseClass(SHOP);
  assert.deepEqual(g.problems, []);
  const order = g.nodes.find((n) => n.label === 'Order');
  assert.deepEqual(order.fields.map((m) => m.text), ['+id: str', '(orders.py:12)']);
  assert.deepEqual(order.methods.map((m) => [m.text, m.static, m.abstract]), [['+total() int', false, false], ['+count()', true, false], ['+price() int', false, true]]);
  assert.equal(g.nodes.find((n) => n.label === 'Store').ann, 'interface');
  // Inside the braces, outside them, a shown name, and a generic.
  const h = parseClass('class Shape~T~ {\n  <<abstract>>\n  +area() float\n}\nShape : +name str\nclass Sq["Square (v2)"]\nShape <|-- Sq');
  assert.deepEqual(h.nodes.map((n) => [n.label, n.ann, n.fields.length, n.methods.length]), [['Shape<T>', 'abstract', 1, 1], ['Square (v2)', '', 0, 0]]);
  assert.deepEqual(h.problems, []);
});

test('class: every relation says its ends, and the parent and the whole stand above', () => {
  const g = parseClass('A <|-- B\nC --|> D\nE *-- F\nG --* H\nI o-- J\nK --> L\nM <-- N\nO ..> P\nQ ..|> R\nS -- T\nU .. V');
  assert.deepEqual(g.edges.map(names(g)), [
    'A tri/- B', 'D tri/- C', 'E dia/- F', 'H dia/- G', 'I odia/- J',
    'K -/arrow L', 'N -/arrow M', 'O -/arrow P', 'R tri/- Q', 'S -/- T', 'U -/- V',
  ]);
  assert.deepEqual(g.edges.map((e) => e.dashed), [false, false, false, false, false, false, false, true, true, false, true]);
  const c = parseClass('Order "1" *-- "1..*" Line : has\nItem "0..*" --> Sku');
  assert.deepEqual(c.edges.map((e) => [e.counts.a, e.counts.b, e.label]), [['1', '1..*', 'has'], ['0..*', '', '']]);
  // Read from the other side, the counts stay at their own ends.
  const r = parseClass('Line "1..*" --* "1" Order');
  assert.deepEqual([r.nodes[r.edges[0].a].label, r.edges[0].counts.a, r.edges[0].counts.b], ['Order', '1', '1..*']);
  const L = layoutFlow(g);
  const box = (name) => L.boxes.find((b) => b.label === name);
  for (const [up, low] of [['A', 'B'], ['D', 'C'], ['E', 'F'], ['H', 'G'], ['N', 'M']]) assert.ok(box(up).y < box(low).y, `${up} stands above ${low}`);
  assert.equal(parseClass('direction LR\nA --> B').dir, 'right');
  assert.equal(parseClass('direction TB\nA --> B').dir, 'down');
});

test('class: what Mermaid styles and notes is said, not drawn; a line it does not read is said', () => {
  const g = parseClass([
    'class A:::hot',
    'note for A "a note"',
    'style A fill:#f00',
    'classDef hot fill:#f00',
    'click A href "x"',
    'A ()-- B',
    'A --> A',
    'namespace Empty {',
    '}',
    'class Open {',
  ].join('\n'));
  const msgs = g.problems.map((p) => p.msg).join('\n');
  assert.match(msgs, /":::hot" is a style; it is not drawn/);
  assert.match(msgs, /a note is not drawn; say it in the card/);
  for (const w of ['style', 'classDef', 'click']) assert.match(msgs, new RegExp(`"${w}" is not drawn`));
  assert.match(msgs, /"A \(\)-- B" is not read/);
  assert.match(msgs, /"A" relates to itself/);
  assert.match(msgs, /namespace "Empty" holds no class/);
  assert.match(msgs, /the braces of class "Open" are not closed/);
  assert.deepEqual(g.groups, []);
});

test('class: the drawing is SVG the compiler writes; members are text, never markup', () => {
  const r = classDiagram('class Evil {\n  +x: <script>alert(1)</script>\n}\nEvil *-- Part\nEvil <|-- Sub\nEvil o-- Held\nEvil --> Ref', 'Model', '1', {});
  assert.doesNotMatch(r.html, /<script/);
  assert.match(r.html, /&lt;script&gt;/);
  assert.match(r.html, /<path class="mk dia" d="M[^"]+Z"\/>/);
  assert.match(r.html, /<path class="mk tri" d="M[^"]+Z"\/>/);
  assert.match(r.html, /<path class="mk odia" d="M[^"]+Z"\/>/);
  assert.match(r.html, /<g class="fn cls" data-n="0" data-part="evil"><rect[^>]*\/><text class="name"[^>]*>Evil<\/text><path class="sep"/);
  // A screen reader hears the relation, not the arrow.
  assert.match(r.html, /aria-label="Class diagram: Model\. Evil owns Part; Sub is a kind of Evil; Evil holds Held; Evil to Ref"/);
  assert.deepEqual(r.issues, []);
});

test('class: a marked line runs straight from its box before it bends, and each count stands clear', () => {
  const g = parseClass('Order "1" *-- "1..*" Line\nOrder *-- "0..*" Coupon\nOrder *-- "0..*" Payment\nOrder *-- "0..*" Note\nLine "1" *-- "0..*" Tax\nTax --> Region : region_id');
  const L = layoutFlow(g);
  for (const e of L.edges) {
    if (!e.ends.a) continue;
    const [p, q] = e.xy;
    assert.ok(Math.hypot(q[0] - p[0], q[1] - p[1]) >= 16, `the first run of ${g.nodes[e.a].label} -> ${g.nodes[e.b].label} holds its mark`);
  }
  assert.equal(L.edges.reduce((n, e) => n + e.counts.length, 0), 7);
  assert.deepEqual(classIssues(g, L, ROOMS.sheet), []);
  // Left to right as well.
  const r = parseClass('direction LR\nOrder "1" *-- "1..*" Line\nOrder *-- "0..*" Coupon\nOrder *-- "0..*" Payment');
  assert.deepEqual(classIssues(r, layoutFlow(r), ROOMS.sheet), []);
});

// Generated diagrams of real shape: a tree of 3 to 12 classes, a few cross links, a third of
// the lines counted or labelled, some members, a namespace now and then.
function generated(n, seed) {
  let s = seed;
  // mulberry32: an LCG on doubles loses its low bits and repeats after a few thousand draws.
  const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const NAMES = ['Order', 'Line', 'Customer', 'Invoice', 'Payment', 'Coupon', 'Store', 'PgStore', 'Cache', 'Product', 'Price', 'Tax', 'Region', 'Refund', 'Card', 'Account', 'Address', 'Shipment', 'Warehouse', 'Supplier'];
  const RELS = ['<|--', '*--', 'o--', '-->', '..>', '..|>', '--', '<|..'];
  const COUNTS = ['1', '0..1', '1..*', '0..*', '*'];
  const out = [];
  for (let t = 0; t < n; t++) {
    const k = 3 + Math.floor(rnd() * 10);
    const cls = NAMES.slice().sort(() => rnd() - 0.5).slice(0, k);
    const lines = [rnd() < 0.2 ? 'direction LR' : 'classDiagram'];
    for (const c of cls) {
      if (rnd() < 0.6) {
        lines.push(`class ${c} {`);
        for (let i = Math.floor(rnd() * 4); i > 0; i--) lines.push(rnd() < 0.5 ? `  +f${i}: str` : `  +m${i}() int`);
        lines.push('}');
      }
    }
    for (let i = 1; i < k; i++) {
      const a = cls[Math.floor(rnd() * i)];
      const ca = rnd() < 0.3 ? `"${pick(COUNTS)}" ` : '';
      const cb = rnd() < 0.3 ? ` "${pick(COUNTS)}"` : '';
      lines.push(`${a} ${ca}${pick(RELS)}${cb} ${cls[i]}${rnd() < 0.3 ? ` : ${pick(['holds', 'creates', 'placed by', 'per order'])}` : ''}`);
    }
    for (let i = Math.floor(rnd() * 3); i > 0; i--) { const a = pick(cls); const b = pick(cls); if (a !== b) lines.push(`${a} --> ${b}`); }
    if (rnd() < 0.3) lines.push('namespace Core {', ...cls.slice(0, 2).map((c) => `  class ${c}`), '}');
    out.push(lines.join('\n'));
  }
  return out;
}

test('class: 300 generated diagrams of real shape: no count or mark fault, and 97% with no fault at all', () => {
  const srcs = generated(300, 1);
  assert.equal(new Set(srcs).size, 300, 'the diagrams are distinct');
  let clean = 0;
  for (const src of srcs) {
    const g = parseClass(src);
    assert.deepEqual(g.problems, [], src);
    const iss = classIssues(g, layoutFlow(g), ROOMS.sheet).filter((x) => x.code !== 'too-wide');
    // A label among many lines may still lie on one, as in a flow; the check says so. A count
    // and a mark are this kind's own, and always stand clear.
    assert.deepEqual(iss.filter((x) => x.code === 'label-on-mark' || /the count/.test(x.msg.split(';')[0])), [], src);
    if (!iss.length) clean++;
  }
  assert.ok(clean >= 291, `${clean} of 300 with no fault`);
});

test('class: a sheet pins cards on a class and on a namespace; a wrong pin lists the parts', () => {
  const sheet = card('Billing owns the invoice and its lines  :sheet:', 'model', '', [
    'Look at the middle.',
    '',
    '#+begin_src class',
    '  namespace Billing {',
    '    class Invoice',
    '    class InvoiceLine',
    '  }',
    '  Invoice "1" *-- "1..*" InvoiceLine',
    '  Invoice --> Customer',
    '#+end_src',
  ].join('\n'));
  assert.deepEqual([...partsOf({ type: 'code', lang: 'class', text: 'namespace Billing {\n  class Invoice\n}\nInvoice --> Customer' }).keys()], ['invoice', 'customer', 'billing']);
  const b = parse(`* S\n${sheet}${card('An invoice line has no tax rate', 'tax', ':ON: model/invoiceline model/billing\n')}`);
  assert.deepEqual(b.errors, []);
  const html = data(b).cards.model.figure_html;
  assert.match(html, /<g class="fn cls pinned" data-n="1" data-part="invoiceline">.*<g class="pin" data-card="tax">/);
  assert.match(html, /<g class="fg pinned" data-part="billing">/);
  const bad = parse(`* S\n${sheet}${card('An invoice line has no tax rate', 'tax', ':ON: model/invoicelines\n')}`);
  assert.match(bad.errors.map((e) => `${e.msg} | ${e.fix}`)[0], /has no part "invoicelines" \| its parts: model\/invoice model\/invoiceline model\/customer model\/billing/);
});

test('lint: a class diagram is a drawn kind; its faults, its size and a Mermaid block are said', () => {
  const warns = (body) => lint(parse(`* S\n${body}`)).map((w) => w.msg).join('\n');
  const fig = (text, caption = '#+caption: The model\n') => card('The model has three parts', 'm', '', `Gist of the card here.\n\n${caption}#+begin_src class\n${text}\n#+end_src`);
  assert.equal(warns(fig('Order *-- Line\nOrder --> Customer')), '');
  assert.match(warns(fig('Order *-- Line\nnote for Order "x"')), /class: a note is not drawn/);
  assert.match(warns(fig(Array.from({ length: 7 }, (_, i) => `Root *-- C${i}`).join('\n'))), /class diagram has 8 classes; split it \(<= 6\), or make it a sheet/);
  assert.match(warns(fig('Order *-- Line', '')), /the class block has no caption/);
  assert.match(warns(card('A model drawn as Mermaid', 'mm', '', 'Gist of the card here.\n\n#+begin_src mermaid\nclassDiagram\n  A <|-- B\n#+end_src')),
    /#\+begin_src mermaid is shown as code, not drawn\. A class diagram is drawn from the same lines in #\+begin_src class/);
  assert.match(warns(card('A model with front matter', 'mfm', '', 'Gist of the card here.\n\n#+begin_src mermaid\n---\ntitle: Orders\n---\nclassDiagram\n  A <|-- B\n#+end_src')),
    /A class diagram is drawn from the same lines in #\+begin_src class/);
  assert.match(warns(card('A flow drawn as Mermaid', 'mf', '', 'Gist of the card here.\n\n#+begin_src mermaid\nflowchart TD\n  A --> B\n#+end_src')),
    /Drawn kinds: sketch, flow, sequence, class, chart/);
  const wide = Array.from({ length: 16 }, (_, i) => `Root *-- Child${i}`).join('\n');
  assert.match(warns(card('The model is wide  :sheet:', 'w', '', `Gist of the card here.\n\n#+begin_src class\n${wide}\n#+end_src`)), /write direction LR \(then the classes of a rank stand in a column\), or split it/);
});

test('versions: a class diagram re-spaced is the same; a changed relation is a new version', () => {
  const at = (text) => canonical(parse(`* S\n${card('The model has three parts', 'm', '', `Gist.\n\n#+caption: M\n#+begin_src class\n${text}\n#+end_src`)}`).cards[0]);
  assert.equal(at('class A {\n  +x: int\n}\nA *-- B'), at('  class A {\n      +x: int\n  }\n\n  A  *--  B'));
  assert.notEqual(at('A *-- B'), at('A o-- B'));
  assert.notEqual(at('A "1" *-- B'), at('A *-- B'));
});

test('review of 0.5: lines the parser does not read are said, never drawn as a class', () => {
  const p = (t) => parseClass(t);
  // The one-line body the docs show.
  const one = p('class Order { +id: str }\nOrder *-- Line');
  assert.deepEqual(one.nodes.map((n) => [n.label, n.fields.map((m) => m.text)]), [['Order', ['+id: str']], ['Line', []]]);
  assert.deepEqual(one.problems, []);
  // A relation with no spaces, front matter, accessibility lines: said, no class drawn.
  for (const t of ['Animal<|--Duck', 'Order-->Customer', 'Animal<|--Duck : is a', 'A--B']) {
    const g = p(t);
    assert.deepEqual(g.nodes, [], t);
    assert.match(g.problems[0].msg, /is not a class name; a relation needs spaces around it/, t);
  }
  const fm = p('---\ntitle: Orders\n---\nclassDiagram\naccTitle: Orders\naccDescr {\n  A model\n}\nA --> B');
  assert.deepEqual(fm.nodes.map((n) => n.label), ['A', 'B']);
  assert.deepEqual(fm.problems.map((x) => x.msg.split(';')[0]), ['front matter is not read', 'accTitle is not read', 'accDescr is not read']);
  // A second relation that says something else is drawn too; the same one twice is one.
  const two = p('Shape <|-- Circle\nShape <|.. Circle\nOrder --> Customer : placed by\nOrder --> Customer : billed to\nOrder --> Customer : billed to\nOrder "1" *-- "1..*" Line\nOrder "1" *-- "0..1" Line');
  assert.equal(two.edges.length, 6);
  // Nested generics, as in Mermaid's own example.
  const gen = p('class Box~List~int~~ {\n  +getDistanceMatrix() List~List~int~~\n}');
  assert.deepEqual([gen.nodes[0].label, gen.nodes[0].methods[0].text], ['Box<List<int>>', '+getDistanceMatrix() List<List<int>>']);
  // A namespace holds the classes declared in it, not the ones a relation in it names.
  const ns = p('namespace Billing {\n  class Invoice\n  Invoice --> Customer\n}\nnamespace People {\n  class Customer\n}');
  assert.deepEqual(ns.groups, [{ label: 'Billing', members: [0] }, { label: 'People', members: [1] }]);
  assert.deepEqual(ns.problems, []);
  assert.match(p('namespace A {\n  class X\n}\nnamespace B {\n  class X\n}').problems[0].msg, /"X" is declared in two namespaces/);
  // BT and RL are said: the parent always stands first.
  assert.match(p('direction BT\nA <|-- B').problems[0].msg, /direction BT is drawn as TB/);
  // A classifier right after the parentheses.
  const st = p('class S {\n  +make()$ S\n  +area()* double\n}').nodes[0].methods;
  assert.deepEqual(st.map((m) => [m.text, m.static, m.abstract]), [['+make() S', true, false], ['+area() double', false, true]]);
});

test('review of 0.5: a count stands clear of the mark at its end, also left to right; a bare tall box centres its name', () => {
  for (const dir of ['', 'direction LR\n']) {
    const g = parseClass(`${dir}Shape "1" <|-- "0..1" Circle\nShape "1" *-- "1..*" Side\nShape o-- "0..*" Tag`);
    assert.deepEqual(classIssues(g, layoutFlow(g), ROOMS.sheet), [], dir || 'TB');
  }
  // A count put on a mark is said.
  const g = parseClass('Order "1" *-- Line');
  const L = layoutFlow(g);
  const [tip] = L.edges[0].marks[0].pts;
  L.edges[0].counts[0] = { x: tip[0], y: tip[1] + 6, anchor: 'middle', text: '1' };
  assert.ok(classIssues(g, L).some((x) => x.code === 'label-on-mark' && /the count "1" touches the mark of Order -> Line/.test(x.msg)));
  // Left to right, a box with counted lines grows taller; with no members its name stands in the middle.
  const r = classDiagram('direction LR\nHub "1" --> "0..*" A\nHub "1" --> "0..*" B\nHub "1" --> "0..*" C', '', '', {});
  const box = r.html.match(/<g class="fn cls" data-n="0"[^>]*><rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"[^>]*\/><text class="name" x="[\d.]+" y="([\d.]+)"/);
  assert.ok(+box[2] > 40, `the box grew: ${box[2]}`);
  assert.ok(Math.abs(+box[3] - (+box[1] + +box[2] / 2)) < 1, `the name is in the middle: ${box.slice(1)}`);
});
