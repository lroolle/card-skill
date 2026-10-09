// figure.mjs -- figures: a card shows the shape it talks about.
//
//   ```sketch Caption     a drawing in text characters, shown as written
//   ```flow Caption       boxes and arrows; this file does the layout
//
// The agent never writes SVG and never places a box. A sketch is escaped
// text. A flow is parsed into boxes and edges and laid out here, so the same
// text always gives the same picture, and no agent text reaches the page as
// markup.
//
// Flow syntax, one statement per line:
//   board.md -> cards render: agent writes     an edge; the label follows ": "
//   you --> log.jsonl                          dashed: optional, later, or weak
//   a -> b -> c                                a chain; a label goes on the last hop
//   **cards render** (or *cards render*)       bold: the part under discussion
//   direction: right                           left to right (default: down)

import { esc, inline } from './md.mjs';
import { en } from './i18n.mjs';

export const FIGURE_LANGS = ['sketch', 'flow'];
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
export const LIMITS = { sketchCols: 72, flowBoxes: 12 };

const CH = 7.2;     // advance of one column of 12px monospace
const LH = 16;      // line height inside a box
const PAD_X = 10;
const PAD_Y = 6;
const FIG_PAD = 12; // padding around the drawing inside the figure frame
export const WIDE = 330; // a figure wider than this needs two grid columns

// East Asian wide characters take two monospace columns.
const WIDE_CHAR = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
export function cols(s) {
  let n = 0;
  for (const ch of String(s)) n += WIDE_CHAR.test(ch) || ch.codePointAt(0) > 0xFFFF ? 2 : 1;
  return n;
}

export function frame(kind, body, caption, label, ctx, extra = '') {
  const cap = caption ? ' ' + (ctx.inline || inline)(caption, ctx) : '';
  return `<figure class="fig" data-kind="${kind}"${extra}><div class="fig-body">${body}</div>` +
    `<figcaption>${label ? `<b>${esc((ctx.t || en)('fig'))} ${esc(label)}</b>` : ''}${cap}</figcaption></figure>`;
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

export function parseFlow(text) {
  const nodes = new Map();
  const edges = [];
  const problems = [];
  let dir = 'down';
  const box = (raw, line) => {
    let s = raw.trim();
    let strong = false;
    const m = s.match(/^\*\*(.+)\*\*$/) || s.match(/^\*([^*].*)\*$/); // **md** or *org* bold
    if (m) { s = m[1].trim(); strong = true; }
    if (!s) { problems.push({ line, msg: 'a flow line has an empty box name' }); return null; }
    let n = nodes.get(s);
    if (!n) { n = { k: nodes.size, label: s, strong: false }; nodes.set(s, n); }
    if (strong) n.strong = true;
    return n;
  };
  String(text).split('\n').forEach((raw, line) => {
    const t = raw.trim();
    if (!t || t.startsWith('%%') || t.startsWith('//')) return;
    const d = t.match(/^direction:\s*(down|right)$/i);
    if (d) { dir = d[1].toLowerCase(); return; }
    const first = t.search(/-->|->/);
    if (first < 0) { box(t, line); return; }
    // The label starts at the first ": " after the first arrow, so a label may contain arrows.
    const ci = t.indexOf(': ', first);
    const chain = ci < 0 ? t.replace(/:$/, '') : t.slice(0, ci);
    const label = ci < 0 ? '' : t.slice(ci + 2).trim();
    const parts = chain.split(ARROW);
    for (let i = 0; i + 2 < parts.length; i += 2) {
      const a = box(parts[i], line);
      const b = box(parts[i + 2], line);
      if (!a || !b) continue;
      if (a === b) { problems.push({ line, msg: `"${a.label}" points to itself` }); continue; }
      const last = i + 2 === parts.length - 1;
      const prev = edges.find((e) => e.a === a.k && e.b === b.k);
      if (prev) { if (last && label && !prev.label) prev.label = label; continue; }
      edges.push({ a: a.k, b: b.k, dashed: parts[i + 1] === '-->', label: last ? label : '' });
    }
  });
  return { nodes: [...nodes.values()], edges, dir, problems };
}

// ---------- flow: layout ----------

function wrap(label, max = 22) {
  const out = [];
  let cur = '';
  for (const w of label.split(/\s+/)) {
    if (!cur) cur = w;
    else if (cols(cur) + 1 + cols(w) <= max) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  if (out.length > 3) { out.length = 3; out[2] += '…'; }
  return out;
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

export function layoutFlow(g) {
  const down = g.dir !== 'right';
  const n = g.nodes.length;
  const els = g.nodes.map((nd) => {
    const lines = wrap(nd.label);
    const w = Math.max(48, Math.ceil(Math.max(...lines.map(cols)) * CH) + 2 * PAD_X);
    const h = lines.length * LH + 2 * PAD_Y;
    return { real: true, k: nd.k, node: nd, lines, w, h, rank: 0, pred: [], succ: [] };
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
      els.push({ real: false, w: 0, h: 0, rank: r, pred: [], succ: [] });
      els[prev].succ.push(j); els[j].pred.push(prev);
      chain.push(j);
      prev = j;
    }
    els[prev].succ.push(e.b); els[e.b].pred.push(prev);
    chain.push(e.b);
    chains.set(i, chain);
  }

  // 4. Order each rank by barycenter sweeps; keep the order with the fewest crossings.
  const R = Math.max(0, ...els.map((e) => e.rank)) + 1;
  let layers = Array.from({ length: R }, () => []);
  els.forEach((e, j) => layers[e.rank].push(j));
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
      next[r].sort((p, q) => bary.get(p) - bary.get(q));
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

  // 5. Coordinates. p runs along the ranks (y when down), s across them.
  const sizeS = (e) => (down ? e.w : e.h);
  const sizeP = (e) => (down ? e.h : e.w);
  const labelOut = new Array(R).fill(0);
  for (const i of fwd) {
    const e = g.edges[i];
    if (!e.label) continue;
    const r = els[e.a].rank;
    labelOut[r] = Math.max(labelOut[r], down ? LH : Math.ceil(cols(e.label) * CH) + 16);
  }
  const thick = layers.map((l) => Math.max(0, ...l.map((j) => sizeP(els[j]))));
  const P = [0];
  for (let r = 0; r + 1 < R; r++) P.push(P[r] + thick[r] + Math.max(down ? 30 : 40, labelOut[r] + (down ? 22 : 8)));
  els.forEach((e) => { e.p = P[e.rank] + thick[e.rank] / 2; });
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
  const minS = Math.min(...els.map((e) => e.s - sizeS(e) / 2));
  els.forEach((e) => { e.s -= minS; });
  const maxS = Math.max(...els.map((e) => e.s + sizeS(e) / 2));

  // 6. Edges. Ports spread along a box side, ordered by where the other end sits.
  const pt = (s, p) => (down ? [s, p] : [p, s]);
  const portS = (j, others) => {
    const sorted = others.slice().sort((a, b) => els[a.next].s - els[b.next].s);
    const span = Math.min(sizeS(els[j]) * 0.6, 14 * (sorted.length - 1));
    sorted.forEach((o, x) => { o.s = els[j].s + (sorted.length > 1 ? -span / 2 + (span * x) / (sorted.length - 1) : 0); });
  };
  const outPorts = new Map();
  const inPorts = new Map();
  for (const i of fwd) {
    const ch = chains.get(i);
    const o = { edge: i, next: ch[1] };
    const t = { edge: i, next: ch[ch.length - 2] };
    (outPorts.get(ch[0]) || outPorts.set(ch[0], []).get(ch[0])).push(o);
    (inPorts.get(ch[ch.length - 1]) || inPorts.set(ch[ch.length - 1], []).get(ch[ch.length - 1])).push(t);
  }
  const portOf = new Map();
  outPorts.forEach((list, j) => { portS(j, list); list.forEach((o) => portOf.set(o.edge + ':out', o.s)); });
  inPorts.forEach((list, j) => { portS(j, list); list.forEach((o) => portOf.set(o.edge + ':in', o.s)); });

  const edges = [];
  for (const i of fwd) {
    const e = g.edges[i];
    const ch = chains.get(i);
    const pts = ch.map((j, x) => {
      const el = els[j];
      if (x === 0) return [portOf.get(i + ':out'), el.p + sizeP(el) / 2];
      if (x === ch.length - 1) return [portOf.get(i + ':in'), el.p - sizeP(el) / 2];
      return [el.s, el.p];
    });
    let d = `M${fmt(pt(...pts[0]))}`;
    for (let x = 1; x < pts.length; x++) {
      const [s0, p0] = pts[x - 1];
      const [s1, p1] = pts[x];
      const pm = (p0 + p1) / 2;
      d += ` C${fmt(pt(s0, pm))} ${fmt(pt(s1, pm))} ${fmt(pt(s1, p1))}`;
    }
    const [se, pe] = pts[pts.length - 1];
    d += ` M${fmt(pt(se - 4, pe - 6))} L${fmt(pt(se, pe))} L${fmt(pt(se + 4, pe - 6))}`;
    edges.push({ a: e.a, b: e.b, dashed: e.dashed, d, label: null, text: e.label, pts });
  }

  // Labels. Every edge is sampled into points; each label tries a few places
  // along the first stretch of its edge, on both sides, and takes the place
  // that touches the fewest lines, boxes and other labels. The outer side of
  // an edge that bends away comes first: a label sits where its line goes.
  const bez = (s0, p0, s1, p1, t) => [
    s0 * (1 - 3 * t * t + 2 * t * t * t) + s1 * (3 * t * t - 2 * t * t * t),
    p0 * (1 - 1.5 * t + 1.5 * t * t - t * t * t) + p1 * (1.5 * t - 1.5 * t * t + t * t * t),
  ];
  const samples = edges.map((e) => {
    const out = [];
    for (let x = 1; x < e.pts.length; x++) {
      const [s0, p0] = e.pts[x - 1];
      const [s1, p1] = e.pts[x];
      for (let k = 0; k <= 16; k++) out.push(pt(...bez(s0, p0, s1, p1, k / 16)));
    }
    return out;
  });
  const realBoxes = els.filter((el) => el.real).map((el) => {
    const [x, y] = pt(el.s - sizeS(el) / 2, el.p - sizeP(el) / 2);
    return { x0: x, y0: y, x1: x + el.w, y1: y + el.h };
  });
  const extentOf = (l) => {
    const tw = cols(l.text) * CH;
    const x = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - tw : l.x - tw / 2;
    return { x0: x - 3, x1: x + tw + 3, y0: l.y - 8, y1: l.y + 8 };
  };
  const placed = [];
  edges.forEach((e, ei) => {
    if (!e.text) return;
    const [s0, p0] = e.pts[0];
    const [s1, p1] = e.pts[1];
    const away = s1 < s0 - 1 ? -1 : 1;
    let best = null;
    // A sloped edge crosses a wide label near the line, so farther offsets are tried too.
    const offsets = down ? [7, 12, 18] : [9, 15, 22];
    [0.35, 0.25, 0.5, 0.65, 0.15].forEach((t, ti) => {
      [away, -away].forEach((side, si) => {
        offsets.forEach((off, oi) => {
          const [ls, lp] = bez(s0, p0, s1, p1, t);
          const l = down
            ? { x: ls + off * side, y: lp, anchor: side < 0 ? 'end' : 'start', text: e.text }
            : { x: lp, y: ls + (side < 0 ? off + 2 : -off), anchor: 'middle', text: e.text };
          const r = extentOf(l);
          const inside = ([x, y]) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
          const meets = (q) => r.x0 < q.x1 && q.x0 < r.x1 && r.y0 < q.y1 && q.y0 < r.y1;
          let cost = ti + si * 0.5 + oi * 0.7;
          samples.forEach((pts, j) => { cost += pts.filter(inside).length * (j === ei ? 4 : 10); });
          cost += realBoxes.filter(meets).length * 100 + placed.filter(meets).length * 100;
          if (!best || cost < best.cost) best = { cost, l };
        });
      });
    });
    e.label = best.l;
    placed.push(extentOf(best.l));
  });

  // Return loops run in lanes beyond the far side of the drawing and its labels.
  const labelFar = placed.reduce((m, q) => Math.max(m, down ? q.x1 : q.y1), -Infinity);
  let lane = Math.max(maxS, labelFar) + 18;
  const lanePts = [];
  for (const i of [...back].sort((x, y) => x - y)) {
    const e = g.edges[i];
    const a = els[e.a];
    const b = els[e.b];
    const sa = a.s + sizeS(a) / 2;
    const sb = b.s + sizeS(b) / 2;
    const r = 6;
    const dirP = b.p < a.p ? -1 : 1;
    let d = `M${fmt(pt(sa, a.p))} L${fmt(pt(lane - r, a.p))} Q${fmt(pt(lane, a.p))} ${fmt(pt(lane, a.p + dirP * r))}` +
      ` L${fmt(pt(lane, b.p - dirP * r))} Q${fmt(pt(lane, b.p))} ${fmt(pt(lane - r, b.p))} L${fmt(pt(sb, b.p))}`;
    d += ` M${fmt(pt(sb + 6, b.p - 4))} L${fmt(pt(sb, b.p))} L${fmt(pt(sb + 6, b.p + 4))}`;
    let label = null;
    if (e.label) {
      const pm = (a.p + b.p) / 2;
      label = down ? { x: lane + 7, y: pm, anchor: 'start' } : { x: pm, y: lane + 10, anchor: 'middle' };
      label.text = e.label;
    }
    lanePts.push(pt(lane, a.p), pt(lane, b.p));
    edges.push({ a: e.a, b: e.b, dashed: e.dashed, d, label, back: true });
    lane += 12;
  }

  const boxes = els.filter((e) => e.real).map((e) => {
    const [x, y] = pt(e.s - sizeS(e) / 2, e.p - sizeP(e) / 2);
    return { k: e.k, label: e.node.label, strong: e.node.strong, lines: e.lines, x, y, w: e.w, h: e.h };
  });

  // The drawing's bounds: boxes, labels, and return lanes.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (xa, ya, xb, yb) => { x0 = Math.min(x0, xa); y0 = Math.min(y0, ya); x1 = Math.max(x1, xb); y1 = Math.max(y1, yb); };
  boxes.forEach((b) => grow(b.x, b.y, b.x + b.w, b.y + b.h));
  lanePts.forEach(([x, y]) => grow(x, y, x, y));
  edges.forEach((e) => {
    if (!e.label) return;
    const tw = cols(e.label.text) * CH;
    const lx = e.label.anchor === 'start' ? e.label.x : e.label.anchor === 'end' ? e.label.x - tw : e.label.x - tw / 2;
    grow(lx, e.label.y - 9, lx + tw, e.label.y + 9);
  });
  if (!boxes.length) grow(0, 0, 0, 0);
  return { x: x0, y: y0, width: Math.ceil(x1 - x0), height: Math.ceil(y1 - y0), boxes, edges, dir: down ? 'down' : 'right' };
}

const fmt = ([x, y]) => `${round(x)},${round(y)}`;
const round = (v) => Math.round(v * 10) / 10;

// ---------- flow: render ----------

export function flow(text, caption, label, ctx = {}) {
  const g = parseFlow(text);
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
  for (const e of L.edges) {
    parts.push(`<g class="fe${e.dashed ? ' dash' : ''}${e.back ? ' back' : ''}" data-a="${e.a}" data-b="${e.b}"><path d="${e.d}"/>` +
      (e.label ? `<text x="${round(e.label.x)}" y="${round(e.label.y)}" text-anchor="${e.label.anchor}" dominant-baseline="central">${esc(e.label.text)}</text>` : '') +
      '</g>');
  }
  for (const b of L.boxes) {
    const cx = b.x + b.w / 2;
    const top = b.y + b.h / 2 - ((b.lines.length - 1) * LH) / 2;
    const text = b.lines.map((l, i) => `<text x="${round(cx)}" y="${round(top + i * LH)}" text-anchor="middle" dominant-baseline="central">${esc(l)}</text>`).join('');
    parts.push(`<g class="fn${b.strong ? ' strong' : ''}" data-n="${b.k}"><rect x="${round(b.x)}" y="${round(b.y)}" width="${b.w}" height="${b.h}" rx="3"/>${text}</g>`);
  }
  const W = L.width + 4;
  const H = L.height + 4;
  const svg = `<svg class="flow" viewBox="${round(L.x - 2)} ${round(L.y - 2)} ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${aria}">${parts.join('')}</svg>`;
  return { html: frame('flow', svg, caption, label, ctx), width: W + 2 * FIG_PAD, problems: g.problems, boxes: g.nodes.length };
}

// renderFigure(block, label, ctx) -> { html, width }
export function renderFigure(b, label, ctx = {}) {
  return b.lang === 'flow' ? flow(b.text, b.info, label, ctx) : sketch(b.text, b.info, label, ctx);
}
