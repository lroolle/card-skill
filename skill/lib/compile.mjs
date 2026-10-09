// compile.mjs -- board.org + log.jsonl -> page data -> one self-contained HTML file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBoard, anatomy, syntaxOf, parseCard } from './board.mjs';
import { lint } from './lint.mjs';
import { esc, renderBlocks, parseFacts } from './md.mjs';
import { renderFigure, isFigure, WIDE } from './figure.mjs';
import { resolveAssets, assetHtml, assetKey, imageFigure } from './assets.mjs';
import { sync, fold, readLog } from './store.mjs';
import { strings as uiStrings, t } from './i18n.mjs';
import '../runtime/digest.js';

const RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime');
const HISTORY_KEEP = 4;

// The render context of one board: its format's inline renderer, and card
// references drawn as numeral + claim (or the link text the author gave).
function refCtx(byId, nOf, sx, table, assets = null) {
  const ctx = {
    inline: sx.inline,
    plain: sx.plain,
    t: (key, vars) => t(table, key, vars),
    assets,
    asset: (b) => assetHtml(b, assets, ctx),
    ref(id, label) {
      const c = byId.get(id);
      if (!c) return `<span class="ref missing">${label || esc(id)}</span>`;
      const text = label || syntaxOf(c.fmt).inline(c.title, ctx);
      return `<a class="ref" href="#c-${esc(id)}" data-ref="${esc(id)}"><span class="ref-n">${nOf(id)}</span><span class="ref-t">${text}</span></a>`;
    },
  };
  return ctx;
}

// A drawn figure (sketch, flow) or an image file, as { html, width }.
function figureOf(b, label, ctx) {
  if (b.type !== 'file') return renderFigure(b, label, ctx);
  const a = ctx.assets && ctx.assets.map.get(assetKey(b));
  return a && a.kind === 'image' ? imageFigure(a, b.info, label, ctx) : { html: assetHtml(b, ctx.assets, ctx), width: 0 };
}

// Figures are numbered per card, in source order: Fig. 12.1 is the first
// figure on card 12, so a human can point at it in words.
function cardView(card, ctx, n = '?') {
  const a = card.anatomy || anatomy(card);
  const inline = ctx.inline;
  let k = 0;
  const fctx = {
    ...ctx,
    figure: (b) => (isFigure(b) ? figureOf(b, `${n}.${++k}`, ctx).html : null),
  };
  const fig = a.figure ? figureOf(a.figure, `${n}.${++k}`, ctx) : null;
  return {
    title_html: inline(card.title, ctx),
    gist_html: a.gist ? `<p>${inline(a.gist.text, ctx)}</p>` : '',
    figure_html: fig ? fig.html : '',
    fig_w: fig ? fig.width : 0,
    wide: !!fig && fig.width > WIDE,
    facts: a.facts ? parseFacts(a.facts.text).map(([k2, v]) => [k2, inline(v, ctx)]) : [],
    depth_html: renderBlocks(a.depth, fctx),
    options: a.options,
  };
}

// A past version is stored as its raw source, in the format it was written in.
function pastView(src, fmt, ctx) {
  const c = parseCard(src, fmt);
  if (!c) return { title_html: esc(src.split('\n')[0]), gist_html: '' };
  const v = cardView(c, { ...ctx, inline: syntaxOf(fmt).inline });
  return { title_html: v.title_html, gist_html: v.gist_html };
}

export function pageData(board, st, ref, { live = false, token = null, cwd = process.cwd() } = {}) {
  const byId = new Map(board.cards.map((c) => [c.id, c]));
  const nOf = (id) => st.cards.get(id)?.n ?? '?';
  const sx = syntaxOf(board.fmt);
  const ui = uiStrings(board.lang);
  const ctx = refCtx(byId, nOf, sx, ui.strings, board.assets || null);
  const cards = {};
  for (const c of board.cards) {
    const v = cardView(c, ctx, nOf(c.id));
    const rec = st.cards.get(c.id);
    const past = rec ? rec.history.slice(0, -1).slice(-HISTORY_KEEP).reverse() : [];
    cards[c.id] = {
      id: c.id,
      n: nOf(c.id),
      v: rec?.v ?? 1,
      rev: rec?.rev ?? st.rev,
      section: c.section,
      title_html: v.title_html,
      title_text: sx.plain(c.title),
      text: sx.plain(`${c.title} ${c.body}`).slice(0, 2000),
      gist_html: v.gist_html,
      figure_html: v.figure_html,
      wide: v.wide,
      fig_w: v.fig_w,
      facts: v.facts,
      depth_html: v.depth_html,
      options: v.options.map((o) => ({
        value: o.value,
        ref: o.ref,
        default: !!o.default,
        label_html: o.ref
          ? `<span class="ref-n">${nOf(o.ref)}</span>${byId.has(o.ref) ? sx.inline(byId.get(o.ref).title, ctx) : esc(o.ref)}${o.text ? ' <span class="opt-note">' + sx.inline(o.text, ctx) + '</span>' : ''}`
          : sx.inline(o.text, ctx),
      })),
      ask: c.ask,
      status: c.status,
      basis: c.basis,
      from: c.from,
      needs: c.needs,
      refs: c.anatomy.refs,
      tags: c.tags,
      multi: c.multi,
      progress: c.progress,
      history: past.map((h) => ({ v: h.v, rev: h.rev, at: h.at, ...pastView(h.src, h.fmt, ctx) })),
    };
  }
  return {
    format: 1,
    board: {
      id: board.id,
      title: board.title,
      lang: board.lang,
      lede_html: renderBlocks(sx.blocks(board.lede), ctx),
      rev: st.rev,
      path: displayPath(cwd, ref.file),
      generated: new Date().toISOString(),
    },
    sections: board.sections.map((s) => ({
      id: s.id,
      title: s.title,
      note_html: s.note ? renderBlocks(sx.blocks(s.note), ctx) : '',
      layout: s.layout,
      cards: s.cards,
    })),
    cards,
    // The chrome speaks the board's language (lib/i18n.mjs).
    strings: ui.strings,
    sends: st.sends.map((s) => ({ round: s.round, rev: s.rev, at: s.at, items: s.items })),
    chat: chatOf(st),
    read: st.read,
    live,
    token,
  };
}

// The chat thread: your rounds (with the note you typed, if any), the agent's
// messages (`cards say`), and each published revision, in time order.
const CHAT_KEEP = 60;
function chatOf(st) {
  const out = [];
  for (const s of st.sends) {
    const note = s.items.find((it) => it.kind === 'note');
    const others = s.items.filter((it) => it.kind !== 'note' && it.state !== 'untouched').length;
    out.push({ who: 'you', at: s.at, round: s.round, text: note ? note.text : '', responses: others, read: s.round <= st.read });
  }
  for (const m of st.says || []) out.push({ who: 'agent', at: m.at, text: m.text });
  for (const r of st.revs || []) if (r.rev > 1) out.push({ who: 'board', at: r.at, rev: r.rev, cards: r.cards });
  out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  // Revisions with no message between them read as one line: "rev 3 to 10".
  const merged = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (m.who === 'board' && last && last.who === 'board') Object.assign(last, { to: m.rev, at: m.at, cards: last.cards + m.cards });
    else merged.push(m.who === 'board' ? { ...m, from: m.rev } : m);
  }
  return merged.slice(-CHAT_KEEP);
}

// Relative to the project when the board lives inside it; absolute otherwise.
function displayPath(cwd, file) {
  const rel = path.relative(cwd, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : file;
}


function readRuntime(name) {
  return fs.readFileSync(path.join(RUNTIME, name), 'utf8');
}

export function pageHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
    .split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
  const fill = { lang: esc(data.board.lang), title: esc(data.board.title), css: readRuntime('board.css'),
    noscript: esc(t(data.strings, 'noscript')),
    digest: readRuntime('digest.js'), js: readRuntime('board.js'), data: json };
  // Replace with a function: the payloads contain `$` sequences that must stay literal.
  return readRuntime('board.html').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in fill ? fill[k] : m));
}

// buildBoard(ref) -> { errors, warnings, data, html, sync }
export function buildBoard(ref, { live = false, token = null, write = true, cwd = process.cwd() } = {}) {
  if (!fs.existsSync(ref.file)) {
    return { errors: [{ line: 0, msg: `no board at ${path.relative(cwd, ref.file)}`, fix: `cards new ${ref.id}` }], warnings: [] };
  }
  const board = parseBoard(fs.readFileSync(ref.file, 'utf8'), { id: ref.id, file: ref.file });
  const warnings = lint(board);
  if (board.errors.length) return { board, errors: board.errors, warnings };
  // Files the board shows are read now, once: they travel inside the page.
  board.assets = resolveAssets(board, ref.dir);
  warnings.push(...board.assets.warnings);
  warnings.sort((x, y) => x.line - y.line);
  if (board.assets.errors.length) return { board, errors: board.assets.errors, warnings };
  const syncRes = sync(ref.dir, board);
  const st = fold(readLog(ref.dir));
  const data = pageData(board, st, ref, { live, token, cwd });
  const html = pageHtml(data);
  if (write) fs.writeFileSync(path.join(ref.dir, 'board.html'), html);
  return { board, errors: [], warnings, data, html, sync: syncRes, st };
}

// outline(data) -> the board as terminal text. Useful when nobody opens the page.
export function outline(data) {
  const cards = Object.values(data.cards);
  const answered = globalThis.cardsAnswered(data.sends);
  const waiting = cards.filter((c) => c.ask && c.status !== 'done' && !answered.has(c.id + '@' + c.v)).length;
  const lines = [`${data.board.title}  (rev ${data.board.rev}, ${cards.length} cards, ${waiting} waiting on you)`];
  for (const s of data.sections) {
    lines.push(`  ${s.title || '(untitled)'}${s.layout !== 'grid' ? `  [${s.layout}]` : ''}`);
    for (const id of s.cards) {
      const c = data.cards[id];
      const tag = [c.ask, c.status !== 'open' ? c.status : null].filter(Boolean).join(' ');
      lines.push(`    #${String(c.n).padEnd(3)} ${c.id.padEnd(18)} ${tag.padEnd(14)} ${c.title_text}`);
    }
  }
  return lines.join('\n');
}

