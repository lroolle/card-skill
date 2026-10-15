// chart.mjs -- a chart: the numbers a card is about, drawn from an Org table.
//
//   #+caption: p95 latency by queue, in ms
//   #+begin_src chart
//   | queue | p95 ms |
//   |-------+--------|
//   | NATS  |      4 |
//   | Kafka |     11 |
//   #+end_src
//
// The first row names the columns. The first column names each row: a category,
// or a point on x. Every other column is a series of numbers. Names in the first
// column give bars; numbers or dates there give a line over x. A line of its own,
// `type: bar` or `type: line`, says otherwise. The agent never places a bar, picks
// a scale or a colour: series differ by tone and mark, in the card's one ink, so
// the role colours of the board keep their meaning.

import { esc } from './md.mjs';
import { en } from './i18n.mjs';
import { cols, frame, FIG_MAX } from './figure.mjs';

const CH = 7.2;          // advance of one column of 12px monospace
const FIG_PAD = 12;      // padding around the drawing inside the figure frame
const BAR_PLOT = 220;    // the length of the longest bar
const LINE_W = 240;      // the plot of a line chart: one series fits one column of the rack
const LINE_H = 140;
const NAME_MAX = 24;     // a category name is cut after this many columns
export const CHART_LIMITS = { series: 4, bars: 16, points: 60 };

// A cell as a number: "1,200", "-3.5", "12%". Empty or "-" is no value (null); anything
// else is not a number (undefined).
function num(raw) {
  const s = String(raw).trim();
  if (!s || s === '-' || s === '—') return null;
  const m = s.replace(/[,_\s]/g, '').match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)%?$/i);
  return m ? Number(m[1]) : undefined;
}
// A point on x as a number: a number, or a date (2026, 2026-10, 2026-10-15) as its time.
function xval(raw) {
  const s = String(raw).trim();
  const d = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (d) return Date.UTC(+d[1], +d[2] - 1, +(d[3] || 1));
  const v = num(s);
  return typeof v === 'number' ? v : null;
}

// parseChart(text) -> { type, head, xs, xv, series: [{ name, values: [{ raw, v }] }], problems }
export function parseChart(text) {
  let type = null;
  let rule = false;
  const rows = [];
  const problems = [];
  String(text).split('\n').forEach((raw, line) => {
    const t = raw.trim();
    if (!t || t.startsWith('%%') || t.startsWith('//')) return;
    const m = t.match(/^type:\s*(\S+)$/i);
    if (m) {
      const v = m[1].toLowerCase();
      if (v === 'bar' || v === 'line') type = v;
      else problems.push({ line, msg: `"type: ${m[1]}" is not a chart type; write type: bar or type: line` });
      return;
    }
    if (!t.startsWith('|')) { problems.push({ line, msg: `"${t.slice(0, 40)}" is not a table row; a chart is an Org table: | name | value |` }); return; }
    if (/^\|[-+:|\s]*$/.test(t)) { rule = true; return; }
    rows.push({ cells: t.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()), line });
  });
  if (rows.length < 2) {
    problems.push({ line: 0, msg: 'a chart needs a head row and at least one row of numbers: | name | value |' });
    return { type: type || 'bar', head: rows[0] ? rows[0].cells : [], xs: [], xv: [], series: [], problems };
  }
  const head = rows[0].cells;
  const body = rows.slice(1);
  const width = Math.max(...rows.map((r) => r.cells.length));
  if (width < 2) problems.push({ line: rows[0].line, msg: 'a chart needs a column of names and at least one column of numbers' });
  if (!rule && head.slice(1).every((c) => typeof num(c) === 'number')) {
    problems.push({ line: rows[0].line, msg: 'the first row is read as the names of the columns, and it holds numbers; write the names there, and a rule |---| under them' });
  }
  const series = [];
  for (let c = 1; c < width; c++) {
    series.push({
      name: head[c] || '',
      values: body.map((r) => {
        const raw = r.cells[c] ?? '';
        const v = num(raw);
        if (v === undefined) problems.push({ line: r.line, msg: `"${raw}" in the column "${head[c] || c + 1}" is not a number; write a number (a unit goes in the head), or leave the cell empty` });
        return { raw, v: typeof v === 'number' ? v : null };
      }),
    });
  }
  const xs = body.map((r) => r.cells[0] ?? '');
  const xv = xs.map(xval);
  const kind = type || (xs.length >= 3 && xv.every((v) => v !== null) ? 'line' : 'bar');
  return { type: kind, head, xs, xv, series, problems };
}

// Round steps for an axis: 1, 2 or 5 times a power of ten.
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
function short(v) {
  const a = Math.abs(v);
  const t = (x) => String(Number(x.toFixed(2)));
  return a >= 1e6 ? t(v / 1e6) + 'M' : a >= 1e4 ? t(v / 1e3) + 'k' : t(v);
}
const fit = (s, max = NAME_MAX) => (cols(s) > max ? [...s].slice(0, max - 1).join('') + '…' : s);
const r1 = (v) => Math.round(v * 10) / 10;
const text = (x, y, s, anchor, cls) => `<text class="${cls}" x="${r1(x)}" y="${r1(y)}" text-anchor="${anchor}" dominant-baseline="central">${esc(s)}</text>`;

function layoutBars(c) {
  const S = c.series.length;
  const names = c.xs.map((x) => fit(x));
  const labW = Math.max(1, ...names.map(cols)) * CH;
  const vals = c.series.flatMap((s) => s.values.map((x) => x.v)).filter((v) => v !== null);
  const vmin = Math.min(0, ...vals);
  const vmax = Math.max(0, ...vals);
  const span = vmax - vmin || 1;
  const valW = Math.max(1, ...c.series.flatMap((s) => s.values.map((x) => cols(x.raw)))) * CH;
  const barH = S === 1 ? 14 : 12;
  const groupH = S * barH + (S - 1) * 2;
  const rowH = groupH + 10;
  const key = S > 1 || c.series[0].name ? 20 : 0;
  const x0 = labW + 10 + (vmin < 0 ? valW + 6 : 0);
  const zero = x0 + ((0 - vmin) / span) * BAR_PLOT;
  const parts = [];
  if (S > 1) {
    let kx = x0;
    c.series.forEach((s, k) => {
      parts.push(`<rect class="c-bar s${k}" x="${r1(kx)}" y="1" width="10" height="10"/>` + text(kx + 14, 6, s.name, 'start', 'c-key'));
      kx += 14 + cols(s.name) * CH + 16;
    });
  } else if (key) parts.push(text(x0, 6, c.series[0].name, 'start', 'c-key'));
  names.forEach((nm, i) => {
    const y = key + i * rowH;
    parts.push(text(labW, y + groupH / 2, nm, 'end', 'c-cat'));
    c.series.forEach((s, k) => {
      const { v, raw } = s.values[i];
      if (v === null) return;
      const w = (Math.abs(v) / span) * BAR_PLOT;
      const x = v >= 0 ? zero : zero - w;
      const yb = y + k * (barH + 2);
      parts.push(`<rect class="c-bar s${k}" x="${r1(x)}" y="${r1(yb)}" width="${r1(Math.max(w, 1))}" height="${barH}"><title>${esc(`${c.xs[i]}, ${s.name}: ${raw}`)}</title></rect>`);
      parts.push(text(v >= 0 ? x + w + 4 : x - 4, yb + barH / 2, raw, v >= 0 ? 'start' : 'end', 'c-val'));
    });
  });
  const bottom = key + names.length * rowH - 6;
  parts.push(`<path class="c-axis" d="M${r1(zero)},${key - 3} L${r1(zero)},${r1(bottom + 3)}"/>`);
  const width = Math.ceil(zero + (vmax > 0 ? ((vmax - 0) / span) * BAR_PLOT + 4 + valW : 0) + 2);
  return { width: Math.max(width, x0 + BAR_PLOT), height: Math.ceil(bottom + 4), body: parts.join(''), cut: c.xs.filter((x) => cols(x) > NAME_MAX) };
}

const MARK = [
  (x, y) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="3"`,
  (x, y) => `<rect x="${r1(x - 3)}" y="${r1(y - 3)}" width="6" height="6"`,
  (x, y) => `<path d="M${r1(x)},${r1(y - 4)} L${r1(x + 3.5)},${r1(y + 2.5)} L${r1(x - 3.5)},${r1(y + 2.5)} Z"`,
  (x, y) => `<path d="M${r1(x)},${r1(y - 4)} L${r1(x + 4)},${r1(y)} L${r1(x)},${r1(y + 4)} L${r1(x - 4)},${r1(y)} Z"`,
];

function layoutLine(c) {
  const S = c.series.length;
  const n = c.xs.length;
  const X = c.xv.every((v) => v !== null) ? c.xv : c.xs.map((_, i) => i);
  let xmin = Math.min(...X);
  let xmax = Math.max(...X);
  if (xmax === xmin) xmax = xmin + 1;
  const vals = c.series.flatMap((s) => s.values.map((x) => x.v)).filter((v) => v !== null);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo >= 0 && lo <= 0.6 * hi) lo = 0;
  if (hi === lo) hi = lo + 1;
  const step = niceStep((hi - lo) / 4);
  const t0 = Math.floor(lo / step) * step;
  const t1 = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = t0; t <= t1 + step / 2; t += step) ticks.push(Number(t.toFixed(10)));
  const tickW = Math.max(...ticks.map((t) => cols(short(t)))) * CH + 8;
  const top = S === 1 && c.series[0].name ? 20 : 8;
  const px = (x) => tickW + ((x - xmin) / (xmax - xmin)) * LINE_W;
  const py = (v) => top + LINE_H - ((v - t0) / (t1 - t0 || 1)) * LINE_H;
  const parts = [];
  if (top > 8) parts.push(text(tickW, 6, c.series[0].name, 'start', 'c-key'));
  ticks.forEach((t) => {
    parts.push(`<path class="c-grid" d="M${r1(tickW)},${r1(py(t))} L${r1(tickW + LINE_W)},${r1(py(t))}"/>`);
    parts.push(text(tickW - 6, py(t), short(t), 'end', 'c-tick'));
  });
  // Names on x: as many as fit without touching, evenly chosen, the last always.
  const nameW = Math.max(1, ...c.xs.map((x) => cols(fit(x, 12)))) * CH + 12;
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(LINE_W / nameW))));
  c.xs.forEach((x, i) => {
    if (i % every && i !== n - 1) return;
    if (i !== n - 1 && n - 1 - i < every && (n - 1) % every) return;
    parts.push(text(px(X[i]), top + LINE_H + 12, fit(x, 12), i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle', 'c-tick'));
  });
  const ends = [];
  c.series.forEach((s, k) => {
    let d = '';
    let pen = false;
    s.values.forEach(({ v }, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? ' L' : ' M'}${r1(px(X[i]))},${r1(py(v))}`;
      pen = true;
    });
    if (d) parts.push(`<path class="c-ln s${k}" d="${d.trim()}"/>`);
    if (n <= 24) {
      s.values.forEach(({ v, raw }, i) => {
        if (v !== null) parts.push(`${MARK[k](px(X[i]), py(v))} class="c-mk s${k}"><title>${esc(`${c.xs[i]}, ${s.name}: ${raw}`)}</title>${k === 0 ? '</circle>' : k === 1 ? '</rect>' : '</path>'}`);
      });
    }
    const last = [...s.values.keys()].reverse().find((i) => s.values[i].v !== null);
    if (S > 1 && last !== undefined) ends.push({ y: py(s.values[last].v), x: px(X[last]) + 8, name: s.name, k });
  });
  // Each line is named at its end; names that would touch move apart.
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y < ends[i - 1].y + 14) ends[i].y = ends[i - 1].y + 14;
  ends.forEach((e) => parts.push(text(e.x, e.y, e.name, 'start', `c-end s${e.k}`)));
  const right = Math.max(0, ...ends.map((e) => e.x + cols(e.name) * CH)) ;
  return { width: Math.ceil(Math.max(tickW + LINE_W + 4, right + 2)), height: top + LINE_H + 20, body: parts.join(''), cut: [] };
}

export function chartIssues(c, L) {
  const out = [];
  if (c.series.length > CHART_LIMITS.series) out.push({ code: 'too-many', msg: `the chart has ${c.series.length} series and shows ${CHART_LIMITS.series}; split it` });
  const most = c.type === 'line' ? CHART_LIMITS.points : CHART_LIMITS.bars;
  if (c.xs.length > most) out.push({ code: 'too-many', msg: `the chart has ${c.xs.length} rows; a ${c.type} chart reads up to ${most}: keep the rows that matter` });
  for (const x of L.cut) out.push({ code: 'box-cut', msg: `the name "${x}" is cut after ${NAME_MAX} columns; shorten it` });
  if (L.width > FIG_MAX) out.push({ code: 'too-wide', msg: `the chart is ${L.width} px wide, and a card on the desk shows ${FIG_MAX} px of it; shorten the names` });
  return out;
}

export function chart(src, caption, label, ctx = {}) {
  const c = parseChart(src);
  c.series = c.series.slice(0, CHART_LIMITS.series);
  const T = ctx.t || en;
  const cap = caption && (ctx.plain ? ctx.plain(caption) : caption);
  const head = cap ? T('fig_chart_named', { caption: cap }) : T('fig_chart');
  if (!c.series.length || !c.xs.length) {
    const body = `<p class="chart-none">${esc(T('fig_chart_empty'))}</p>`;
    return { html: frame('chart', body, caption, label, ctx), width: 0, problems: c.problems, issues: [] };
  }
  const L = c.type === 'line' ? layoutLine(c) : layoutBars(c);
  // A screen reader hears the numbers: each series, row by row (the first 40 values).
  let budget = 40;
  const said = c.series.map((s) => (s.name ? s.name + ': ' : '') + s.values.filter(() => budget-- > 0)
    .map((x, i) => `${c.xs[i]} ${x.raw || '-'}`).join(', ')).join(T('fig_list_sep'));
  const aria = esc(T('fig_said', { head, parts: said }));
  const W = L.width + 4;
  const H = L.height + 4;
  const svg = `<svg class="chart" data-type="${c.type}" viewBox="-2 -2 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${aria}">${L.body}</svg>`;
  return { html: frame('chart', svg, caption, label, ctx), width: W + 2 * FIG_PAD, problems: c.problems, issues: chartIssues(c, L) };
}
