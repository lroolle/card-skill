// compile.mjs -- board.org + log.jsonl -> page data -> one self-contained HTML file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBoard, anatomy, syntaxOf, parseCard } from './board.mjs';
import { lint } from './lint.mjs';
import { esc, renderBlocks, parseFacts } from './md.mjs';
import { renderFigure, isFigure, figuresIn, WIDE } from './figure.mjs';
import { resolveAssets, assetHtml, assetKey, imageFigure } from './assets.mjs';
import { sync, fold, readLog, markBuild, markFont } from './store.mjs';
import { strings as uiStrings, t } from './i18n.mjs';
import { family, translationChecks } from './siblings.mjs';
import { VERSION, HOME } from './version.mjs';
import { boardFont } from './font.mjs';
import { writeIndex, isBoardsRoot } from './index.mjs';
import '../runtime/digest.js';

const RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime');
const HISTORY_KEEP = 4;

// The render context of one board: its format's inline renderer, and card
// references drawn as numeral + claim (or the link text the author gave).
function refCtx(byId, nOf, sx, table, assets = null, chipHref = null, publish = false) {
  const ctx = {
    inline: sx.inline,
    plain: sx.plain,
    t: (key, vars) => t(table, key, vars),
    assets,
    chipHref,
    publish,
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
  // A figure's number is its place in the source, wherever the page shows it:
  // a picture inside a list that comes first is Fig. n.1.
  const place = new Map(figuresIn(a.blocks || []).map((b, k) => [b, k + 1]));
  const label = (b) => `${n}.${place.get(b) || place.size + 1}`;
  const fctx = {
    ...ctx,
    figure: (b) => (isFigure(b) ? figureOf(b, label(b), ctx).html : null),
  };
  const fig = a.figure ? figureOf(a.figure, label(a.figure), ctx) : null;
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

// publish: the page leaves the machine (`cards export`). It then carries the
// board as it is now and nothing else: no replies, no chat, no past versions,
// no path on this disk.
export function pageData(board, st, ref, { live = false, token = null, cwd = process.cwd(), publish = false, chipHref = null, home = null } = {}) {
  const byId = new Map(board.cards.map((c) => [c.id, c]));
  const nOf = (id) => st.cards.get(id)?.n ?? '?';
  const sx = syntaxOf(board.fmt);
  const ui = uiStrings(board.lang);
  const ctx = refCtx(byId, nOf, sx, ui.strings, board.assets || null, chipHref, publish);
  // What Find searches: the words of the card. A file shows as its name, not
  // as the path the agent wrote, which is syntax and says where things lie.
  const words = (c) => sx.plain(`${c.title} ${String(c.body)
    .replace(/^\s*#\+include:\s*"?([^"\s]+)"?.*$/gim, (m, f) => path.basename(f))
    .replace(/\[\[(?:file:)?((?:\.{1,2}\/)[^\]]*)\]\]/g, (m, f) => path.basename(f.replace(/::.*$/, '')))}`).slice(0, 2000);
  // A published copy names index.html in full, so the link also works when the files are opened from a disk.
  const hrefOf = (id) => (publish ? `../${id}/index.html` : live ? `/b/${id}` : `../${id}/board.html`);
  const cards = {};
  for (const c of board.cards) {
    const v = cardView(c, ctx, nOf(c.id));
    const rec = st.cards.get(c.id);
    const past = rec && !publish ? rec.history.slice(0, -1).slice(-HISTORY_KEEP).reverse() : [];
    cards[c.id] = {
      id: c.id,
      n: nOf(c.id),
      v: rec?.v ?? 1,
      rev: rec?.rev ?? st.rev,
      section: c.section,
      title_html: v.title_html,
      title_text: sx.plain(c.title),
      text: words(c),
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
        label_text: o.ref ? (byId.has(o.ref) ? sx.plain(byId.get(o.ref).title) : o.ref) : sx.plain(o.text),
        label_html: o.ref
          ? `<span class="ref-n">${nOf(o.ref)}</span>${byId.has(o.ref) ? sx.inline(byId.get(o.ref).title, ctx) : esc(o.ref)}${o.text ? ' <span class="opt-note">' + sx.inline(o.text, ctx) + '</span>' : ''}`
          : sx.inline(o.text, ctx),
      })),
      ask: c.ask,
      status: c.status,
      basis: c.basis,
      from: c.from,
      needs: c.needs,
      when: c.when || {},
      refs: c.anatomy.refs,
      tags: c.tags,
      multi: c.multi,
      suggest: c.suggest || null,
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
      author: board.author || '',
      description: board.description || '',
      lede_html: renderBlocks(sx.blocks(board.lede), ctx),
      lede_text: sx.plain(board.lede).slice(0, 300),
      rev: st.rev,
      path: publish ? '' : displayPath(cwd, ref.file),
      generated: new Date().toISOString(),
      // The way back: the list of this project's boards (lib/index.mjs), or for a
      // published copy the page its publisher names (`cards export --home`).
      home: publish ? (home || '') : live ? '/' : ref && ref.dir && isBoardsRoot(path.dirname(ref.dir)) ? '../index.html' : '',
      // The same board in other languages (lib/siblings.mjs).
      langs: family(ref, board).map((m) => ({ id: m.id, lang: m.lang, self: m.self, href: hrefOf(m.id) })),
    },
    build: { version: VERSION, home: HOME },
    public: publish,
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
    sends: publish ? [] : st.sends.map((s) => ({ round: s.round, rev: s.rev, at: s.at, items: s.items, ...(s.key ? { key: s.key } : {}) })),
    chat: publish ? [] : chatOf(st),
    read: publish ? 0 : st.read,
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
    const others = s.items.filter((it) => it.kind !== 'note' && it.state !== 'untouched' && it.state !== 'held').length;
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

// The mark: a card with its tab. In a browser tab it is the page icon; the
// tab of the mark lights while an ask waits (runtime/board.js swaps it). The
// icon is its own small document, so the two inks are read from the tokens of
// board.css, for day and for night, and written into it.
// A token of board.css, by day or by night: for the few places outside the
// page's own CSS that need its colors (the icon, the browser's own chrome).
export function tokenOf(name, night = false) {
  const css = readRuntime('board.css');
  const from = night ? css.indexOf('prefers-color-scheme: dark') : 0;
  return css.slice(from).match(new RegExp(`${name}:\\s*([^;]+);`))[1].trim();
}
export function MARK(lit = false) {
  const [ink, sig, inkN, sigN] = [tokenOf('--fg'), tokenOf('--signal'), tokenOf('--fg', true), tokenOf('--signal', true)];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><style>.i{fill:${ink}}.t{fill:${lit ? sig : ink}}@media(prefers-color-scheme:dark){.i{fill:${inkN}}.t{fill:${lit ? sigN : inkN}}}</style>` +
    '<path class="t" d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.5A1.5 1.5 0 0 1 8 3v2.5H1.5z"/><path class="i" d="M1.5 5h11.5A1.5 1.5 0 0 1 14.5 6.5v6.5a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 13z"/></svg>';
}
const dataUri = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

// What a link preview and a browser tab show. A board has no public URL of
// its own, so there is no og:url and no og:image; the text is enough for a card.
function headTags(data) {
  const b = data.board;
  const desc = b.description || b.lede_text || '';
  const tags = [
    `<meta name="generator" content="cards ${esc(data.build.version)}">`,
    b.author && `<meta name="author" content="${esc(b.author)}">`,
    desc && `<meta name="description" content="${esc(desc)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${esc(b.title)}">`,
    desc && `<meta property="og:description" content="${esc(desc)}">`,
    `<meta name="twitter:card" content="summary">`,
    // The browser's own surfaces (the bar on a phone, the overscroll) take the rack's color.
    `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${tokenOf('--bg')}">`,
    `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${tokenOf('--bg', true)}">`,
    `<link rel="icon" type="image/svg+xml" href="${dataUri(MARK(false))}">`,
  ];
  return tags.filter(Boolean).join('\n');
}

// fontCss: the @font-face rules of a board that carries its own CJK font (lib/font.mjs).
export function pageHtml(data, { fontCss = '' } = {}) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
    .split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
  const fill = { lang: esc(data.board.lang), title: esc(data.board.title), css: readRuntime('board.css') + (fontCss ? `\n${fontCss}\n` : ''), head: headTags(data),
    noscript: esc(t(data.strings, 'noscript')),
    digest: readRuntime('digest.js'), js: readRuntime('board.js'), data: json };
  // Replace with a function: the payloads contain `$` sequences that must stay literal.
  return readRuntime('board.html').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in fill ? fill[k] : m));
}

// buildBoard(ref) -> { errors, warnings, data, html, sync }
export function buildBoard(ref, { live = false, token = null, write = true, cwd = process.cwd(), publish = false, chipHref = null, home = null } = {}) {
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
  const tr = translationChecks(ref, board);
  warnings.push(...tr.warnings);
  warnings.sort((x, y) => x.line - y.line);
  if (tr.errors.length) return { board, errors: tr.errors, warnings };
  // A page that leaves the machine is a copy: it records nothing. It still shows
  // board.org as it is now, so it is numbered as the next render would number it.
  const before = fold(readLog(ref.dir));
  const syncRes = sync(ref.dir, board, { write: !publish });
  // Which build renders this board now; said by the caller when it was another one.
  const marked = write && !publish ? markBuild(ref.dir, VERSION) : null;
  const built = marked && before.rev > 0 ? { from: before.build } : null;
  const st = fold(publish ? [...readLog(ref.dir), ...syncRes.events] : readLog(ref.dir));
  const data = pageData(board, st, ref, { live, token, cwd, publish, chipHref, home });
  // A Chinese, Japanese or Korean board carries a subset of an open font, when this machine can make one.
  const font = boardFont(board.lang, JSON.stringify([data.board, data.sections, data.cards, data.strings]));
  const html = pageHtml(data, { fontCss: font.css });
  if (write && !publish) {
    fs.writeFileSync(path.join(ref.dir, 'board.html'), html);
    // Said by the caller once, when it changes: the font is in the page, or it is not and why.
    if (font.state !== 'none' && markFont(ref.dir, font.state)) font.changed = true;
    // The list of this project's boards moves with every render.
    writeIndex(path.dirname(ref.dir));
  }
  return { board, errors: [], warnings, data, html, sync: syncRes, st, built, font };
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
      // What the card carries besides words: the page shows a picture at every level, a drawing from Gist up.
      const has = /data-kind="image"/.test(c.figure_html) ? '  [picture]' : c.figure_html ? '  [figure]' : '';
      lines.push(`    #${String(c.n).padEnd(3)} ${c.id.padEnd(18)} ${tag.padEnd(14)} ${c.title_text}${has}`);
    }
  }
  return lines.join('\n');
}

