// index.mjs -- the map of a project's boards.
//
// With more than one board, nobody remembers which one waits, or how the
// boards hang together. Each render also writes `.cards/index.html`: every
// board of the project as a tile on one table. A board names its group
// (`#+category:`), the boards it comes from (`#+from:`) and the boards it
// waits on (`#+needs:`); a link to a card on another board connects the two
// as well. The map frames each group and draws those lines. A tile shows the
// board's title, its description, its open asks and its first drawing; its
// title opens the board. Every board page links back to the map, and names
// the boards it connects to under its title. `cards serve` shows the map at `/`.
//
// The map is the board runtime in its map mode (B.kind = 'map'): the same desk,
// levels, lines, focus and keys. Your own layout of it lives in your browser.
//
//   scanProject(root)            -> [node]: the boards under root, each read once per change
//   mapData(root, opts)          -> the page data of the map
//   relatedOf(root, id, hrefOf)  -> [{ rel, boards }]: what a board page names under its title
//   resolveLink(root, b, c)      -> the board and card a link to another board names, or why not
//   projectChecks(ref, board)    -> warnings about the links between boards
//   writeIndex(root)             -> writes <root>/index.html

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseBoard, boardLinksOf, syntaxOf, slug, sectionId, ID_RE } from './board.mjs';
import { boardDirs, sourceIn, fold, readLog, unread } from './store.mjs';
import { esc } from './md.mjs';
import { renderFigure } from './figure.mjs';
import { strings as uiStrings, t } from './i18n.mjs';
import { pageHtml } from './compile.mjs';
import { VERSION, HOME } from './version.mjs';
import '../runtime/digest.js';

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const stamp = (f) => { try { const s = fs.statSync(f); return `${s.mtimeMs}:${s.size}`; } catch { return '-'; } };

// A board is read again only when its source or its log changed: one render of one
// board reads the others for the map, and for the links under its title.
const CACHE = new Map();
export function scanProject(root) {
  return boardDirs(root).map((id) => {
    const dir = path.join(root, id);
    const file = sourceIn(dir);
    const key = [file, path.join(dir, 'log.jsonl'), path.join(dir, 'board.html')].map(stamp).join('|');
    const hit = CACHE.get(dir);
    if (hit && hit.key === key) return hit.node;
    let node;
    // One board that cannot be read is one tile that says so, never the end of the map.
    try {
      const board = parseBoard(fs.readFileSync(file, 'utf8'), { id, file });
      node = { id, dir, file, board, st: fold(readLog(dir)), broken: board.errors.length > 0 };
    } catch {
      node = { id, dir, file, board: null, st: fold([]), broken: true };
    }
    node.rendered = isFile(path.join(dir, 'board.html'));
    CACHE.set(dir, { key, node });
    return node;
  });
}

// The numeral a card has, or will have at the next render of its board (store.mjs, numeralsOf).
function numerals(node) {
  let next = node.st.nextN;
  const out = new Map();
  for (const c of node.board ? node.board.cards : []) if (!out.has(c.id)) out.set(c.id, node.st.cards.get(c.id)?.n ?? next++);
  return (id) => out.get(id) ?? '?';
}

// A translation is the same board in another language: one tile, with a link per language.
// rootsOf(nodes) -> Map(id -> the board it translates, followed to the first board that
// translates none). A board that is no translation, or one in a loop, is its own root.
function rootsOf(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map();
  for (const n of nodes) {
    let at = n;
    const seen = new Set([n.id]);
    while (at.board && at.board.translationOf && byId.has(at.board.translationOf) && !seen.has(at.board.translationOf)) {
      at = byId.get(at.board.translationOf);
      seen.add(at.id);
    }
    // A loop has no source to stand for it: each board in it stands alone.
    out.set(n.id, at.board && at.board.translationOf && seen.has(at.board.translationOf) ? n.id : at.id);
  }
  return out;
}

// The edges between boards, from what each board says of itself. A board named by its
// translation stands for the tile of its source.
function edgesOf(node, ids, roots = null) {
  const b = node.board;
  if (!b) return { from: [], needs: [], links: [] };
  const me = roots ? roots.get(node.id) : node.id;
  const keep = (list) => [...new Set(list.filter((x) => ids.has(x)).map((x) => (roots ? roots.get(x) : x)))].filter((x) => x !== node.id && x !== me);
  const from = keep(b.fromBoards);
  const needs = keep(b.needsBoards).filter((x) => !from.includes(x));
  const links = keep(boardLinksOf(b).map((l) => l.board)).filter((x) => !from.includes(x) && !needs.includes(x));
  return { from, needs, links };
}

// The asks of a board that wait on the human now, as its page counts them (runtime/board.js,
// gate): open, with no answer at the card's version, and not held by an ask it needs.
function waitingAsks(node) {
  const b = node.board;
  const answered = globalThis.cardsAnswered(node.st.sends);
  const vOf = (id) => node.st.cards.get(id)?.v ?? 1;
  const byId = new Map(b.cards.map((c) => [c.id, c]));
  const isOpen = (c) => c.ask && c.status !== 'done';
  // The last answer the human sent on an ask, at any version: its values, or null.
  const lastAnswer = (c) => {
    for (let i = node.st.sends.length - 1; i >= 0; i--) {
      const it = node.st.sends[i].items.filter((x) => x.card === c.id && x.kind === c.ask && x.state !== 'untouched')[0];
      if (it) return it.state === 'held' ? null : it.value === undefined ? ['*'] : [].concat(it.value);
    }
    return null;
  };
  const suggested = (c, vals) => {
    if (c.ask === 'choose') { const def = c.anatomy.options.filter((o) => o.default).map((o) => o.value); return !def.length || (def.length === vals.length && def.every((v) => vals.includes(v))); }
    if (c.ask === 'approve') return vals[0] === 'approve';
    if (c.ask === 'do') return vals[0] === 'done';
    return true;
  };
  const held = (c) => (c.needs || []).some((id) => {
    const u = byId.get(id);
    if (!u || !u.ask) return false;
    const want = (c.when || {})[id];
    if (isOpen(u) && !answered.has(`${u.id}@${vOf(u.id)}`)) return true;
    if (want === '*') return false;
    const vals = lastAnswer(u);
    if (!vals) return isOpen(u);
    if (want) return !vals.includes(want);
    return !suggested(u, vals);
  });
  return b.cards.filter((c) => isOpen(c) && !answered.has(`${c.id}@${vOf(c.id)}`) && !held(c));
}

// The storage of the map in the browser is its own for each project: the pages of every
// project share one origin when they are files.
const mapKey = (root) => `map:${crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 12)}`;

export function mapData(root, { live = false, name = null } = {}) {
  const nodes = scanProject(root);
  const ids = new Set(nodes.map((n) => n.id));
  const roots = rootsOf(nodes);
  const shown = nodes.filter((n) => roots.get(n.id) === n.id);
  // The chrome speaks the language most of the boards are written in.
  const langs = new Map();
  for (const n of shown) if (n.board) langs.set(n.board.lang, (langs.get(n.board.lang) || 0) + 1);
  const lang = [...langs].sort((a, b) => b[1] - a[1] || (a[0] === 'en' ? -1 : 1))[0]?.[0] || 'en';
  const ui = uiStrings(lang);
  const tr = (key, vars) => t(ui.strings, key, vars);
  const href = (id, card = null) => {
    const node = nodes.find((n) => n.id === id);
    if (live ? !ID_RE.test(id) : !(node && node.rendered)) return '';
    return (live ? `/b/${encodeURIComponent(id)}` : `${encodeURIComponent(id)}/board.html`) + (card ? `#c-${card}` : '');
  };

  const cards = {};
  const born = new Map();
  for (const n of shown) {
    const b = n.board;
    const at = [...n.st.revs.map((r) => r.at), ...n.st.sends.map((s) => s.at)].filter(Boolean).sort();
    born.set(n.id, at[0] || '~');
    const own = nodes.filter((m) => m !== n && roots.get(m.id) === n.id);
    const family = own.length ? [n, ...own].map((m) => ({ id: m.id, lang: m.board ? m.board.lang : 'en', href: href(m.id), self: m === n })) : [];
    if (!b) {
      cards[n.id] = tileOf(n.id, { title: n.id, text: n.id, group: '', status: 'open', broken: true, href: href(n.id), at: at[at.length - 1] || '', langs: family }, tr);
      continue;
    }
    const sx = syntaxOf(b.fmt);
    const nOf = numerals(n);
    const asks = waitingAsks(n).map((c) => ({ id: c.id, n: nOf(c.id), title: sx.plain(c.title), kind: c.ask, href: href(n.id, c.id) }));
    const done = b.cards.filter((c) => c.status === 'done').length;
    const states = b.cards.some((c) => c.status === 'done' || c.status === 'doing');
    // The board's first drawing: its first sheet that is not done, drawn by the compiler as on the board.
    const sheet = b.cards.find((c) => c.sheet && c.status !== 'done' && c.anatomy.figure && c.anatomy.figure.type === 'code');
    let figure = '';
    if (sheet) {
      try { figure = renderFigure(sheet.anatomy.figure, null, { t: tr, inline: sx.inline, plain: sx.plain, room: 'sheet' }).html; } catch { figure = ''; }
    }
    const gist = b.description || sx.plain(b.lede).slice(0, 240);
    const edges = edgesOf(n, ids, roots);
    const sections = b.sections.filter((s) => s.cards.length);
    cards[n.id] = tileOf(n.id, {
      title: b.title,
      group: (b.category || own.map((m) => m.board && m.board.category).find(Boolean) || '').replace(/\s+/g, ' ').trim(),
      gist,
      figure,
      sheetN: sheet ? nOf(sheet.id) : null,
      sheetTitle: sheet ? sx.plain(sheet.title) : '',
      text: [b.title, gist, b.category, n.id, ...asks.map((a) => a.title), ...sections.map((s) => sx.plain(s.title))].filter(Boolean).join(' '),
      status: b.cards.length && done === b.cards.length ? 'done' : 'open',
      progress: states && b.cards.length ? { done, total: b.cards.length } : null,
      outline: sections.map((s) => ({ title: sx.plain(s.title), n: s.cards.length })),
      asks,
      rev: n.st.rev,
      cards: b.cards.length,
      unread: unread(n.st).length,
      at: at[at.length - 1] || '',
      broken: n.broken,
      href: href(n.id),
      langs: family,
      lang: b.lang,
      ...edges,
    }, tr);
  }

  // Groups: a frame for each category; the boards that name none lie outside every frame.
  // "Ingest" and "ingest" are one group, named as its oldest board names it. The oldest
  // group first; in a group a board comes after the boards it comes from.
  const groups = new Map();
  const byAge = shown.slice().sort((a, b) => String(born.get(a.id)).localeCompare(String(born.get(b.id))) || a.id.localeCompare(b.id));
  for (const n of byAge) {
    const name = cards[n.id].map.group;
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { title: name, ids: [] });
    groups.get(key).ids.push(n.id);
  }
  const first = (g) => g.ids.map((id) => born.get(id)).sort()[0];
  const order = [...groups.entries()].sort(([a, x], [b, y]) => (a === '') - (b === '') || String(first(x)).localeCompare(String(first(y))) || a.localeCompare(b));
  // A frame's id names it in the human's own layout: the same group keeps it from render to render.
  const taken = new Set(['boards']);
  const sections = order.map(([key, g]) => {
    let id = key ? `g-${/[a-z0-9]/i.test(key) ? slug(key) : sectionId(key)}` : 'boards';
    if (key) for (let k = 2; taken.has(id); k++) id = `g-${/[a-z0-9]/i.test(key) ? slug(key) : sectionId(key)}-${k}`;
    taken.add(id);
    return { id, title: g.title, note_html: '', layout: 'grid', frame: !!key, cards: lineage(g.ids, cards, born) };
  });
  for (const s of sections) for (const id of s.cards) { cards[id].section = s.id; cards[id].map.group = s.title; }

  const waiting = Object.values(cards).reduce((k, c) => k + c.map.asks.length, 0);
  const project = path.basename(path.dirname(root)) || 'this project';
  return {
    format: 1,
    kind: 'map',
    board: {
      id: '',
      title: name || tr('map_title', { project }),
      lang,
      author: '',
      description: '',
      lede_html: '',
      lede_text: '',
      rev: 0,
      path: path.join(path.basename(root), 'index.html'),
      key: mapKey(root),
      home: '',
      langs: [],
      boards: shown.length,
      groups: sections.filter((s) => s.frame).length,
      waiting,
    },
    build: { version: VERSION, home: HOME },
    public: false,
    sections,
    cards,
    strings: ui.strings,
    sends: [],
    chat: [],
    read: 0,
    live: false,
    token: null,
  };
}

// In a group, a board comes after the boards it comes from or waits on; else the older first.
function lineage(ids, cards, born) {
  const out = [];
  const seen = new Set();
  const visit = (id, trail = new Set()) => {
    if (seen.has(id) || trail.has(id)) return;
    trail.add(id);
    for (const up of [...cards[id].from, ...cards[id].needs].filter((x) => ids.includes(x)).sort((a, b) => String(born.get(a)).localeCompare(String(born.get(b))))) visit(up, trail);
    seen.add(id);
    out.push(id);
  };
  for (const id of ids.slice().sort((a, b) => String(born.get(a)).localeCompare(String(born.get(b))) || a.localeCompare(b))) visit(id);
  return out;
}

// One tile: the shape of a card for the runtime (runtime/board.js), with what a board adds under `map`.
function tileOf(id, o, tr) {
  const asks = o.asks || [];
  const outline = (o.outline || []).map((s) => `<li><span>${esc(s.title)}</span><span class="count">${s.n}</span></li>`).join('');
  return {
    id,
    n: id,
    v: o.rev || 0,
    rev: o.rev || 0,
    section: '',
    title_html: esc(o.title),
    title_text: o.title,
    text: o.text.slice(0, 2000),
    gist_html: o.gist ? `<p>${esc(o.gist)}</p>` : '',
    figure_html: o.figure || '',
    fig_w: 0,
    tbl_w: 0,
    wide: false,
    facts: [],
    depth_html: outline ? `<ul class="tile-secs" aria-label="${esc(tr('tile_sections'))}">${outline}</ul>` : '',
    options: [],
    ask: null,
    status: o.status,
    basis: null,
    from: o.from || [],
    needs: o.needs || [],
    when: {},
    refs: o.links || [],
    tags: [],
    sheet: false,
    on: [],
    multi: false,
    suggest: null,
    progress: o.progress || null,
    history: [],
    map: {
      href: o.href,
      group: o.group,
      asks,
      cards: o.cards || 0,
      unread: o.unread || 0,
      at: o.at,
      broken: !!o.broken,
      langs: o.langs || [],
      lang: o.lang || 'en',
      sheet: o.sheetN === null || o.sheetN === undefined ? null : { n: o.sheetN, title: o.sheetTitle },
    },
  };
}

// relatedOf(root, id, hrefOf) -> [{ rel, boards: [{ id, title, href }] }]: the boards this
// board comes from, waits on and links to, and the boards that say so of it.
export function relatedOf(root, id, hrefOf) {
  const nodes = scanProject(root);
  const ids = new Set(nodes.map((n) => n.id));
  const me = nodes.find((n) => n.id === id);
  if (!me || !me.board) return [];
  const mine = edgesOf(me, ids);
  const theirs = nodes.filter((n) => n !== me && n.board).map((n) => [n, edgesOf(n, ids)]);
  const back = (key) => theirs.filter(([, e]) => e[key].includes(id)).map(([n]) => n.id);
  const followups = back('from');
  const blocks = back('needs').filter((x) => !followups.includes(x));
  const linked = back('links').filter((x) => !followups.includes(x) && !blocks.includes(x) && !mine.from.includes(x) && !mine.needs.includes(x) && !mine.links.includes(x));
  const title = (x) => {
    const n = nodes.find((m) => m.id === x);
    return n && n.board ? syntaxOf(n.board.fmt).plain(n.board.title) : x;
  };
  return [['from', mine.from], ['needs', mine.needs], ['followups', followups], ['blocks', blocks], ['links', mine.links], ['linked', linked]]
    .filter(([, list]) => list.length)
    .map(([rel, list]) => ({ rel, boards: list.map((x) => ({ id: x, title: title(x), href: hrefOf(x) })) }));
}

// resolveLink(root, board, card) -> { node, card, n, title } | { missing: 'board' | 'card' }
export function resolveLink(root, board, card) {
  const node = scanProject(root).find((n) => n.id === board);
  if (!node || !node.board) return { missing: 'board' };
  if (!card) return { node, title: node.board.title };
  const c = node.board.cards.find((x) => x.id === card);
  if (!c) return { missing: 'card', node };
  return { node, card: c, n: numerals(node)(card), title: c.title, fmt: node.board.fmt };
}

// Warnings about the links between boards. Each says what is wrong and the line to write.
export function projectChecks(ref, board) {
  const warnings = [];
  if (!ref || !ref.dir || !board) return warnings;
  const root = path.dirname(ref.dir);
  const nodes = scanProject(root).filter((n) => n.id !== ref.id);
  if (!nodes.length) return warnings;
  const ids = new Set(nodes.map((n) => n.id));
  const here = `boards here: ${[...ids].slice(0, 12).join(', ')}`;
  const warn = (line, msg) => warnings.push({ line, msg });
  for (const [key, list] of [['from', board.fromBoards], ['needs', board.needsBoards]]) {
    for (const x of list) {
      if (x === ref.id) warn(board.keyLines[key] || 1, `#+${key}: names this board itself; remove ${x}`);
      else if (!ids.has(x)) warn(board.keyLines[key] || 1, `#+${key}: ${x} names no board of this project (${here})`);
    }
  }
  const said = new Set();
  for (const l of boardLinksOf(board)) {
    const key = `${l.board}#${l.card || ''}`;
    if (said.has(key)) continue;
    said.add(key);
    if (l.board === ref.id) { warn(l.line, `a link to ${l.board}/board.org is a link to this board: write ${l.card ? `[[#${l.card}]]` : 'a card reference, [[#id]]'}`); continue; }
    const node = nodes.find((n) => n.id === l.board);
    if (!node) { warn(l.line, `a link names the board ${l.board}, which this project does not have (${here})`); continue; }
    if (l.card && node.board && !node.board.cards.some((c) => c.id === l.card)) {
      warn(l.line, `a link names the card ${l.card} on ${l.board}, which that board does not have (cards there: ${node.board.cards.slice(0, 10).map((c) => c.id).join(', ')})`);
    }
  }
  // Another board named as code is a link nobody can follow: said once per card and board.
  if (board.fmt === 'org') {
    for (const c of board.cards) {
      const text = `${c.title}\n${String(c.body).replace(/^\s*#\+begin_(\w+)[\s\S]*?^\s*#\+end_\1\s*$/gim, '')}`;
      const named = new Set();
      for (const m of text.matchAll(/(^|[\s(])[=~]([a-z0-9][a-z0-9-]{0,47})[=~](?=[\s.,;:!?)]|$)/gm)) {
        // Only a name no word has: one with a dash or a digit. =plan= or =api= may be code.
        if (!ids.has(m[2]) || named.has(m[2]) || !/[-\d]/.test(m[2])) continue;
        named.add(m[2]);
        warn(c.line, `${c.id} names the board ${m[2]} as code, and the reader cannot follow it; link it: [[file:../${m[2]}/board.org][${m[2]}]], or a card there: [[file:../${m[2]}/board.org::#id]]`);
      }
    }
  }
  // A board with no group, in a project whose other boards name theirs, lies outside every frame.
  if (board.fmt === 'org' && !board.category && !board.translationOf) {
    const cats = [...new Set(nodes.filter((n) => n.board && n.board.category && !n.board.translationOf).map((n) => n.board.category))];
    if (cats.length) warn(1, `the other boards of this project name their group, and this one lies outside every group on the map: ${cats.slice(0, 4).map((c) => `#+category: ${c}`).join(', or ')}`);
  }
  return warnings;
}

// The index is written into a boards directory only: `.cards`, or the one CARDS_ROOT names.
export const isBoardsRoot = (root) => path.basename(root) === '.cards' || (process.env.CARDS_ROOT && path.resolve(process.env.CARDS_ROOT) === root);

// The map is ours to write only where no index.html is, or where the one that is
// there is a page we wrote: it says so in its head. (A list of an earlier build has
// only the generator tag; a board page has that tag too, and is not a list.) An
// empty file is a write that was cut short. CARDS_ROOT may name a directory that
// holds a page of its own, or a board exported there as index.html.
export function ownsIndex(root) {
  if (!isBoardsRoot(root)) return false;
  let page;
  try { page = fs.readFileSync(path.join(root, 'index.html'), 'utf8'); } catch (e) { return e.code === 'ENOENT'; }
  if (!page.trim()) return true;
  return /<meta name="cards-page" content="boards">/.test(page) || (/<meta name="generator" content="cards /.test(page) && !/id="board-data"/.test(page));
}

export function mapHtml(root, opts = {}) {
  return pageHtml(mapData(root, opts));
}

// Never throws: the map is a convenience, and a render must not fail for it.
export function writeIndex(root) {
  if (!ownsIndex(root)) return null;
  const file = path.join(root, 'index.html');
  try {
    fs.writeFileSync(file, mapHtml(root));
    return file;
  } catch { return null; }
}
