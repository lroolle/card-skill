// figure.mjs -- figures: a card shows the shape it talks about.
//
//   #+begin_src sketch    a drawing in text characters, shown as written
//   #+begin_src flow      boxes and arrows; this file does the layout
//   #+begin_src sequence  calls between parts in time order; this file does the layout
//   #+begin_src class     classes and how they relate, in Mermaid's classDiagram lines
//   #+begin_src chart     numbers from an Org table (chart.mjs)
//
// The agent never writes SVG and never places a box. A sketch is escaped
// text. A flow is parsed into boxes and edges and laid out here, so the same
// text always gives the same picture, and no agent text reaches the page as
// markup. Each drawing is checked on its own geometry (flowIssues): a label on
// a line, a line through a box, a frame that cuts a box, a drawing wider than
// a card shows. `cards check` says each one with the change that fixes it.
//
// Flow syntax, one statement per line:
//   board.md -> cards render: agent writes     an edge; the label follows ": "
//   you --> log.jsonl                          dashed: optional, later, or weak
//   a -> b -> c                                a chain; a label goes on the last hop
//   **cards render** (or *cards render*)       bold: the part under discussion
//   group Your machine: board.org, log.jsonl   one frame around these boxes
//   store: log.jsonl                           these boxes hold data (a cylinder)
//   direction: right                           left to right (default: down)

import { esc, inline } from './md.mjs';
import { en } from './i18n.mjs';
import { chart, chartParts } from './chart.mjs';

export const FIGURE_LANGS = ['sketch', 'flow', 'sequence', 'class', 'chart'];
// An image file shown in a card is a figure too: numbered, captioned, under the gist.
export const IMAGE_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml' };
export const extOf = (p) => (String(p).match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
export const isImage = (p) => extOf(p) in IMAGE_EXT;
export const isFigure = (b) => (b.type === 'code' && FIGURE_LANGS.includes(b.lang)) || (b.type === 'file' && isImage(b.path));
// figuresIn(blocks) -> every figure of a card in the order of its source,
// also the ones inside a list or a quote.
export function figuresIn(blocks, acc = []) {
  for (const b of blocks || []) {
    if (isFigure(b)) acc.push(b);
    else if (b.type === 'list') b.items.forEach((it) => figuresIn(it.blocks, acc));
    else if (b.type === 'quote') figuresIn(b.blocks, acc);
  }
  return acc;
}
export const LIMITS = { sketchCols: 72, flowBoxes: 12, flowGroups: 4, sequenceParts: 6, sequenceMsgs: 16, classBoxes: 6 };

const CH = 7.2;     // advance of one column of 12px monospace
const LH = 16;      // line height inside a box
const PAD_X = 10;
const PAD_Y = 6;
const FIG_PAD = 12; // padding around the drawing inside the figure frame
export const WIDE = 330; // a figure wider than this needs two grid columns
// The widest drawing a desk column shows whole: 560px, less the card's padding and the frame's.
export const FIG_MAX = 560 - 34 - 2 * FIG_PAD;

// East Asian wide characters take two monospace columns.
const WIDE_CHAR = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
export function cols(s) {
  let n = 0;
  for (const ch of String(s)) n += WIDE_CHAR.test(ch) || ch.codePointAt(0) > 0xFFFF ? 2 : 1;
  return n;
}

// ---------- parts and pins ----------
//
// A sheet is a card that is one drawing (a card tagged :sheet:). Another card is pinned
// on a part of it with :ON: sheet/part, and the part then carries that card's numeral,
// as a part of a patent drawing carries its reference numeral. A part is anything the
// drawing names: a box or a group of a flow, a class or a namespace of a class diagram,
// a part of a sequence, a row of a bar chart,
// a line or a point of a line chart. Its key is its name, folded: lower case, and each run of
// spaces and other marks one dash. Letters, digits, + # and . stay, and so does the minus of a
// number: "Web app" is web-app, "C++" is c++, "board.org" is board.org, "-1" is -1.
export const partKey = (s) => {
  const t = String(s).normalize('NFKC').toLowerCase().trim();
  const k = t.replace(/[^\p{L}\p{N}+#.]+/gu, '-').replace(/^-+|-+$/g, '');
  return /^-\d/.test(t) ? '-' + k : k;
};

const PIN_H = 16;   // a numeral on a part: the card numeral's own size
const PIN_GAP = 3;  // between two numerals
const PIN_SEP = 6;  // between a name and its first numeral
const pinW = (p) => Math.max(18, cols(String(p.n)) * CH + 8);
export const pinsW = (pins) => (pins && pins.length ? pins.reduce((w, p) => w + pinW(p), 0) + PIN_GAP * (pins.length - 1) : 0);
// The numerals of a part, from x, centred on y. A numeral is a button for its card.
export function pinSvg(pins, x, y) {
  let at = x;
  return (pins || []).map((p) => {
    const w = pinW(p);
    const g = `<g class="pin${p.done ? ' done' : ''}" data-card="${esc(p.id)}"><title>${esc(p.title || '')}</title>` +
      `<rect x="${round(at)}" y="${round(y - PIN_H / 2)}" width="${round(w)}" height="${PIN_H}" rx="3"/>` +
      `<text x="${round(at + w / 2)}" y="${round(y)}" text-anchor="middle" dominant-baseline="central">${esc(p.n)}</text></g>`;
    at += w + PIN_GAP;
    return g;
  }).join('');
}
// pinsFor(ctx, name) -> the numerals pinned on the part with this name, or none.
const pinsFor = (ctx, name) => (ctx && ctx.pins && ctx.pins.get(partKey(name))) || null;

// partsOf(block) -> Map(key -> [names]): what a card can be pinned on in this drawing. Two
// names that fold to one key ("Web app" and "web-app", a box and a group both "api") share it.
export function partsOf(b) {
  const out = new Map();
  const add = (name) => {
    const k = partKey(name);
    if (!k) return;
    if (!out.has(k)) out.set(k, []);
    if (!out.get(k).includes(name)) out.get(k).push(name);
  };
  if (b.lang === 'flow') {
    const g = parseFlow(b.text);
    g.nodes.forEach((nd) => add(nd.label));
    g.groups.forEach((gr) => add(gr.label));
  } else if (b.lang === 'class') {
    const g = parseClass(b.text);
    g.nodes.forEach((nd) => add(nd.label));
    g.groups.forEach((gr) => add(gr.label));
  } else if (b.lang === 'sequence') {
    parseSequence(b.text).parts.forEach((p) => add(p.label));
  } else if (b.lang === 'chart') {
    const c = chartParts(b.text);
    c.forEach(add);
  }
  return out;
}

// Two rooms for a drawing. In a card it shares a column of the desk with the card's words.
// A sheet is the drawing: it takes the width it needs, up to SHEET_MAX at full size.
export const SHEET_MAX = 1120;
export const ROOMS = {
  card: { ...LIMITS, max: FIG_MAX },
  sheet: { sketchCols: 160, flowBoxes: 24, flowGroups: 8, sequenceParts: 10, sequenceMsgs: 32, classBoxes: 20, max: SHEET_MAX },
};
export const roomOf = (ctx) => ROOMS[ctx && ctx.room === 'sheet' ? 'sheet' : 'card'];
// What a check says when a drawing is wider than its room.
export function tooWide(width, room, fix) {
  if (room === ROOMS.sheet) return `the drawing is ${width} px wide, and a sheet shows ${SHEET_MAX} px at full size; ${fix}`;
  return `the drawing is ${width} px wide, and a card on the desk shows ${FIG_MAX} px of it; ${fix}, or make it a sheet (a card tagged :sheet:)`;
}

export function frame(kind, body, caption, label, ctx, extra = '') {
  const cap = caption ? ' ' + (ctx.inline || inline)(caption, ctx) : '';
  // A sheet's drawing has no number of its own and often no caption: then it has no caption line.
  const said = `${label ? `<b>${esc((ctx.t || en)('fig'))} ${esc(label)}</b>` : ''}${cap}`;
  return `<figure class="fig" data-kind="${kind}"${extra}><div class="fig-body">${body}</div>` +
    `${said ? `<figcaption>${said}</figcaption>` : ''}</figure>`;
}

// ---------- sketch ----------

// A sketch's lines as drawn: no trailing space, no blank lines around it, and
// no margin that every line shares (a uniform indent does not change a drawing).
export function sketchLines(text) {
  const lines = String(text).replace(/\t/g, '    ').split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const margin = Math.min(...lines.filter(Boolean).map((l) => l.match(/^ */)[0].length));
  return Number.isFinite(margin) && margin ? lines.map((l) => l.slice(margin)) : lines;
}

export function sketch(text, caption, label, ctx = {}) {
  const lines = sketchLines(text);
  const w = Math.max(0, ...lines.map(cols));
  const T = ctx.t || en;
  // A screen reader says the caption's words, not its Org marks.
  const said = caption && (ctx.plain ? ctx.plain(caption) : caption);
  const aria = esc(said ? T('fig_sketch_named', { caption: said }) : T('fig_sketch'));
  const body = `<pre class="sketch" role="img" aria-label="${aria}">${esc(lines.join('\n'))}</pre>`;
  return { html: frame('sketch', body, caption, label, ctx), width: Math.ceil(w * CH) + 2 * FIG_PAD, cols: w };
}

// ---------- flow: parse ----------

const ARROW = /\s*(-->|->)\s*/;

// A box name as written: **a** or *a* is bold (the part under discussion).
function boxName(raw) {
  let s = String(raw).trim();
  let strong = false;
  const m = s.match(/^\*\*(.+)\*\*$/) || s.match(/^\*([^*].*)\*$/);
  if (m) { s = m[1].trim(); strong = true; }
  return { s, strong };
}

// The arrows of one line: [{ a, b, dashed, label }], the label on the last hop.
// The label starts at the first ": " after the first arrow, so a label may contain arrows.
function hops(t) {
  const first = t.search(/-->|->/);
  if (first < 0) return null;
  const ci = t.indexOf(': ', first);
  const chain = ci < 0 ? t.replace(/:$/, '') : t.slice(0, ci);
  const label = ci < 0 ? '' : t.slice(ci + 2).trim();
  const parts = chain.split(ARROW);
  const out = [];
  for (let i = 0; i + 2 < parts.length; i += 2) {
    out.push({ a: parts[i], b: parts[i + 2], dashed: parts[i + 1] === '-->', label: i + 2 === parts.length - 1 ? label : '' });
  }
  return out;
}

// parseFlow(text) -> { nodes, edges, groups, dir, problems }
// A node is { k, label, strong }, with store: true and group: <index> only when the text
// says so: a flow written before those statements keeps its meaning, and its version.
export function parseFlow(text) {
  const nodes = new Map();
  const edges = [];
  const groups = [];
  const problems = [];
  let dir = 'down';
  const box = (raw, line) => {
    const { s, strong } = boxName(raw);
    if (!s) { problems.push({ line, msg: 'a flow line has an empty box name' }); return null; }
    let n = nodes.get(s);
    if (!n) { n = { k: nodes.size, label: s, strong: false }; nodes.set(s, n); }
    if (strong) n.strong = true;
    return n;
  };
  const names = (list, line) => list.split(',').filter((x) => x.trim()).map((x) => box(x, line)).filter(Boolean);
  String(text).split('\n').forEach((raw, line) => {
    const t = raw.trim();
    if (!t || t.startsWith('%%') || t.startsWith('//')) return;
    const d = t.match(/^direction:\s*(down|right)$/i);
    if (d) { dir = d[1].toLowerCase(); return; }
    const hs = hops(t);
    if (!hs) {
      // group Name: a, b    one frame around these boxes
      const gm = t.match(/^group\s+([^:]+?)\s*:\s*(.*)$/i);
      if (gm) {
        const gi = groups.length;
        const own = [];
        for (const nd of names(gm[2], line)) {
          if (nd.group !== undefined && nd.group !== gi) { problems.push({ line, msg: `"${nd.label}" is in two groups; a box belongs to one group` }); continue; }
          nd.group = gi;
          if (!own.includes(nd.k)) own.push(nd.k);
        }
        if (!own.length) { problems.push({ line, msg: `group "${gm[1]}" names no box; write: group ${gm[1]}: a, b` }); return; }
        groups.push({ label: gm[1].trim(), members: own });
        return;
      }
      // store: a, b    these boxes hold data: drawn as a cylinder
      const sm = t.match(/^store\s*:\s*(.+)$/i);
      if (sm) { names(sm[1], line).forEach((nd) => { nd.store = true; }); return; }
      box(t, line);
      return;
    }
    for (const h of hs) {
      const a = box(h.a, line);
      const b = box(h.b, line);
      if (!a || !b) continue;
      if (a === b) { problems.push({ line, msg: `"${a.label}" points to itself` }); continue; }
      const prev = edges.find((e) => e.a === a.k && e.b === b.k);
      if (prev) { if (h.label && !prev.label) prev.label = h.label; continue; }
      edges.push({ a: a.k, b: b.k, dashed: h.dashed, label: h.label });
    }
  });
  return { nodes: [...nodes.values()], edges, groups, dir, problems };
}

// ---------- flow: layout ----------

const RY = 4;            // the lid of a store, drawn as a cylinder
const FRAME_PAD = 10;    // room between a group's frame and its boxes
const FRAME_LABEL = 16;  // the group's name, inside the top edge of its frame
const CLEAR = 8;         // between a frame and anything outside it
const TRACK = 10;        // one run across the gap between two ranks
const CORNER = 4;        // the radius of a bend
const LANE = 12;         // between two return loops on the far side

// A box name in lines of at most `max` columns; three lines at most, and `cut` says when it was cut.
function wrapBox(label, max = 22) {
  const out = [];
  let cur = '';
  for (const w of String(label).split(/\s+/)) {
    if (!cur) cur = w;
    else if (cols(cur) + 1 + cols(w) <= max) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  const cut = out.length > 3;
  if (cut) { out.length = 3; out[2] += '…'; }
  return { lines: out, cut };
}

// How wide a box's text is: its widest line, or its last line and the numerals after it.
function lineWidth(lines, pins) {
  const w = Math.max(...lines.map(cols)) * CH;
  return pins ? Math.max(w, cols(lines[lines.length - 1]) * CH + PIN_SEP + pinsW(pins)) : w;
}

// Pool adjacent violators: place items in order, each at least `gap` after the
// previous one, as close as possible (least squares) to its wanted start.
function packLine(want, size, gap) {
  const n = want.length;
  const off = [];
  let acc = 0;
  for (let i = 0; i < n; i++) { off.push(acc); acc += size[i] + gap[i]; }
  const blocks = [];
  for (let i = 0; i < n; i++) {
    blocks.push({ sum: want[i] - off[i], n: 1, first: i });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      a.sum += b.sum; a.n += b.n; blocks.pop();
    }
  }
  const out = new Array(n);
  for (const b of blocks) for (let i = b.first; i < b.first + b.n; i++) out[i] = b.sum / b.n + off[i];
  return out;
}

// ---- geometry, in page coordinates: rectangles { x0, y0, x1, y1 } and segments [[x, y], [x, y]] ----

const meets = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const inside = (a, b) => a.x0 >= b.x0 - 0.5 && a.x1 <= b.x1 + 0.5 && a.y0 >= b.y0 - 0.5 && a.y1 <= b.y1 + 0.5;
const grow = (r, m) => ({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m });
// Does the segment cross the open rectangle? (Liang-Barsky clipping.)
function segHits([[ax, ay], [bx, by]], r) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (const [p, q] of [[-dx, ax - r.x0], [dx, r.x1 - ax], [-dy, ay - r.y0], [dy, r.y1 - ay]]) {
    if (p === 0) { if (q <= 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t0) t0 = t; } else if (t < t1) t1 = t;
    if (t0 >= t1) return false;
  }
  return true;
}
// The rectangle a label's text takes. Text is 12px mono, centered on its y.
export function textBox(l, margin = 0) {
  // pad: the numerals after the text, when a card is pinned on what it names.
  const tw = cols(l.text) * CH + (l.pad || 0);
  const x = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - tw : l.x - tw / 2;
  return { x0: x - margin, x1: x + tw + margin, y0: l.y - 7 - margin, y1: l.y + 7 + margin };
}
const boxRect = (b) => ({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
const frameRect = (f) => ({ x0: f.x, y0: f.y, x1: f.x + f.w, y1: f.y + f.h });
const frameSegs = (f) => {
  const r = frameRect(f);
  return [[[r.x0, r.y0], [r.x1, r.y0]], [[r.x1, r.y0], [r.x1, r.y1]], [[r.x1, r.y1], [r.x0, r.y1]], [[r.x0, r.y1], [r.x0, r.y0]]];
};
const segsOf = (xy) => xy.slice(1).map((q, x) => [xy[x], q]);

// Drop repeated points and points in the middle of a straight run.
function simplify(pts) {
  const out = [];
  for (const q of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - q[0]) < 0.01 && Math.abs(last[1] - q[1]) < 0.01) continue;
    out.push(q);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const col = (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(b[0] - c[0]) < 0.01) || (Math.abs(a[1] - b[1]) < 0.01 && Math.abs(b[1] - c[1]) < 0.01);
      if (!col) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

const fmt = ([x, y]) => `${round(x)},${round(y)}`;
const round = (v) => Math.round(v * 10) / 10;

// A path through right angles, each bend rounded, with an open arrowhead at its end.
function routePath(xy, head = true) {
  let d = `M${fmt(xy[0])}`;
  for (let i = 1; i < xy.length - 1; i++) {
    const [p, q, s] = [xy[i - 1], xy[i], xy[i + 1]];
    const lin = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const lout = Math.hypot(s[0] - q[0], s[1] - q[1]);
    const r = Math.min(CORNER, lin / 2, lout / 2);
    const a = [q[0] - ((q[0] - p[0]) / lin) * r, q[1] - ((q[1] - p[1]) / lin) * r];
    const b = [q[0] + ((s[0] - q[0]) / lout) * r, q[1] + ((s[1] - q[1]) / lout) * r];
    d += ` L${fmt(a)} Q${fmt(q)} ${fmt(b)}`;
  }
  const end = xy[xy.length - 1];
  d += ` L${fmt(end)}`;
  if (head && xy.length > 1) d += arrowHead(xy[xy.length - 2], end);
  return d;
}
function arrowHead(from, tip) {
  const len = Math.hypot(tip[0] - from[0], tip[1] - from[1]) || 1;
  const u = [(tip[0] - from[0]) / len, (tip[1] - from[1]) / len];
  const v = [-u[1], u[0]];
  const at = (k, m) => [tip[0] - u[0] * k + v[0] * m, tip[1] - u[1] * k + v[1] * m];
  return ` M${fmt(at(6, 4))} L${fmt(tip)} L${fmt(at(6, -4))}`;
}
// The end of a class diagram's line at a box: its mark, and how wide its count is.
function portEnd(e, end) {
  return e.ends ? { mark: !!e.ends[end], count: e.counts[end] ? cols(e.counts[end]) * CH : 0 } : {};
}
// How far apart the lines at one side of a box stand. A diamond or a triangle is wider than
// a line, and a count stands beside its line: then they stand far enough apart for it.
// Running down, a count stands beside its line and takes its width; running right, it
// stands over or under its line and takes a line of text.
function portStep(list, down) {
  const count = Math.max(0, ...list.map((o) => o.count || 0));
  return Math.max(list.some((o) => o.mark) ? 20 : 14, count ? (down ? count + 22 : 36) : 0);
}
// How far the outermost line stands in from the box's corner: a count beside it stays over the box.
function portEdge(list, down) {
  const count = Math.max(0, ...list.map((o) => o.count || 0));
  return count ? (down ? count + 14 : 28) : 8;
}
// The marks at the end of a class diagram's line, with the tip on the box: a hollow
// triangle (is a kind of), a filled diamond (owns), a hollow diamond (holds).
const MARKS = ['tri', 'dia', 'odia'];
const MARK_STEM = 16; // the longest mark, and a little line before the first bend
function markPts(kind, from, tip) {
  const len = Math.hypot(tip[0] - from[0], tip[1] - from[1]) || 1;
  const u = [(tip[0] - from[0]) / len, (tip[1] - from[1]) / len];
  const v = [-u[1], u[0]];
  const at = (k, m) => [tip[0] - u[0] * k + v[0] * m, tip[1] - u[1] * k + v[1] * m];
  return kind === 'tri' ? [tip, at(10, 6), at(10, -6)] : [tip, at(6, 4), at(12, 0), at(6, -4)];
}
const markPath = (pts) => `M${pts.map(fmt).join(' L')} Z`;
// How far a count stands from its line: clear of the half width of the mark at that end.
const COUNT_OFF = { tri: 11, dia: 9, odia: 9 };

// A group's frame keeps room for its name beside its first box only where the name would
// land on a line: a frame that grows for nothing makes the whole drawing wider. So the
// layout runs once as it is, and again, with that room, for the groups whose name a line
// crosses. The second one stands when it clears more names and grows by about the names.
export function layoutFlow(g) {
  const L = layoutPass(g, null);
  if (L.dir !== 'down' || !L.frames.length) return L;
  const hits = (lay) => new Set(lay.frames.filter((f) => nameHit(f, lay)).map((f) => f.gi));
  const hit = hits(L);
  if (!hit.size) return L;
  const L2 = layoutPass(g, hit);
  const room = [...hit].reduce((w, gi) => w + nameWidth(g.groups[gi]) + 14, 0) + 24;
  // It may grow by up to twice the room of the names, and never past a card's width when it fit one.
  const fits = L.width > FIG_MAX || L2.width <= FIG_MAX;
  return !L2.tangled && hits(L2).size < hit.size && L2.width - L.width <= 2 * room && fits ? L2 : L;
}
const nameWidth = (gr) => cols(gr.label) * CH + (gr.pins ? PIN_SEP + pinsW(gr.pins) : 0);
// Does a line cross the name of this frame, or the numerals of the cards pinned on its group?
function nameHit(f, L) {
  const rs = [textBox(f.text, 1)];
  if (f.pinAt) rs.push({ x0: f.pinAt.x - 1, x1: f.pinAt.x + pinsW(f.pins) + 1, y0: f.pinAt.y - PIN_H / 2, y1: f.pinAt.y + PIN_H / 2 });
  return L.edges.some((ed) => segsOf(ed.xy).some((sg) => rs.some((r) => segHits(sg, r))));
}

// room: the groups whose frame keeps room for its name (layoutFlow).
function layoutPass(g, room) {
  const down = g.dir !== 'right';
  const n = g.nodes.length;
  const groups = g.groups || [];
  const els = g.nodes.map((nd) => {
    if (nd.cls) {
      const { w, h } = classSize(nd);
      // A count stands beside its line. A box long enough, across the ranks, for the counted
      // lines that leave it and for those that come in has a place for each count between them.
      const room = (end) => {
        const list = g.edges.filter((e) => e[end] === nd.k).map((e) => portEnd(e, end));
        return list.length ? portStep(list, down) * (list.length - 1) + 2 * portEdge(list, down) : 0;
      };
      const across = Math.max(room('a'), room('b'));
      return { real: true, k: nd.k, node: nd, lines: [nd.label], cut: false, w: down ? Math.max(w, across) : w, h: down ? h : Math.max(h, across), rank: 0, pred: [], succ: [], group: nd.group ?? -1 };
    }
    const { lines, cut } = wrapBox(nd.label);
    const w = Math.max(48, Math.ceil(lineWidth(lines, nd.pins)) + 2 * PAD_X);
    const h = lines.length * LH + 2 * PAD_Y + (nd.store ? 2 * RY : 0);
    return { real: true, k: nd.k, node: nd, lines, cut, w, h, rank: 0, pred: [], succ: [], group: nd.group ?? -1 };
  });

  // 1. Break cycles: an edge back to a box still on the DFS stack is drawn as a return loop.
  const out = Array.from({ length: n }, () => []);
  g.edges.forEach((e, i) => out[e.a].push(i));
  const state = new Array(n).fill(0);
  const back = new Set();
  const dfs = (v) => {
    state[v] = 1;
    for (const i of out[v]) {
      const w = g.edges[i].b;
      if (state[w] === 1) back.add(i);
      else if (state[w] === 0) dfs(w);
    }
    state[v] = 2;
  };
  for (let v = 0; v < n; v++) if (!state[v]) dfs(v);
  const fwd = g.edges.map((e, i) => i).filter((i) => !back.has(i));

  // 2. Rank by longest path; then pull each source down next to its first child.
  const indeg = new Array(n).fill(0);
  fwd.forEach((i) => indeg[g.edges[i].b]++);
  const queue = [];
  for (let v = 0; v < n; v++) if (!indeg[v]) queue.push(v);
  const topo = [];
  while (queue.length) {
    const v = queue.shift();
    topo.push(v);
    for (const i of out[v]) {
      if (back.has(i)) continue;
      const w = g.edges[i].b;
      els[w].rank = Math.max(els[w].rank, els[v].rank + 1);
      if (--indeg[w] === 0) queue.push(w);
    }
  }
  for (const v of topo) {
    const kids = out[v].filter((i) => !back.has(i)).map((i) => els[g.edges[i].b].rank);
    const hasPred = fwd.some((i) => g.edges[i].b === v);
    if (!hasPred && kids.length) els[v].rank = Math.max(0, Math.min(...kids) - 1);
  }

  // 3. Long edges get one invisible joint per rank they cross.
  const chains = new Map(); // edge index -> [element indices from a to b]
  for (const i of fwd) {
    const e = g.edges[i];
    let prev = e.a;
    const chain = [e.a];
    for (let r = els[e.a].rank + 1; r < els[e.b].rank; r++) {
      const j = els.length;
      els.push({ real: false, w: 0, h: 0, rank: r, pred: [], succ: [], group: -1 });
      els[prev].succ.push(j); els[j].pred.push(prev);
      chain.push(j);
      prev = j;
    }
    els[prev].succ.push(e.b); els[e.b].pred.push(prev);
    chain.push(e.b);
    chains.set(i, chain);
  }

  // 4. Order each rank by barycenter sweeps; keep the order with the fewest crossings.
  //    The boxes of one group stay next to each other in every rank.
  const R = Math.max(0, ...els.map((e) => e.rank)) + 1;
  // Groups keep one order, left to right, in every rank: two frames that swapped sides
  // between ranks could never both hold their boxes. The order is where they first stand.
  const gpos = new Map();
  {
    const at = new Map();
    els.forEach((e) => { if (e.real && e.group >= 0) { const l = at.get(e.rank) || 0; at.set(e.rank, l + 1); } });
    const seen = new Map();
    els.forEach((e, j) => {
      if (!e.real || e.group < 0) return;
      const a = gpos.get(e.group) || [0, 0];
      const x = seen.get(e.rank) || 0;
      seen.set(e.rank, x + 1);
      a[0] += x / at.get(e.rank); a[1]++;
      gpos.set(e.group, a);
    });
  }
  const gorder = [...gpos.keys()].sort((a, b) => gpos.get(a)[0] / gpos.get(a)[1] - gpos.get(b)[0] / gpos.get(b)[1] || a - b);
  const gatherBlocks = (sorted) => {
    const blocks = [];
    sorted.forEach((j) => { const gi = els[j].group; if (gi >= 0 && !blocks.includes(gi)) blocks.push(gi); });
    const want = blocks.slice().sort((a, b) => gorder.indexOf(a) - gorder.indexOf(b));
    if (want.every((g, k) => g === blocks[k])) return sorted;
    const members = new Map(blocks.map((g) => [g, sorted.filter((j) => els[j].group === g)]));
    const out = [];
    const used = new Set();
    let k = 0;
    for (const j of sorted) {
      const gi = els[j].group;
      if (gi < 0) { out.push(j); continue; }
      if (used.has(gi)) continue;
      used.add(gi);
      out.push(...members.get(want[k++]));
    }
    return out;
  };
  const gather = (layer, key) => {
    const sum = new Map();
    layer.forEach((j) => {
      const gi = els[j].group;
      if (gi < 0) return;
      const a = sum.get(gi) || [0, 0];
      a[0] += key(j); a[1]++;
      sum.set(gi, a);
    });
    const k1 = (j) => (els[j].group >= 0 ? sum.get(els[j].group)[0] / sum.get(els[j].group)[1] : key(j));
    return gatherBlocks(layer.slice().sort((p, q) => k1(p) - k1(q) || els[p].group - els[q].group || key(p) - key(q)));
  };
  let layers = Array.from({ length: R }, () => []);
  els.forEach((e, j) => layers[e.rank].push(j));
  layers = layers.map((l) => gather(l, (j) => l.indexOf(j)));
  const crossings = (L) => {
    const pos = new Map();
    L.forEach((layer) => layer.forEach((j, x) => pos.set(j, x)));
    let c = 0;
    for (let r = 0; r + 1 < L.length; r++) {
      const pairs = [];
      L[r].forEach((j) => els[j].succ.forEach((s) => pairs.push([pos.get(j), pos.get(s)])));
      for (let x = 0; x < pairs.length; x++) {
        for (let y = x + 1; y < pairs.length; y++) {
          if ((pairs[x][0] - pairs[y][0]) * (pairs[x][1] - pairs[y][1]) < 0) c++;
        }
      }
    }
    return c;
  };
  const sweep = (L, downward) => {
    const next = L.map((l) => l.slice());
    const rs = downward ? [...Array(R).keys()].slice(1) : [...Array(R).keys()].reverse().slice(1);
    for (const r of rs) {
      const ref = next[downward ? r - 1 : r + 1];
      const pos = new Map(ref.map((j, x) => [j, x]));
      const bary = new Map(next[r].map((j, x) => {
        const nb = (downward ? els[j].pred : els[j].succ).filter((q) => pos.has(q));
        return [j, nb.length ? nb.reduce((s, q) => s + pos.get(q), 0) / nb.length : x];
      }));
      next[r] = gather(next[r], (j) => bary.get(j));
    }
    return next;
  };
  let best = layers;
  let bestC = crossings(layers);
  for (let it = 0; it < 4 && bestC > 0; it++) {
    layers = sweep(sweep(layers, true), false);
    const c = crossings(layers);
    if (c < bestC) { best = layers; bestC = c; }
  }
  layers = best;

  // 5. Across the ranks (s: x when down, y when right): each box near the mean of its neighbours.
  const sizeS = (e) => (down ? e.w : e.h);
  const sizeP = (e) => (down ? e.h : e.w);
  const gapAfter = (j, next) => (next === undefined ? 0 : els[j].real && els[next].real ? (down ? 20 : 14) : 10);
  layers.forEach((l) => {
    let s = 0;
    l.forEach((j, x) => { els[j].s = s + sizeS(els[j]) / 2; s += sizeS(els[j]) + gapAfter(j, l[x + 1]); });
  });
  const place = (r, nbOf) => {
    const l = layers[r];
    const want = l.map((j) => {
      const nb = nbOf(els[j]);
      const c = nb.length ? nb.reduce((t, q) => t + els[q].s, 0) / nb.length : els[j].s;
      return c - sizeS(els[j]) / 2;
    });
    const starts = packLine(want, l.map((j) => sizeS(els[j])), l.map((j, x) => gapAfter(j, l[x + 1])));
    l.forEach((j, x) => { els[j].s = starts[x] + sizeS(els[j]) / 2; });
  };
  for (let r = 1; r < R; r++) place(r, (e) => e.pred);
  for (let r = R - 2; r >= 0; r--) place(r, (e) => e.succ);
  for (let r = 1; r < R; r++) place(r, (e) => e.pred);

  // A group's frame is a band across the ranks it spans. What is not in the group (a box, or
  // the joint of a line that passes) moves out of the band, with everything beyond it in its
  // rank; two bands over the same ranks move apart. The frame's name sits inside its top edge,
  // which lies across the ranks only when they run left to right.
  const lo = (e) => e.s - sizeS(e) / 2;
  const hi = (e) => e.s + sizeS(e) / 2;
  const padLo = down ? FRAME_PAD : FRAME_PAD + FRAME_LABEL;
  const bands = () => groups.map((gr, gi) => {
    const ms = els.filter((e) => e.real && e.group === gi);
    if (!ms.length) return null;
    const r0 = Math.min(...ms.map((e) => e.rank));
    let s0 = Math.min(...ms.map(lo)) - padLo;
    // Running down, every line into the group's first rank comes down through the strip that
    // holds the name. The name lies left of the first box of that rank, where none comes down.
    if (down && room && room.has(gi)) s0 = Math.min(s0, Math.min(...ms.filter((e) => e.rank === r0).map(lo)) - 6 - nameWidth(gr) - 8);
    return { gi, s0, s1: Math.max(...ms.map(hi)) + FRAME_PAD, r0, r1: Math.max(...ms.map((e) => e.rank)) };
  }).filter(Boolean);
  const shiftRank = (r, from, sign, d) => layers[r].forEach((j) => { if (sign < 0 ? els[j].s <= from : els[j].s >= from) els[j].s += sign * d; });
  // Keep a rank in order with its gaps, pushing to the right where two meet.
  const tidy = (r) => {
    const l = layers[r];
    for (let x = 1; x < l.length; x++) {
      const need = hi(els[l[x - 1]]) + gapAfter(l[x - 1], l[x]) - lo(els[l[x]]);
      if (need > 0) for (let y = x; y < l.length; y++) els[l[y]].s += need;
    }
  };
  // The loop must settle. Where it cannot (frames whose boxes cross each other's ranks), the
  // places before it come back, and the check says why the frames cut boxes.
  const before = els.map((e) => e.s);
  const extent = () => Math.max(...els.map(hi)) - Math.min(...els.map(lo));
  const limit = 4 * extent() + 400;
  let settled = !groups.length;
  for (let it = 0; it < 60 && groups.length; it++) {
    const B = bands();
    let moved = false;
    for (const b of B) {
      for (let r = b.r0; r <= b.r1 && !moved; r++) {
        for (const j of layers[r]) {
          const e = els[j];
          if (e.real && e.group === b.gi) continue;
          // (Half a pixel of slack: a box pushed to exactly CLEAR from the band is clear.)
          if (hi(e) + CLEAR <= b.s0 + 0.5 || lo(e) - CLEAR >= b.s1 - 0.5) continue;
          // It leaves on its own side of the group's boxes in this rank, so no box of the
          // group moves with it; a joint between them is taken out past them.
          const own = layers[r].map((q, x) => (els[q].real && els[q].group === b.gi ? x : -1)).filter((x) => x >= 0);
          const at = layers[r].indexOf(j);
          if (own.length && at > own[0] && at < own[own.length - 1]) {
            layers[r].splice(at, 1);
            const last = layers[r].map((q) => els[q].real && els[q].group === b.gi).lastIndexOf(true);
            layers[r].splice(last + 1, 0, j);
            e.s = b.s1 + CLEAR + sizeS(e) / 2;
            tidy(r);
          } else if (own.length ? at < own[0] : e.s < (b.s0 + b.s1) / 2) shiftRank(r, e.s, -1, hi(e) + CLEAR - b.s0);
          else shiftRank(r, e.s, 1, b.s1 - (lo(e) - CLEAR));
          moved = true;
          break;
        }
      }
      if (moved) break;
    }
    if (!moved) {
      for (const a of B) {
        for (const b of B) {
          if (moved || a === b || a.r1 < b.r0 || b.r1 < a.r0 || a.s0 + a.s1 > b.s0 + b.s1) continue;
          if (a.s1 + CLEAR <= b.s0 + 0.5) continue;
          const d = a.s1 + CLEAR - b.s0;
          for (let r = b.r0; r <= b.r1; r++) {
            const own = layers[r].filter((j) => els[j].real && els[j].group === b.gi).map((j) => els[j].s);
            shiftRank(r, own.length ? Math.min(...own) : b.s0, 1, d);
          }
          moved = true;
        }
      }
    }
    if (!moved) { settled = true; break; }
    if (extent() > limit) break;
  }
  if (!settled) els.forEach((e, j) => { e.s = before[j]; });
  const minS = Math.min(...els.map(lo), ...bands().map((b) => b.s0));
  els.forEach((e) => { e.s -= minS; });
  const B = bands();
  const maxS = Math.max(...els.map(hi), ...B.map((b) => b.s1));

  // 6. Routes, at right angles. An arrow leaves its first box on the far side and enters its
  //    last box on the near side, at ports spread along the side in the order of where the
  //    other end lies. Where the two ends do not line up, the arrow crosses the gap between
  //    their ranks on a track of its own. A return loop goes out to a lane beyond the far side
  //    of the drawing, through the gap after its first box and the gap before its last.
  const outPorts = new Map();
  const inPorts = new Map();
  const addPort = (map, j, port) => (map.get(j) || map.set(j, []).get(j)).push(port);
  const routes = [];
  for (const i of fwd) {
    const ch = chains.get(i);
    const e = g.edges[i];
    const rt = { i, ch, o: { toward: els[ch[1]].s, ...portEnd(e, 'a') }, t: { toward: els[ch[ch.length - 2]].s, ...portEnd(e, 'b') } };
    addPort(outPorts, ch[0], rt.o); addPort(inPorts, ch[ch.length - 1], rt.t);
    routes.push(rt);
  }
  [...back].sort((x, y) => x - y).forEach((i, k) => {
    const e = g.edges[i];
    const rt = { i, back: true, o: { toward: 1e9 + k, ...portEnd(e, 'a') }, t: { toward: 1e9 + k, ...portEnd(e, 'b') } };
    addPort(outPorts, e.a, rt.o); addPort(inPorts, e.b, rt.t);
    routes.push(rt);
  });
  const spread = (j, list) => {
    const sorted = list.slice().sort((a, b) => a.toward - b.toward);
    const step = portStep(sorted, down);
    const counted = sorted.some((o) => o.count);
    const span = Math.min(counted ? sizeS(els[j]) - 2 * portEdge(sorted, down) : sizeS(els[j]) * (step > 14 ? 0.8 : 0.6), step * (sorted.length - 1));
    sorted.forEach((o, x) => { o.s = els[j].s + (sorted.length > 1 ? -span / 2 + (span * x) / (sorted.length - 1) : 0); });
  };
  outPorts.forEach((l, j) => spread(j, l));
  inPorts.forEach((l, j) => spread(j, l));

  // Runs across a gap: gap r lies between rank r and r + 1; -1 before the first, R - 1 after the last.
  const gapJogs = new Map();
  const addJog = (r, jog) => { (gapJogs.get(r) || gapJogs.set(r, []).get(r)).push(jog); return jog; };
  let lane = maxS + 18;
  for (const rt of routes) {
    if (!rt.back) {
      rt.ss = rt.ch.map((j, x) => (x === 0 ? rt.o.s : x === rt.ch.length - 1 ? rt.t.s : els[j].s));
      rt.jogs = rt.ss.slice(1).map((s1, x) => {
        const s0 = rt.ss[x];
        if (Math.abs(s0 - s1) < 0.5) return null;
        // `top`: where a line comes in from the near side; `bot`: where it goes on.
        return addJog(els[rt.ch[x]].rank, { top: [s0], bot: [s1], lo: Math.min(s0, s1), hi: Math.max(s0, s1) });
      });
    } else {
      const e = g.edges[rt.i];
      rt.lane = lane;
      lane += LANE;
      rt.j1 = addJog(els[e.a].rank, { top: [rt.o.s, rt.lane], bot: [], lo: rt.o.s, hi: rt.lane });
      rt.j2 = addJog(els[e.b].rank - 1, { top: [], bot: [rt.lane, rt.t.s], lo: rt.t.s, hi: rt.lane });
    }
  }
  // Tracks in a gap. A run whose line comes in from the near side inside another run's span
  // should lie nearer than that run, and one whose line goes on inside it farther: else the
  // lines cross. A line that comes in beside where another goes on (less than 4px apart)
  // must lie nearer: else the two run side by side and read as one. The musts are kept
  // first; a cycle of shoulds is a crossing that no order avoids. Each run then takes the
  // nearest track below those it must or should lie under, where no run it overlaps lies.
  const tracks = new Map();
  gapJogs.forEach((list, r) => {
    const within = (v, J) => v > J.lo + 0.5 && v < J.hi - 0.5;
    const beside = (u, v) => Math.abs(u - v) < 4;
    const must = list.map(() => new Set());
    const should = list.map(() => new Set());
    list.forEach((A, a) => list.forEach((Bj, b) => {
      if (a === b) return;
      if (A.top.some((u) => Bj.bot.some((v) => beside(u, v)))) must[a].add(b);
      if (A.top.some((v) => within(v, Bj))) should[a].add(b);
      if (A.bot.some((v) => within(v, Bj))) should[b].add(a);
    }));
    const waitMust = list.map(() => 0);
    const waitShould = list.map(() => 0);
    must.forEach((set) => set.forEach((b) => waitMust[b]++));
    should.forEach((set) => set.forEach((b) => waitShould[b]++));
    const order = [];
    const done = new Set();
    while (order.length < list.length) {
      let pick = -1;
      list.forEach((_, a) => {
        if (done.has(a)) return;
        if (pick < 0 || waitMust[a] < waitMust[pick] || (waitMust[a] === waitMust[pick] && waitShould[a] < waitShould[pick])) pick = a;
      });
      done.add(pick);
      order.push(pick);
      must[pick].forEach((b) => waitMust[b]--);
      should[pick].forEach((b) => waitShould[b]--);
    }
    const level = new Map();
    for (const a of order) {
      let t = 0;
      level.forEach((lv, b) => { if (must[b].has(a) || should[b].has(a)) t = Math.max(t, lv + 1); });
      const clash = (tt) => [...level].some(([b, lv]) => lv === tt && list[a].lo - 6 < list[b].hi && list[b].lo - 6 < list[a].hi);
      while (clash(t)) t++;
      level.set(a, t);
      list[a].track = t;
    }
    tracks.set(r, Math.max(...level.values()) + 1);
  });

  // 7. Along the ranks (p: y when down, x when right). Each gap holds, in order: the frames that
  //    end above it, a band for the labels of arrows that leave the rank, its tracks, and the
  //    frames that start below it.
  const thick = layers.map((l) => Math.max(0, ...l.map((j) => sizeP(els[j]))));
  // The band holds one row of labels, or more when several labelled arrows leave one box:
  // rows of text when the ranks run down, columns of it when they run right.
  const labelUnit = new Map();
  const labelRows = new Map();
  const leaving = new Map();
  for (const rt of routes) {
    const e = g.edges[rt.i];
    if (rt.back || !e.label) continue;
    const r = els[e.a].rank;
    labelUnit.set(r, Math.max(labelUnit.get(r) || 0, down ? LH : Math.ceil(cols(e.label) * CH) + 12));
    leaving.set(e.a, (leaving.get(e.a) || 0) + 1);
    labelRows.set(r, Math.min(3, Math.max(labelRows.get(r) || 0, leaving.get(e.a))));
  }
  const labelBand = new Map([...labelUnit].map(([r, u]) => [r, u * labelRows.get(r)]));
  const padAfter = new Map();
  const padBefore = new Map();
  for (const b of B) {
    padAfter.set(b.r1, FRAME_PAD);
    padBefore.set(b.r0, FRAME_PAD + (down ? FRAME_LABEL : 0));
  }
  // The ends of a class diagram's lines. A marker (a triangle, a diamond) or a count beside
  // its box needs a straight stem before the line may bend: room after the rank a line
  // leaves, and before the rank it enters.
  const endAfter = new Map();
  const endBefore = new Map();
  const stem = (mark, count) => Math.max(mark ? MARK_STEM : 0, count ? (down ? LH + 6 : Math.ceil(cols(count) * CH) + 14) : 0);
  for (const rt of routes) {
    const e = g.edges[rt.i];
    if (!e.ends) continue;
    const ra = els[e.a].rank;
    const rb = els[e.b].rank;
    endAfter.set(ra, Math.max(endAfter.get(ra) || 0, stem(e.ends.a, e.counts.a)));
    endBefore.set(rb, Math.max(endBefore.get(rb) || 0, stem(e.ends.b, e.counts.b)));
  }
  const parts = (r) => {
    const a = padAfter.get(r) || 0;
    const ea = endAfter.get(r) || 0;
    const lab = labelBand.get(r) ? labelBand.get(r) + 8 : 0;
    const t = tracks.get(r) ? tracks.get(r) * TRACK + 8 : 0;
    const eb = endBefore.get(r + 1) || 0;
    const b = padBefore.get(r + 1) || 0;
    return { a, ea, lab, t, eb, b };
  };
  const gapSize = (r) => {
    const q = parts(r);
    const need = q.a + q.ea + q.lab + q.t + q.eb + q.b;
    if (r < 0 || r >= R - 1) return need + (q.t ? 4 : 0);
    return Math.max(down ? 30 : 40, need + 8);
  };
  const G = new Map();
  const P = [];
  let cur = 0;
  for (let r = -1; r < R; r++) {
    if (r >= 0) { P.push(cur); cur += thick[r]; }
    const gz = gapSize(r);
    G.set(r, [cur, cur + gz]);
    cur += gz;
  }
  els.forEach((e) => { e.p = P[e.rank] + thick[e.rank] / 2; });
  const near = (e) => e.p - sizeP(e) / 2;
  const far = (e) => e.p + sizeP(e) / 2;
  const trackAt = (r, t) => {
    const [g0, g1] = G.get(r);
    const q = parts(r);
    const top = g0 + q.a + q.ea + q.lab;
    const room = g1 - q.b - q.eb - top;
    const used = (tracks.get(r) || 0) * TRACK;
    return top + Math.max(4, (room - used) / 2) + t * TRACK + TRACK / 2;
  };
  const labelAt = (r, row) => G.get(r)[0] + (padAfter.get(r) || 0) + (endAfter.get(r) || 0) + 4 + (labelUnit.get(r) || 0) * (row + 0.5);

  const pt = (s, p) => (down ? [s, p] : [p, s]);
  const edges = routes.map((rt) => {
    const e = g.edges[rt.i];
    let sp;
    if (!rt.back) {
      const a = els[rt.ch[0]];
      const b = els[rt.ch[rt.ch.length - 1]];
      sp = [[rt.ss[0], far(a)]];
      rt.jogs.forEach((jog, x) => {
        if (!jog) return;
        const y = trackAt(els[rt.ch[x]].rank, jog.track);
        sp.push([rt.ss[x], y], [rt.ss[x + 1], y]);
      });
      sp.push([rt.ss[rt.ss.length - 1], near(b)]);
    } else {
      const a = els[e.a];
      const b = els[e.b];
      const y1 = trackAt(a.rank, rt.j1.track);
      const y2 = trackAt(b.rank - 1, rt.j2.track);
      sp = [[rt.o.s, far(a)], [rt.o.s, y1], [rt.lane, y1], [rt.lane, y2], [rt.t.s, y2], [rt.t.s, near(b)]];
    }
    sp = simplify(sp);
    return { a: e.a, b: e.b, dashed: e.dashed, back: !!rt.back, text: e.label, sp, xy: sp.map((q) => pt(...q)), label: null, lane: rt.lane,
      ends: e.ends || null, counts: [] };
  });

  // Boxes and frames, in page coordinates.
  const boxes = els.filter((e) => e.real).map((e) => {
    const [x, y] = pt(e.s - sizeS(e) / 2, e.p - sizeP(e) / 2);
    return { k: e.k, label: e.node.label, strong: e.node.strong, store: !!e.node.store, cls: e.node.cls ? e.node : null, cut: e.cut, lines: e.lines, pins: e.node.pins || null, x, y, w: e.w, h: e.h };
  });
  const frames = B.map((b) => {
    const ms = els.filter((e) => e.real && e.group === b.gi);
    const p0 = Math.min(...ms.map(near)) - (down ? FRAME_PAD + FRAME_LABEL : FRAME_PAD);
    const p1 = Math.max(...ms.map(far)) + FRAME_PAD;
    const [xa, ya] = pt(b.s0, p0);
    const [xb, yb] = pt(b.s1, p1);
    return { gi: b.gi, label: groups[b.gi].label, pins: groups[b.gi].pins || null, x: Math.min(xa, xb), y: Math.min(ya, yb), w: Math.abs(xb - xa), h: Math.abs(yb - ya) };
  });

  // 8. Labels. A label sits beside the first run of its arrow, in the band kept for it; a
  //    return loop's label sits beside its lane. Of the places tried, it takes the one that
  //    touches the fewest lines, boxes, frames and other labels.
  const segs = edges.flatMap((ed, ei) => segsOf(ed.xy).map((sg) => ({ ei, sg })));
  const fsegs = frames.flatMap(frameSegs);
  const rects = boxes.map(boxRect);
  const placed = [];
  const costOf = (l, ei, rank) => {
    const r = textBox(l, 2);
    // A line that runs past within a few pixels does not cross the label, but reads as
    // running into it: a small cost, so a place with room around it wins when there is one.
    const near = textBox(l, 5);
    let cost = rank;
    segs.forEach(({ ei: k, sg }) => { if (segHits(sg, r)) cost += k === ei ? 60 : 30; else if (k !== ei && segHits(sg, near)) cost += 4; });
    fsegs.forEach((sg) => { if (segHits(sg, r)) cost += 15; });
    rects.forEach((q) => { if (meets(r, q)) cost += 100; });
    placed.forEach((q) => { if (meets(r, q)) cost += 100; });
    return cost;
  };
  // A return loop's label has one place, beside its lane. In a class diagram it is placed
  // first, so no other label takes that place.
  const labelOrder = edges.map((ed, ei) => ei);
  if (edges.some((ed) => ed.ends)) labelOrder.sort((x, y) => Number(edges[y].back) - Number(edges[x].back) || x - y);
  labelOrder.map((ei) => [edges[ei], ei]).forEach(([ed, ei]) => {
    if (!ed.text) return;
    const cands = [];
    if (ed.back) {
      const p1 = ed.sp[2] ? ed.sp[2][1] : ed.sp[0][1];
      const p2 = ed.sp[3] ? ed.sp[3][1] : p1;
      const pm = (p1 + p2) / 2;
      cands.push(down ? { x: ed.lane + 6, y: pm, anchor: 'start' } : { x: pm, y: ed.lane + 12, anchor: 'middle' });
      // A class diagram's loop label may also sit inside its lane, and nearer either end of it.
      if (ed.ends) {
        [pm, p1 + (p2 - p1) / 4, p2 - (p2 - p1) / 4].forEach((pv) => [1, -1].forEach((side) => cands.push(down
          ? { x: ed.lane + side * 6, y: pv, anchor: side > 0 ? 'start' : 'end' }
          : { x: pv, y: ed.lane + side * 12, anchor: 'middle' })));
      }
    } else {
      const [s0] = ed.sp[0];
      const next = ed.sp.length > 2 ? ed.sp[2][0] : s0;
      const away = next < s0 - 1 ? -1 : 1;
      const r = els[ed.a].rank;
      for (let row = 0; row < (labelRows.get(r) || 1); row++) {
        const at = labelAt(r, row);
        const place = (side, off) => cands.push(down
          ? { x: s0 + side * off, y: at, anchor: side < 0 ? 'end' : 'start' }
          : { x: at, y: s0 + side * (off + 5), anchor: 'middle' });
        // A class diagram's lines stand further apart at a box (counts, marks): more places,
        // further out, and the near places on both sides before the far ones.
        if (ed.ends) [6, 10, 16, 24, 36, 52, 72, 96].forEach((off) => [away, -away].forEach((side) => place(side, off)));
        else [away, -away].forEach((side) => [6, 10, 16, 24, 36].forEach((off) => place(side, off)));
      }
      // Where the band is crowded: along the arrow's first run across the gap, on either side of it.
      if (ed.sp.length > 2) {
        const [sa, pj] = ed.sp[1];
        const [sb] = ed.sp[2];
        const sm = (sa + sb) / 2;
        const tw = cols(ed.text) * CH;
        [-1, 1].forEach((side) => [sm, sa + Math.sign(sb - sa) * (tw / 2 + 6)].forEach((sv) => {
          cands.push(down ? { x: sv, y: pj + side * 9, anchor: 'middle' } : { x: pj + side * (tw / 2 + 6), y: sv, anchor: 'middle' });
        }));
      }
    }
    let bestL = null;
    cands.forEach((l, ci) => {
      l.text = ed.text;
      const c = costOf(l, ei, ci * 0.3);
      if (!bestL || c < bestL.c) bestL = { c, l };
    });
    ed.label = bestL.l;
    placed.push(textBox(bestL.l, 2));
  });
  // How many, at each end of a class diagram's line: beside the stem, next to its box, on
  //    whichever side touches the least.
  edges.forEach((ed, ei) => {
    if (!ed.ends) return;
    const e = g.edges[routes[ei].i];
    [['a', 0, 1], ['b', ed.sp.length - 1, -1]].forEach(([end, at, inward]) => {
      const text = e.counts[end];
      if (!text) return;
      const [s, p] = ed.sp[at];
      const tw = cols(text) * CH;
      // First the side away from the middle of the box: the gaps between its lines stay free
      // for the counts of the lines in the middle.
      const out = s >= els[end === 'a' ? e.a : e.b].s ? 1 : -1;
      const off = COUNT_OFF[e.ends[end]] || 7;
      const cands = down
        ? [out, -out].map((side) => ({ x: s + side * off, y: p + inward * 10, anchor: side > 0 ? 'start' : 'end' }))
        : [out, -out].map((side) => ({ x: p + inward * (tw / 2 + 7), y: s + side * (off + 5), anchor: 'middle' }));
      let bestL = null;
      cands.forEach((l, ci) => {
        l.text = text;
        const c = costOf(l, ei, ci * 0.3);
        if (!bestL || c < bestL.c) bestL = { c, l };
      });
      ed.counts.push(bestL.l);
      placed.push(textBox(bestL.l, 2));
    });
  });
  // A frame's name: inside its top edge, at the left, or at the right where a line crosses the left.
  frames.forEach((f) => {
    const y = f.y + FRAME_LABEL / 2 + 2;
    const cands = [{ x: f.x + 8, y, anchor: 'start' }, { x: f.x + f.w - 8, y, anchor: 'end' }];
    // Running right, the strip of the name lies above every box of the group, and lines bend
    // down through it between ranks: the name may also start or end over any of its boxes.
    if (!down) {
      for (const b of boxes) {
        if (g.nodes[b.k].group !== f.gi) continue;
        cands.push({ x: b.x, y, anchor: 'start' }, { x: b.x + b.w, y, anchor: 'end' });
      }
    }
    const cost = (r, rank) => {
      let c = rank;
      // A name that reaches past its frame belongs to no frame.
      if (r.x0 < f.x || r.x1 > f.x + f.w) c += 50;
      segs.forEach(({ sg }) => { if (segHits(sg, r)) c += 30; });
      placed.forEach((q) => { if (meets(r, q)) c += 100; });
      return c;
    };
    // Running down, the frame keeps room for the name and its numerals together (bands).
    const together = down && f.pins;
    let bestL = null;
    cands.forEach((l, ci) => {
      l.text = f.label;
      if (together) l.pad = PIN_SEP + pinsW(f.pins);
      const c = cost(textBox(l, 2), ci * 0.5);
      if (!bestL || c < bestL.c) bestL = { c, l };
    });
    f.text = bestL.l;
    placed.push(textBox(bestL.l, 2));
    // The numerals of the cards pinned on the group: after the name where they fit, else
    // where the strip of the name is free.
    if (f.pins) {
      const pw = pinsW(f.pins);
      const nb = textBox(f.text);
      const at = together ? [f.text.anchor === 'end' ? f.text.x - f.text.pad + PIN_SEP : nb.x1 - f.text.pad + PIN_SEP]
        : [nb.x1 + PIN_SEP, nb.x0 - PIN_SEP - pw, f.x + f.w - 8 - pw, f.x + 8,
          ...boxes.filter((b) => g.nodes[b.k].group === f.gi).flatMap((b) => [b.x, b.x + b.w - pw])];
      let best = null;
      at.forEach((x, ci) => {
        const r = { x0: x, x1: x + pw, y0: y - PIN_H / 2, y1: y + PIN_H / 2 };
        let c = together ? 0 : cost(grow(r, 2), ci * 0.5);
        if (!together) rects.forEach((q) => { if (meets(grow(r, 2), q)) c += 100; });
        if (!best || c < best.c) best = { c, x, r };
      });
      f.pinAt = { x: best.x, y };
      placed.push(grow(best.r, 2));
    }
  });

  // A flow's arrow has its head at the end. A class diagram's line has a mark at either end,
  // or none: an open head is part of the line, a triangle or a diamond is a shape of its own.
  edges.forEach((ed) => {
    if (!ed.ends) { ed.d = routePath(ed.xy); return; }
    const n = ed.xy.length;
    ed.d = routePath(ed.xy, ed.ends.b === 'arrow') + (ed.ends.a === 'arrow' && n > 1 ? arrowHead(ed.xy[1], ed.xy[0]) : '');
    ed.marks = [];
    for (const [kind, from, tip] of [[ed.ends.a, ed.xy[1], ed.xy[0]], [ed.ends.b, ed.xy[n - 2], ed.xy[n - 1]]]) {
      if (!MARKS.includes(kind) || n < 2) continue;
      const pts = markPts(kind, from, tip);
      ed.marks.push({ kind, pts, d: markPath(pts) });
    }
  });

  // The drawing's bounds: boxes, frames, labels, and lines.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (r) => { x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x1); y1 = Math.max(y1, r.y1); };
  boxes.forEach((b) => take(boxRect(b)));
  frames.forEach((f) => take(frameRect(f)));
  edges.forEach((ed) => {
    ed.xy.forEach(([x, y]) => take({ x0: x, y0: y, x1: x, y1: y }));
    if (ed.label) take(textBox(ed.label, 2));
    ed.counts.forEach((l) => take(textBox(l, 2)));
  });
  if (!boxes.length) take({ x0: 0, y0: 0, x1: 0, y1: 0 });
  return { x: x0, y: y0, width: Math.ceil(x1 - x0), height: Math.ceil(y1 - y0), boxes, edges, frames, dir: down ? 'down' : 'right', tangled: !settled };
}

// flowIssues(g, L) -> [{ code, msg }]: what a reader would misread in the drawing, found on
// its own geometry. Each names its subject and a change that fixes it.
export function flowIssues(g, L, room = ROOMS.card) {
  const out = [];
  const seen = new Set();
  const say = (code, key, msg) => { if (!seen.has(code + key)) { seen.add(code + key); out.push({ code, msg }); } };
  const name = (k) => g.nodes[k].label;
  const arrow = (ed) => `${name(ed.a)} -> ${name(ed.b)}`;
  const segs = L.edges.flatMap((ed) => segsOf(ed.xy).map((sg) => ({ ed, sg })));
  const labels = [
    // A line within 1px of a label's text touches it, to a reader.
    ...L.edges.filter((ed) => ed.label).map((ed) => ({ text: ed.label.text, r: textBox(ed.label, 1), what: `the label "${ed.label.text}"`, fix: 'shorten the label' })),
    ...L.edges.flatMap((ed) => (ed.counts || []).map((l) => ({ text: l.text, r: textBox(l, 1), what: `the count "${l.text}" of ${arrow(ed)}`, fix: 'shorten the count' }))),
    ...L.frames.map((f) => ({ text: f.label, r: textBox(f.text, 1), what: `the name of the group "${f.label}"`, fix: 'shorten the name of the group' })),
    ...L.frames.filter((f) => f.pinAt && !f.text.pad).map((f) => ({ r: { x0: f.pinAt.x - 1, x1: f.pinAt.x + pinsW(f.pins) + 1, y0: f.pinAt.y - PIN_H / 2, y1: f.pinAt.y + PIN_H / 2 },
      what: `the numerals on the group "${f.label}"`, fix: 'shorten the name of the group, or pin fewer cards on the group' })),
  ];
  for (const l of labels) {
    for (const { ed, sg } of segs) {
      if (segHits(sg, l.r)) say('label-on-line', l.what + arrow(ed), `${l.what} lies on the arrow ${arrow(ed)}; ${l.fix}${l.fix === 'shorten the label' ? ', or drop it where the boxes already say it' : ''}`);
    }
    for (const b of L.boxes) if (meets(l.r, boxRect(b))) say('label-on-box', l.what + b.k, `${l.what} covers the box "${b.label}"; ${l.fix}`);
  }
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (meets(labels[i].r, labels[j].r)) say('label-on-label', labels[i].what + labels[j].what, `${labels[i].what} and ${labels[j].what} overlap; shorten one of them`);
    }
  }
  for (const { ed, sg } of segs) {
    for (const b of L.boxes) {
      if (b.k === ed.a || b.k === ed.b) continue;
      if (segHits(sg, grow(boxRect(b), -1))) say('line-through-box', arrow(ed) + b.k, `the arrow ${arrow(ed)} runs through the box "${b.label}"; split the drawing, or link through that box`);
    }
  }
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i];
      const q = segs[j];
      if (p.ed === q.ed) continue;
      const [[ax, ay], [bx, by]] = p.sg;
      const [[cx, cy], [dx, dy]] = q.sg;
      const vert = Math.abs(ax - bx) < 0.5 && Math.abs(cx - dx) < 0.5 && Math.abs(ax - cx) < 1.5;
      const horz = Math.abs(ay - by) < 0.5 && Math.abs(cy - dy) < 0.5 && Math.abs(ay - cy) < 1.5;
      const span = vert ? Math.min(Math.max(ay, by), Math.max(cy, dy)) - Math.max(Math.min(ay, by), Math.min(cy, dy))
        : horz ? Math.min(Math.max(ax, bx), Math.max(cx, dx)) - Math.max(Math.min(ax, bx), Math.min(cx, dx)) : 0;
      if (span > 4) say('shared-lane', arrow(p.ed) + arrow(q.ed), `the arrows ${arrow(p.ed)} and ${arrow(q.ed)} share a run, so a reader cannot tell where each goes; split the drawing`);
    }
  }
  if (L.tangled) {
    say('groups-tangled', '', `the groups ${L.frames.map((f) => `"${f.label}"`).join(' and ')} take boxes from the same ranks in crossed order, so their frames cannot stay apart; put fewer boxes in groups, or split the drawing`);
  }
  for (const f of L.frames) {
    const fr = frameRect(f);
    for (const b of L.boxes) {
      const member = g.nodes[b.k].group === f.gi;
      if (member ? !inside(boxRect(b), fr) : meets(grow(boxRect(b), 1), fr)) {
        say('frame-cuts-box', f.gi + ':' + b.k, `the frame of the group "${f.label}" ${member ? 'cuts' : 'takes in'} the box "${b.label}"; ${member ? 'split the drawing' : 'put that box in the group, or draw the groups apart'}`);
      }
    }
  }
  if (L.width > room.max) {
    say('too-wide', '', tooWide(L.width, room, L.dir === 'right' ? 'write direction: down, or split it' : 'split it, or shorten the box names'));
  }
  for (const b of L.boxes) if (b.cut) say('box-cut', b.k, `the box "${b.label}" is cut after three lines; shorten its name`);
  return out;
}

// ---------- flow: render ----------

const CYL = (b) => {
  const rx = b.w / 2;
  return `M${round(b.x)},${round(b.y + RY)} a${round(rx)},${RY} 0 0 0 ${round(b.w)},0 a${round(rx)},${RY} 0 0 0 ${round(-b.w)},0` +
    ` v${round(b.h - 2 * RY)} a${round(rx)},${RY} 0 0 0 ${round(b.w)},0 v${round(-(b.h - 2 * RY))}`;
};
const textAt = (l, cls = '') => `<text${cls ? ` class="${cls}"` : ''} x="${round(l.x)}" y="${round(l.y)}" text-anchor="${l.anchor}" dominant-baseline="central">${esc(l.text)}</text>`;
function boxSvg(b, extraY = 0) {
  const cx = b.x + b.w / 2;
  const top = b.y + b.h / 2 - ((b.lines.length - 1) * LH) / 2 + extraY;
  const last = b.lines.length - 1;
  const text = b.lines.map((l, i) => {
    const y = top + i * LH;
    if (i !== last || !b.pins) return `<text x="${round(cx)}" y="${round(y)}" text-anchor="middle" dominant-baseline="central">${esc(l)}</text>`;
    // The last line and the numerals after it are centred as one.
    const tw = cols(l) * CH;
    const x0 = cx - (tw + PIN_SEP + pinsW(b.pins)) / 2;
    return `<text x="${round(x0)}" y="${round(y)}" text-anchor="start" dominant-baseline="central">${esc(l)}</text>` + pinSvg(b.pins, x0 + tw + PIN_SEP, y);
  }).join('');
  const shape = b.store ? `<path d="${CYL(b)}"/>` : `<rect x="${round(b.x)}" y="${round(b.y)}" width="${b.w}" height="${b.h}" rx="3"/>`;
  return `<g class="fn${b.strong ? ' strong' : ''}${b.store ? ' store' : ''}${b.pins ? ' pinned' : ''}" data-n="${b.k}" data-part="${esc(partKey(b.label))}">${shape}${text}</g>`;
}
// A frame's name, and the numerals of the cards pinned on its group.
function frameName(f) {
  const l = f.text;
  if (!f.pins) return textAt(l);
  const x = l.anchor === 'end' && l.pad ? l.x - l.pad : l.x;
  return textAt({ ...l, x }) + pinSvg(f.pins, f.pinAt.x, f.pinAt.y);
}
function svgFrame(cls, L, body, aria) {
  const W = L.width + 4;
  const H = L.height + 4;
  return `<svg class="${cls}" viewBox="${round(L.x - 2)} ${round(L.y - 2)} ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${aria}">${body}</svg>`;
}

export function flow(text, caption, label, ctx = {}) {
  const g = parseFlow(text);
  g.nodes.forEach((nd) => { nd.pins = pinsFor(ctx, nd.label); });
  g.groups.forEach((gr) => { gr.pins = pinsFor(ctx, gr.label); });
  const L = layoutFlow(g);
  const name = (k) => g.nodes[k].label;
  const T = ctx.t || en;
  const edge = (e) => (e.label
    ? T('fig_edge_label', { a: name(e.a), b: name(e.b), label: e.label })
    : T('fig_edge', { a: name(e.a), b: name(e.b) }));
  const said = g.edges.map(edge).join(T('fig_list_sep'));
  const cap = caption && (ctx.plain ? ctx.plain(caption) : caption);
  const head = cap ? T('fig_flow_named', { caption: cap }) : T('fig_flow');
  const aria = esc(T('fig_said', { head, parts: said || g.nodes.map((nd) => nd.label).join(T('fig_node_sep')) }));
  const parts = [];
  for (const f of L.frames) {
    parts.push(`<g class="fg${f.pins ? ' pinned' : ''}" data-part="${esc(partKey(f.label))}"><rect x="${round(f.x)}" y="${round(f.y)}" width="${round(f.w)}" height="${round(f.h)}" rx="6"/></g>`);
  }
  for (const e of L.edges) {
    parts.push(`<g class="fe${e.dashed ? ' dash' : ''}${e.back ? ' back' : ''}" data-a="${e.a}" data-b="${e.b}"><path d="${e.d}"/>` +
      (e.label ? textAt(e.label) : '') + '</g>');
  }
  for (const b of L.boxes) parts.push(boxSvg(b, b.store ? RY / 2 : 0));
  for (const f of L.frames) parts.push(`<g class="fg-name">${frameName(f)}</g>`);
  const svg = svgFrame('flow', L, parts.join(''), aria);
  return { html: frame('flow', svg, caption, label, ctx), width: L.width + 4 + 2 * FIG_PAD, problems: g.problems, boxes: g.nodes.length, issues: flowIssues(g, L, roomOf(ctx)) };
}

// ---------- sequence ----------
//
// Calls between parts, in time order from the top. One message per line:
//   client -> api: POST /order       a call
//   api --> client: 201 Created      dashed: a reply, or a message that does not wait
//   api -> api: check stock          a call to itself
//   *api*                            bold: the part under discussion
//   client                           a name alone fixes the order of the columns
// The compiler places every column and row.

export function parseSequence(text) {
  const parts = new Map();
  const msgs = [];
  const problems = [];
  const who = (raw, line) => {
    const { s, strong } = boxName(raw);
    if (!s) { problems.push({ line, msg: 'a sequence line has an empty name' }); return null; }
    let p = parts.get(s);
    if (!p) { p = { k: parts.size, label: s, strong: false }; parts.set(s, p); }
    if (strong) p.strong = true;
    return p;
  };
  String(text).split('\n').forEach((raw, line) => {
    const t = raw.trim();
    if (!t || t.startsWith('%%') || t.startsWith('//')) return;
    const hs = hops(t);
    if (!hs) { who(t, line); return; }
    for (const h of hs) {
      const a = who(h.a, line);
      const b = who(h.b, line);
      if (a && b) msgs.push({ a: a.k, b: b.k, dashed: h.dashed, label: h.label });
    }
  });
  return { parts: [...parts.values()], msgs, problems };
}

const SELF_W = 22;  // how far a call to itself goes out from its line
const ROW = 30;     // one message
const ROW_SELF = 40;

export function layoutSequence(q) {
  const P = q.parts.map((p) => {
    const { lines, cut } = wrapBox(p.label, 16);
    return { k: p.k, label: p.label, strong: p.strong, lines, cut, pins: p.pins || null, w: Math.max(48, Math.ceil(lineWidth(lines, p.pins)) + 2 * PAD_X), h: lines.length * LH + 2 * PAD_Y };
  });
  const n = P.length;
  const H = Math.max(0, ...P.map((p) => p.h));
  // How far apart two columns must stand: their boxes, and every label between them.
  const req = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i + 1 < n; i++) req[i][i + 1] = (P[i].w + P[i + 1].w) / 2 + 24;
  let rightRoom = 0;
  for (const m of q.msgs) {
    const lw = cols(m.label) * CH;
    if (m.a === m.b) {
      const need = SELF_W + 6 + lw + 10;
      if (m.a + 1 < n) req[m.a][m.a + 1] = Math.max(req[m.a][m.a + 1], need);
      else rightRoom = Math.max(rightRoom, need);
    } else {
      const i = Math.min(m.a, m.b);
      const j = Math.max(m.a, m.b);
      req[i][j] = Math.max(req[i][j], lw + 24);
    }
  }
  const x = [];
  for (let j = 0; j < n; j++) {
    let v = P[j].w / 2;
    for (let i = 0; i < j; i++) if (req[i][j]) v = Math.max(v, x[i] + req[i][j]);
    x.push(v);
  }
  P.forEach((p, i) => { p.x = x[i] - p.w / 2; p.y = (H - p.h) / 2; p.cx = x[i]; });
  let y = H + 26;
  const rows = q.msgs.map((m) => {
    const row = { ...m, y };
    const xa = x[m.a];
    const xb = x[m.b];
    if (m.a === m.b) {
      row.xy = [[xa, y], [xa + SELF_W, y], [xa + SELF_W, y + 14], [xa + 1, y + 14]];
      if (m.label) row.text = { x: xa + SELF_W + 6, y: y + 7, anchor: 'start', text: m.label };
      y += ROW_SELF;
    } else {
      // The line stops at the other column's line; the head marks the direction.
      row.xy = [[xa, y], [xb, y]];
      if (m.label) row.text = { x: (xa + xb) / 2, y: y - 9, anchor: 'middle', text: m.label };
      y += ROW;
    }
    row.d = routePath(row.xy);
    return row;
  });
  const bottom = y - ROW / 2 + 4;
  const width = Math.ceil(Math.max(0, ...P.map((p) => p.x + p.w), n ? x[n - 1] + rightRoom : 0));
  return { x: 0, y: 0, width, height: Math.ceil(bottom), parts: P, rows, life: P.map((p) => [[p.cx, H], [p.cx, bottom]]) };
}

export function sequenceIssues(q, L, room = ROOMS.card) {
  const out = [];
  if (L.width > room.max) out.push({ code: 'too-wide', msg: tooWide(L.width, room, 'shorten the labels, or split it') });
  for (const p of L.parts) if (p.cut) out.push({ code: 'box-cut', msg: `the name "${p.label}" is cut after three lines; shorten it` });
  return out;
}

export function sequence(text, caption, label, ctx = {}) {
  const q = parseSequence(text);
  q.parts.forEach((p) => { p.pins = pinsFor(ctx, p.label); });
  const L = layoutSequence(q);
  const T = ctx.t || en;
  const name = (k) => q.parts[k].label;
  const said = q.msgs.map((m) => (m.label
    ? T('fig_edge_label', { a: name(m.a), b: name(m.b), label: m.label })
    : T('fig_edge', { a: name(m.a), b: name(m.b) }))).join(T('fig_list_sep'));
  const cap = caption && (ctx.plain ? ctx.plain(caption) : caption);
  const head = cap ? T('fig_sequence_named', { caption: cap }) : T('fig_sequence');
  const aria = esc(T('fig_said', { head, parts: said || q.parts.map((p) => p.label).join(T('fig_node_sep')) }));
  const parts = [];
  L.life.forEach((l, i) => parts.push(`<path class="life" data-n="${i}" d="M${fmt(l[0])} L${fmt(l[1])}"/>`));
  for (const r of L.rows) {
    // A label that spans a part's line lies on a plate of card stock: the line is the part's
    // time, not a link, so the plate hides nothing a reader needs.
    const plate = r.text ? (() => { const b = textBox(r.text, 1); return `<rect class="plate" x="${round(b.x0)}" y="${round(b.y0)}" width="${round(b.x1 - b.x0)}" height="${round(b.y1 - b.y0)}"/>`; })() : '';
    parts.push(`<g class="fe${r.dashed ? ' dash' : ''}" data-a="${r.a}" data-b="${r.b}"><path d="${r.d}"/>${plate}${r.text ? textAt(r.text) : ''}</g>`);
  }
  for (const p of L.parts) parts.push(boxSvg({ ...p, store: false }));
  const svg = svgFrame('flow seq', L, parts.join(''), aria);
  return { html: frame('sequence', svg, caption, label, ctx), width: L.width + 4 + 2 * FIG_PAD, problems: q.problems, boxes: q.parts.length, issues: sequenceIssues(q, L, roomOf(ctx)) };
}

// ---------- class ----------
//
// Classes, records and types, and how they relate: a UML class diagram. The lines are
// Mermaid's classDiagram, which agents already write well; this file reads a subset of it
// and draws it with the flow's layout, so the flow's checks and a sheet's pins hold here
// too. Mermaid itself never runs. One statement per line:
//   classDiagram                         may come first, as in Mermaid
//   class Order {                        a class and its members, one a line; a member
//     +id: str                           with name( is a method. $ at the end: static;
//     +total() int                       * at the end: abstract
//   }
//   Order : +paid bool                   a member, outside the braces
//   class Order["Order (v2)"]            a name to show other than the id
//   <<interface>> Store                  an annotation over the name (or inside the braces)
//   Base <|-- Order                      Order is a kind of Base (also --|>); ..|> realizes
//   Order *-- Line                       owns: a line has no life without its order
//   Order o-- Coupon                     holds
//   Order --> Customer : placed by       refers to; ..> uses or creates; -- and .. link
//   Order "1" *-- "1..*" Line            how many, at each end
//   namespace Billing { ... }            one frame around the classes declared inside
//   direction LR                         left to right; TB is down, the default
// A parent and a whole stand above what they hold; an arrow runs down. What Mermaid
// styles (style, classDef, :::, click) and notes are said, not drawn.

const END = { '<|': 'tri', '|>': 'tri', '*': 'dia', o: 'odia', '<': 'arrow', '>': 'arrow' };
const RELATION = /^(\S+?)\s+(?:"([^"]*)"\s+)?(<\||\*|o|<)?(--|\.\.)(\|>|\*|o|>)?\s+(?:"([^"]*)"\s+)?([^\s:"]+)\s*(?::\s*(.*))?$/;
const LOOKS = /^(style|classDef|cssClass|click|link|callback)\b/;
// A generic in tildes, as Mermaid writes it, nested too: List~List~int~~ is List<List<int>>.
// A tilde before a letter opens one; any other tilde closes the last one open.
function generic(s) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '~') { out += s[i]; continue; }
    if (/[\p{L}\p{N}_]/u.test(s[i + 1] || '')) { out += '<'; depth++; } else if (depth) { out += '>'; depth--; } else out += '~';
  }
  return out;
}
// A class id: letters, digits, _ . and single dashes, then a generic. "Animal<|--Duck" is
// not one: it is a relation written without its spaces.
const classId = (s) => {
  const base = s.split('~')[0];
  return /^[\p{L}\p{N}_.-]+$/u.test(base) && !/--|\.\./.test(base) && (base === s || /^[^~]+~.*~$/.test(s));
};

// parseClass(text) -> { nodes, edges, groups, dir, problems }, in the flow's shape: a node is
// { k, label, cls: true, ann, fields, methods }, an edge { a, b, dashed, label, ends, counts }
// with a above b, and ends and counts named by those two ends.
export function parseClass(text) {
  const nodes = new Map();
  const edges = [];
  const spaces = [];
  const problems = [];
  let dir = 'down';
  let open = null;   // the class whose braces are open
  let space = null;  // the namespace whose braces are open
  let skip = null;   // a block this build does not read: front matter, accDescr { }
  // A class by its id. Only a class line declares it into the namespace it stands in.
  const cls = (raw, line, declare = false) => {
    let s = String(raw).trim();
    if (/:::/.test(s)) { problems.push({ line, msg: `":::${s.split(':::')[1]}" is a style; it is not drawn (the page has one ink)` }); s = s.split(':::')[0]; }
    let shown = null;
    const lm = s.match(/^([^\s["]+)\s*\[\s*"(.*)"\s*\]$/);
    if (lm) { s = lm[1]; shown = lm[2].trim(); }
    if (!classId(s)) {
      problems.push({ line, msg: `"${s}" is not a class name; a relation needs spaces around it (A <|-- B), and a name is letters, digits, _ . -` });
      return null;
    }
    const id = s.split('~')[0];
    let n = nodes.get(id);
    if (!n) { n = { k: nodes.size, label: generic(s), cls: true, ann: '', fields: [], methods: [] }; nodes.set(id, n); }
    if (shown) n.label = shown;
    else if (s !== id) n.label = generic(s);
    if (declare && space) {
      if (n.space === undefined) n.space = space.at;
      else if (n.space !== space.at) problems.push({ line, msg: `"${n.label}" is declared in two namespaces; a class belongs to one` });
    }
    return n;
  };
  const member = (n, raw) => {
    let t = generic(String(raw).trim());
    const ann = t.match(/^<<\s*(.+?)\s*>>$/);
    if (ann) { n.ann = ann[1]; return; }
    // $ static, * abstract: at the end, or right after the parentheses of a method.
    let mark = '';
    if (/[$*]$/.test(t)) { mark = t.slice(-1); t = t.slice(0, -1).trimEnd(); } else {
      const pm = t.match(/\)([$*])/);
      if (pm) { mark = pm[1]; t = t.replace(/\)([$*])/, ')'); }
    }
    if (!t) return;
    // A method is a name and its parentheses; "(orders.py:12)" alone is not one.
    (/[^\s(]\(/.test(t) ? n.methods : n.fields).push({ text: t, static: mark === '$', abstract: mark === '*' });
  };
  let first = true;
  String(text).split('\n').forEach((raw, line) => {
    const t = raw.trim();
    if (!t || t.startsWith('%%') || t.startsWith('//')) return;
    const atTop = first;
    first = false;
    if (skip) { if (t === skip) skip = null; return; }
    if (open) {
      if (t === '}') open = null;
      else member(open, t);
      return;
    }
    if (atTop && t === '---') { skip = '---'; problems.push({ line, msg: 'front matter is not read; the card\'s claim or caption names the drawing' }); return; }
    if (/^classDiagram(-v2)?$/.test(t)) return;
    const acc = t.match(/^(accTitle|accDescr)\b\s*(:|\{)?/);
    if (acc) {
      if (acc[2] === '{') skip = '}';
      problems.push({ line, msg: `${acc[1]} is not read; a screen reader hears the caption and every relation` });
      return;
    }
    const d = t.match(/^direction\s*:?\s*(TB|TD|BT|LR|RL|down|right)$/i);
    if (d) {
      dir = /^(LR|RL|right)$/i.test(d[1]) ? 'right' : 'down';
      if (/^(BT|RL)$/i.test(d[1])) problems.push({ line, msg: `direction ${d[1]} is drawn as ${dir === 'right' ? 'LR' : 'TB'}: a parent and a whole always stand first` });
      return;
    }
    const ns = t.match(/^namespace\s+(\S+)\s*\{$/);
    if (ns) {
      if (space) problems.push({ line, msg: `namespace "${ns[1]}" is inside "${space.label}"; a class belongs to one frame, so close the first one with }` });
      space = { label: ns[1], at: spaces.length };
      spaces.push(space);
      return;
    }
    if (t === '}') {
      if (space) space = null;
      else problems.push({ line, msg: 'a } closes nothing' });
      return;
    }
    // class Order, class Order {, and a body on one line: class Order { +id: str }
    const c = t.match(/^class\s+([^{]+?)\s*(?:\{(.*))?$/);
    if (c) {
      const n = cls(c[1], line, true);
      if (n && c[2] !== undefined) {
        const body = c[2].trim();
        if (body.endsWith('}')) { if (body.slice(0, -1).trim()) member(n, body.slice(0, -1)); } else {
          open = n;
          if (body) member(n, body);
        }
      }
      return;
    }
    const an = t.match(/^<<\s*(.+?)\s*>>\s+(\S+)$/);
    if (an) { const n = cls(an[2], line); if (n) n.ann = an[1]; return; }
    if (/^note\b/i.test(t)) { problems.push({ line, msg: 'a note is not drawn; say it in the card' }); return; }
    if (LOOKS.test(t)) { problems.push({ line, msg: `"${t.split(/\s/)[0]}" is not drawn: the compiler owns the look, and a figure has one ink` }); return; }
    const r = t.match(RELATION);
    if (r) {
      const [, l, cl, lm, way, rm, cr, rr, label] = r;
      const left = cls(l, line);
      const right = cls(rr, line);
      if (!left || !right) return;
      if (left === right) { problems.push({ line, msg: `"${left.label}" relates to itself; say that in a member` }); return; }
      const el = END[lm] || null;
      const er = END[rm] || null;
      // Which end stands above: a parent or a whole; else the end an arrow leaves; else the left.
      const big = (m) => m === 'tri' || m === 'dia' || m === 'odia';
      const leftUp = big(el) !== big(er) ? big(el) : (el === 'arrow') !== (er === 'arrow') ? er === 'arrow' : true;
      const [a, b, ea, eb, ca, cb] = leftUp ? [left, right, el, er, cl, cr] : [right, left, er, el, cr, cl];
      const e = { a: a.k, b: b.k, dashed: way === '..', label: (label || '').trim(), ends: { a: ea, b: eb }, counts: { a: (ca || '').trim(), b: (cb || '').trim() } };
      // The same relation written twice is one line; one that says anything else is its own.
      if (!edges.some((x) => JSON.stringify(x) === JSON.stringify(e))) edges.push(e);
      return;
    }
    const m = t.match(/^([^\s:]+)\s*:\s*(.+)$/);
    if (m) { const n = cls(m[1], line); if (n) member(n, m[2]); return; }
    if (/^\S+$/.test(t)) { cls(t, line); return; }
    problems.push({ line, msg: `"${t}" is not read; write a class, a member, or a relation such as A <|-- B` });
  });
  if (open) problems.push({ line: 0, msg: `the braces of class "${open.label}" are not closed; end its members with }` });
  if (space) problems.push({ line: 0, msg: `namespace "${space.label}" is not closed; end it with }` });
  // A namespace with no class in it draws nothing; the rest are frames, in the order written.
  const list = [...nodes.values()];
  const groups = [];
  spaces.forEach((sp) => {
    const members = list.filter((n) => n.space === sp.at).map((n) => n.k);
    if (!members.length) { problems.push({ line: 0, msg: `namespace "${sp.label}" holds no class; declare them inside it: class A` }); return; }
    members.forEach((k) => { list[k].group = groups.length; });
    groups.push({ label: sp.label, members });
  });
  list.forEach((n) => { delete n.space; });
  return { nodes: list, edges, groups, dir, problems };
}

const MEM_PAD = 4; // above and below the members of one compartment
// A class is a box of compartments: the annotation and the name, the fields, the methods.
function classSize(nd) {
  const w = Math.max(
    nd.ann ? cols(`«${nd.ann}»`) * CH : 0,
    lineWidth([nd.label], nd.pins),
    ...nd.fields.map((m) => cols(m.text) * CH),
    ...nd.methods.map((m) => cols(m.text) * CH),
  );
  const comp = (list) => (list.length ? list.length * LH + 2 * MEM_PAD : 0);
  return { w: Math.max(48, Math.ceil(w) + 2 * PAD_X), h: (nd.ann ? 2 : 1) * LH + 2 * PAD_Y + comp(nd.fields) + comp(nd.methods) };
}
function classBoxSvg(b) {
  const nd = b.cls;
  const cx = b.x + b.w / 2;
  const out = [`<rect x="${round(b.x)}" y="${round(b.y)}" width="${b.w}" height="${b.h}" rx="3"/>`];
  // A box with no members may stand taller than its name (counted lines at its side): the name
  // then stands in its middle, not over an empty compartment.
  const bare = !nd.fields.length && !nd.methods.length;
  let y = (bare ? b.y + (b.h - (nd.ann ? 2 : 1) * LH) / 2 : b.y + PAD_Y) + LH / 2;
  if (nd.ann) { out.push(`<text class="ann" x="${round(cx)}" y="${round(y)}" text-anchor="middle" dominant-baseline="central">${esc(`«${nd.ann}»`)}</text>`); y += LH; }
  if (b.pins) {
    // The name and the numerals after it are centred as one.
    const tw = cols(b.label) * CH;
    const x0 = cx - (tw + PIN_SEP + pinsW(b.pins)) / 2;
    out.push(`<text class="name" x="${round(x0)}" y="${round(y)}" text-anchor="start" dominant-baseline="central">${esc(b.label)}</text>` + pinSvg(b.pins, x0 + tw + PIN_SEP, y));
  } else out.push(`<text class="name" x="${round(cx)}" y="${round(y)}" text-anchor="middle" dominant-baseline="central">${esc(b.label)}</text>`);
  let top = b.y + 2 * PAD_Y + (nd.ann ? 2 : 1) * LH;
  for (const list of [nd.fields, nd.methods]) {
    if (!list.length) continue;
    out.push(`<path class="sep" d="M${round(b.x)},${round(top)} H${round(b.x + b.w)}"/>`);
    list.forEach((m, i) => {
      const cl = ['mem', m.static ? 'static' : '', m.abstract ? 'abstract' : ''].filter(Boolean).join(' ');
      out.push(`<text class="${cl}" x="${round(b.x + PAD_X)}" y="${round(top + MEM_PAD + LH * (i + 0.5))}" text-anchor="start" dominant-baseline="central">${esc(m.text)}</text>`);
    });
    top += list.length * LH + 2 * MEM_PAD;
  }
  return `<g class="fn cls${b.pins ? ' pinned' : ''}" data-n="${b.k}" data-part="${esc(partKey(b.label))}">${out.join('')}</g>`;
}

// What a reader would misread: the flow's checks, said in the words of a class diagram.
export function classIssues(g, L, room = ROOMS.card) {
  const out = flowIssues(g, L, room).map((x) => (x.code !== 'too-wide' ? x : {
    code: x.code,
    msg: tooWide(L.width, room, L.dir === 'right' ? 'write direction TB, or split it' : 'write direction LR (then the classes of a rank stand in a column), or split it'),
  }));
  // A label or a count on a mark hides what the relation is. A label's halo reaches 2px.
  const name = (k) => g.nodes[k].label;
  const texts = L.edges.flatMap((ed) => [
    ...(ed.label ? [{ r: textBox(ed.label, 2), what: `the label "${ed.label.text}"`, fix: 'shorten the label' }] : []),
    ...ed.counts.map((l) => ({ r: textBox(l, 2), what: `the count "${l.text}"`, fix: 'shorten the count' })),
  ]);
  const seen = new Set();
  for (const ed of L.edges) {
    for (const m of ed.marks || []) {
      const xs = m.pts.map((q) => q[0]);
      const ys = m.pts.map((q) => q[1]);
      const r = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      for (const t of texts) {
        const key = t.what + name(ed.a) + name(ed.b);
        if (meets(t.r, r) && !seen.has(key)) {
          seen.add(key);
          out.push({ code: 'label-on-mark', msg: `${t.what} touches the mark of ${name(ed.a)} -> ${name(ed.b)}, so a reader cannot see what the relation is; ${t.fix}` });
        }
      }
    }
  }
  return out;
}

export function classDiagram(text, caption, label, ctx = {}) {
  const g = parseClass(text);
  g.nodes.forEach((nd) => { nd.pins = pinsFor(ctx, nd.label); });
  g.groups.forEach((gr) => { gr.pins = pinsFor(ctx, gr.label); });
  const L = layoutFlow(g);
  const T = ctx.t || en;
  const name = (k) => g.nodes[k].label;
  // Said as the relation means it: "Order owns Line", not "Order to Line".
  const rel = (e) => {
    const [up, low] = [name(e.a), name(e.b)];
    const s = e.ends.a === 'tri' ? T('fig_kind_of', { a: low, b: up }) : e.ends.b === 'tri' ? T('fig_kind_of', { a: up, b: low })
      : e.ends.a === 'dia' ? T('fig_owns', { a: up, b: low }) : e.ends.b === 'dia' ? T('fig_owns', { a: low, b: up })
        : e.ends.a === 'odia' ? T('fig_holds', { a: up, b: low }) : e.ends.b === 'odia' ? T('fig_holds', { a: low, b: up })
          : e.ends.a === 'arrow' && e.ends.b !== 'arrow' ? T('fig_edge', { a: low, b: up }) : T('fig_edge', { a: up, b: low });
    return e.label ? T('fig_rel_label', { rel: s, label: e.label }) : s;
  };
  const cap = caption && (ctx.plain ? ctx.plain(caption) : caption);
  const head = cap ? T('fig_class_named', { caption: cap }) : T('fig_class');
  const said = g.edges.map(rel).join(T('fig_list_sep'));
  const aria = esc(T('fig_said', { head, parts: said || g.nodes.map((nd) => nd.label).join(T('fig_node_sep')) }));
  const parts = [];
  for (const f of L.frames) {
    parts.push(`<g class="fg${f.pins ? ' pinned' : ''}" data-part="${esc(partKey(f.label))}"><rect x="${round(f.x)}" y="${round(f.y)}" width="${round(f.w)}" height="${round(f.h)}" rx="6"/></g>`);
  }
  for (const e of L.edges) {
    parts.push(`<g class="fe${e.dashed ? ' dash' : ''}${e.back ? ' back' : ''}" data-a="${e.a}" data-b="${e.b}"><path d="${e.d}"/>` +
      e.marks.map((m) => `<path class="mk ${m.kind}" d="${m.d}"/>`).join('') +
      (e.label ? textAt(e.label) : '') + e.counts.map((l) => textAt(l, 'count')).join('') + '</g>');
  }
  for (const b of L.boxes) parts.push(classBoxSvg(b));
  for (const f of L.frames) parts.push(`<g class="fg-name">${frameName(f)}</g>`);
  const svg = svgFrame('flow cls', L, parts.join(''), aria);
  return { html: frame('class', svg, caption, label, ctx), width: L.width + 4 + 2 * FIG_PAD, problems: g.problems, boxes: g.nodes.length, issues: classIssues(g, L, roomOf(ctx)) };
}

// renderFigure(block, label, ctx) -> { html, width, problems?, issues? }
export function renderFigure(b, label, ctx = {}) {
  if (b.lang === 'class') return classDiagram(b.text, b.info, label, ctx);
  if (b.lang === 'flow') return flow(b.text, b.info, label, ctx);
  if (b.lang === 'sequence') return sequence(b.text, b.info, label, ctx);
  if (b.lang === 'chart') return chart(b.text, b.info, label, ctx);
  return sketch(b.text, b.info, label, ctx);
}
