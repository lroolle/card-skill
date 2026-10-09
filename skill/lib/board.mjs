// board.mjs -- parse a board source into a board model.
//
// Two source formats give one model. board.org is the format agents write
// (reference/format.md); board.md is the older markdown dialect, still read so
// old boards and old log entries render.
//
//   #+title: ...                 ---/title: ...        the board title
//   * Section  :compare:         # Section {compare}   a section
//   ** DOING Claim [3/7] :tag:   ## Claim {#id ...}    a card; the heading is the claim
//   :PROPERTIES: drawer          {...} attributes      id, ask, basis, from, needs
//   First paragraph              First paragraph       the gist
//   Everything after             Everything after      the depth
//
// Every error carries a line number and a corrected example, because the
// reader of an error is usually an agent that will retry once.

import { parseBlocks, plain, fenceOpen, fenceCloses, inline, renderBlocks, esc } from './md.mjs';
import { parseOrgBlocks, orgInline, orgPlain, orgRefs } from './org.mjs';
import { FIGURE_LANGS, parseFlow, sketchLines, isFigure } from './figure.mjs';

// do: an action only the human can take outside the board (a login, a payment);
// the answer is done or cannot.
export const ASKS = ['choose', 'approve', 'answer', 'do'];
export const STATUSES = ['open', 'doing', 'done', 'blocked'];
export const BASES = ['fact', 'inference', 'guess'];
export const LAYOUTS = ['grid', 'compare', 'list'];
export const CARD_KEYS = ['ask', 'status', 'basis', 'from', 'needs', 'progress'];
export const CARD_FLAGS = ['multi'];
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

const HEAD_RE = /^(#{1,2})\s+(.*?)\s*$/;
const ATTR_RE = /\s*\{([^{}]*)\}\s*$/;
const REF_RE = /\[\[([^\]\s|]+)\]\]/g;

// The text layer of each format: block parser, inline renderer, plain text, references.
const mdRefs = (s) => [...String(s).replace(/(`+)[\s\S]*?\1/g, '').matchAll(REF_RE)].map((m) => m[1]);
const SYNTAX = {
  md: { fmt: 'md', blocks: parseBlocks, inline, plain, refs: mdRefs },
  org: { fmt: 'org', blocks: (s) => parseOrgBlocks(s), inline: orgInline, plain: orgPlain, refs: orgRefs },
};
export const syntaxOf = (fmt) => SYNTAX[fmt] || SYNTAX.md;

// The format of a source: told by the caller (the file extension), else sniffed.
export function formatOf(src, file = '') {
  if (/\.org$/i.test(file)) return 'org';
  if (/\.md$/i.test(file)) return 'md';
  const s = String(src);
  if (/^---\s*$/m.test(s.split('\n')[0] || '')) return 'md';
  return /^#\+title:/im.test(s) || /^\*{1,2}\s/m.test(s) ? 'org' : 'md';
}

export const slug = (s) =>
  plain(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'card';
// A section's default id. A title with no Latin letters or digits ("选项")
// has no slug; it gets a short hash of the title, so it stays the same when
// sections move (reorder answers and desk places name sections by id).
const sectionId = (title) => {
  if (/[a-z0-9]/i.test(plain(title))) return slug(title);
  let h = 0x811c9dc5;
  for (const ch of String(title)) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return `section-${h.toString(16).padStart(8, '0').slice(0, 6)}`;
};

function parseAttrs(text) {
  const out = { id: null, tags: [], kv: {}, flags: [], bad: [] };
  for (const tok of text.trim().split(/\s+/).filter(Boolean)) {
    if (tok.startsWith('#')) out.id = tok.slice(1);
    else if (tok.startsWith('.')) out.tags.push(tok.slice(1));
    else if (tok.includes('=')) {
      const k = tok.slice(0, tok.indexOf('='));
      out.kv[k] = tok.slice(tok.indexOf('=') + 1);
    } else out.flags.push(tok);
  }
  return out;
}

const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

// boardTitle(src) -> the title, or null. One reader for every caller.
export function boardTitle(src, file = '') {
  if (formatOf(src, file) === 'org') return String(src).match(/^#\+title:\s*(.*?)\s*$/im)?.[1] || null;
  const { meta } = frontmatter(String(src).replace(/\r\n?/g, '\n').split('\n'));
  return meta?.title || null;
}

function frontmatter(lines) {
  if (lines[0]?.trim() !== '---') return { meta: null, body: 0 };
  const meta = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return { meta, body: i + 1 };
    const m = lines[i].match(/^([\w-]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta: null, body: 0 };
}

// parseBoard(src, { id, fmt }) -> { fmt, title, lang, lede, sections, cards, errors }
export function parseBoard(src, { id = 'board', fmt = null, file = '' } = {}) {
  const board = (fmt || formatOf(src, file)) === 'org' ? parseOrgBoard(src, id) : parseMdBoard(src, id);
  crossChecks(board);
  board.errors.sort((a, b) => a.line - b.line);
  return board;
}

function parseMdBoard(src, id) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const errors = [];
  const err = (line, msg, fix) => errors.push({ line: line + 1, msg, fix });

  const { meta, body } = frontmatter(lines);
  if (!meta || !meta.title) {
    err(0, 'board has no title', '---\ntitle: Pick a queue for ingest\n---');
  }
  const board = {
    id,
    fmt: 'md',
    title: meta?.title || id,
    lang: meta?.lang || 'en',
    author: '', description: '', translationOf: '', unknown: [],
    lede: '',
    sections: [],
    cards: [],
    errors,
  };

  // Split into heading-delimited chunks, ignoring headings inside fences.
  const chunks = [];
  let cur = { level: 0, line: body - 1, head: '', lines: [] };
  let fence = null;
  for (let i = body; i < lines.length; i++) {
    const line = lines[i];
    if (fence) { if (fenceCloses(line, fence)) fence = null; cur.lines.push(line); continue; }
    fence = fenceOpen(line);
    const h = !fence && line.match(HEAD_RE);
    if (h) {
      chunks.push(cur);
      cur = { level: h[1].length, line: i, head: h[2], lines: [] };
    } else cur.lines.push(line);
  }
  chunks.push(cur);

  let section = null;
  const ensureSection = (line) => {
    if (!section) {
      section = { id: '', title: '', note: '', layout: 'grid', line, cards: [] };
      board.sections.push(section);
    }
    return section;
  };

  for (const c of chunks) {
    const text = c.lines.join('\n').trim();
    if (c.level === 0) { board.lede = text; continue; }
    const am = c.head.match(ATTR_RE);
    const title = (am ? c.head.slice(0, am.index) : c.head).trim();
    const attrs = parseAttrs(am ? am[1] : '');
    const headLine = lines[c.line];

    if (c.level === 1) {
      const layout = attrs.flags.find((f) => LAYOUTS.includes(f)) || 'grid';
      for (const f of attrs.flags) {
        if (!LAYOUTS.includes(f)) err(c.line, `unknown section flag "${f}"`, `# ${title} {compare}   (flags: ${LAYOUTS.join(', ')})`);
      }
      for (const k of Object.keys(attrs.kv)) err(c.line, `sections take no "${k}="`, `# ${title} {list}`);
      section = { id: attrs.id || sectionId(title), title, note: text, layout, line: c.line + 1, cards: [] };
      board.sections.push(section);
      continue;
    }

    // ---- a card ----
    const s = ensureSection(c.line + 1);
    if (!title) err(c.line, 'card has an empty claim', '## NATS covers the peak with one binary {#nats}');
    if (!attrs.id) {
      err(c.line, 'card has no id', `${headLine.replace(ATTR_RE, '').trimEnd()} {#${slug(title)}${am ? ' ' + am[1].trim() : ''}}`);
    } else if (!ID_RE.test(attrs.id)) {
      err(c.line, `id "${attrs.id}" must be lowercase letters, digits and dashes`, `## ${title} {#${slug(attrs.id)}}`);
    }
    for (const k of Object.keys(attrs.kv)) {
      if (!CARD_KEYS.includes(k)) err(c.line, `unknown key "${k}="`, `allowed: ${CARD_KEYS.join(', ')}, #id, .tag, multi`);
    }
    for (const f of attrs.flags) {
      if (!CARD_FLAGS.includes(f)) err(c.line, `unknown flag "${f}"`, `allowed flags: ${CARD_FLAGS.join(', ')} (did you mean ask=${f}?)`);
    }
    const kv = attrs.kv;
    const enumCheck = (key, allowed) => {
      if (kv[key] !== undefined && !allowed.includes(kv[key])) {
        err(c.line, `${key}=${kv[key]} is not one of ${allowed.join(', ')}`, `## ${title} {#${attrs.id || slug(title)} ${key}=${allowed[0]}}`);
      }
    };
    enumCheck('ask', ASKS);
    enumCheck('status', STATUSES);
    enumCheck('basis', BASES);
    let progress = null;
    if (kv.progress !== undefined) {
      const pm = kv.progress.match(/^(\d+)\/(\d+)$/);
      if (!pm || +pm[2] === 0 || +pm[1] > +pm[2]) err(c.line, `progress=${kv.progress} must be done/total`, 'progress=3/7');
      else progress = { done: +pm[1], total: +pm[2] };
    }
    const multi = attrs.flags.includes('multi');
    if (multi && kv.ask !== 'choose') err(c.line, 'multi only applies to ask=choose', `## ${title} {#${attrs.id || slug(title)} ask=choose multi}`);
    for (const t of attrs.tags) {
      if (!ID_RE.test(t)) err(c.line, `tag ".${t}" must be lowercase letters, digits and dashes`, '.perf .security');
    }

    const card = {
      id: attrs.id || slug(title),
      title,
      line: c.line + 1,
      section: s.id,
      ask: kv.ask || null,
      status: kv.status || 'open',
      basis: kv.basis || null,
      from: list(kv.from),
      needs: list(kv.needs),
      when: {},
      tags: attrs.tags,
      multi,
      suggest: null,
      progress,
      body: text,
      bodyLine: c.line + 2 + Math.max(0, c.lines.findIndex((l) => l.trim())),
      src: [headLine, ...c.lines].join('\n').trim(),
      fmt: 'md',
    };
    card.anatomy = anatomy(card);
    if (card.ask === 'choose') {
      const opts = card.anatomy.options;
      const ex = `## ${title} {#${card.id} ask=choose}\n- [x] The option you recommend\n- [ ] Another option`;
      if (opts.length < 2) err(c.line, 'ask=choose needs at least two options written as a task list', ex);
      if (!multi && opts.filter((o) => o.default).length > 1) err(c.line, 'single choice has more than one [x]; add multi or keep one', ex);
    }
    board.cards.push(card);
    s.cards.push(card.id);
  }

  return board;
}

// ---- board.org ----

const TODO = { TODO: 'open', DOING: 'doing', BLOCKED: 'blocked', DONE: 'done' };
const ORG_CARD_PROPS = ['CUSTOM_ID', 'ASK', 'MULTI', 'SUGGEST', 'BASIS', 'FROM', 'NEEDS', 'ID'];
// The keywords before the first heading that this build reads. Any other is
// valid Org and does nothing here; lint says so, because an agent that wrote
// one expected an effect.
export const ORG_KEYWORDS = ['title', 'language', 'lang', 'author', 'description', 'translation_of'];
// Org's own settings for Emacs (how the file folds, exports, cycles its TODO
// keywords). They are for the editor, so they pass without a word.
const ORG_SETTINGS = ['todo', 'seq_todo', 'typ_todo', 'startup', 'options', 'filetags', 'tags', 'property', 'priorities', 'columns',
  'archive', 'link', 'setupfile', 'category', 'macro', 'select_tags', 'exclude_tags', 'bibliography', 'cite_export'];
// Properties Emacs writes into a drawer on its own. They are not ours and not errors.
const ORG_OWNED = /^(ID|VISIBILITY|ORDERED|NOBLOCKING|COOKIE_DATA|LOGGING|CATEGORY|ARCHIVE|DIR|ATTACH_DIR|EFFORT|STYLE|LAST_REPEAT|CREATED|ARCHIVE_\w+|EXPORT_\w+|\w+_ALL)$/;
const PLANNING_RE = /^\s*(CLOSED|SCHEDULED|DEADLINE):\s/;
const orgList = (v) => (v ? v.split(/[\s,]+/).map((x) => x.replace(/^#/, '')).filter(Boolean) : []);
// :NEEDS: a b=link c=*  ->  the cards this one waits on, and for an ask that
// waits on an ask, which answer it is written for: none named (the one the
// agent suggested), a value (that answer only), or * (any answer).
function orgNeeds(v) {
  const when = {};
  const ids = orgList(v).map((x) => {
    const k = x.indexOf('=');
    if (k < 0) return x;
    when[x.slice(0, k)] = x.slice(k + 1);
    return x.slice(0, k);
  });
  return { ids, when };
}

// A heading line: * or ** stars, then [TODO] [#A] Title [3/7] :tag:tag:
function orgHead(text) {
  let rest = text;
  let todo = null;
  const k = rest.match(/^(TODO|DOING|BLOCKED|DONE)(?:\s+|$)/);
  if (k) { todo = k[1]; rest = rest.slice(k[0].length); }
  rest = rest.replace(/^\[#[A-Z0-9]\]\s+/, '');
  let tags = [];
  const t = rest.match(/\s+:([^\s:]+(?::[^\s:]+)*):$/);
  if (t) { tags = t[1].split(':'); rest = rest.slice(0, t.index); }
  let progress = null;
  const c = rest.match(/\s*\[(\d+)\/(\d+)\]$/) || rest.match(/\s*\[(\d+)%\]$/);
  if (c) {
    progress = c[2] !== undefined ? { done: +c[1], total: +c[2] } : { done: +c[1], total: 100 };
    rest = rest.slice(0, c.index);
  }
  return { todo, tags, progress, title: rest.trim(), cookie: c ? c[0].trim() : '' };
}

// The property drawer right after a heading -> { props, start, end } (line offsets in `lines`).
// A planning line (CLOSED: SCHEDULED: DEADLINE:) may stand between the two,
// where Emacs writes it; it is not card text.
function drawer(lines) {
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const gap = i > 0;
  const planned = PLANNING_RE.test(lines[i] || '');
  if (planned) i++;
  if (lines[i]?.trim().toUpperCase() !== ':PROPERTIES:') return { props: {}, rest: planned ? lines.slice(i) : lines, at: [] };
  const props = {};
  const at = [];
  let j = i + 1;
  for (; j < lines.length && lines[j].trim().toUpperCase() !== ':END:'; j++) {
    const m = lines[j].match(/^\s*:([\w-]+):\s*(.*?)\s*$/);
    if (m) { props[m[1].toUpperCase()] = m[2]; at.push([m[1].toUpperCase(), j]); }
  }
  return { props, rest: lines.slice(j + 1), at, open: j >= lines.length, gap };
}

function parseOrgBoard(src, id) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const errors = [];
  const err = (line, msg, fix) => errors.push({ line: line + 1, msg, fix });
  const board = { id, fmt: 'org', title: id, lang: 'en', author: '', description: '', translationOf: '', unknown: [], todo: null, lede: '', sections: [], cards: [], errors };

  // Split into heading chunks (levels 1 and 2), ignoring headings inside blocks.
  // Deeper headings stay in the card body as subheadings.
  const chunks = [];
  let cur = { level: 0, line: -1, head: '', lines: [] };
  let block = null;
  lines.forEach((line, i) => {
    if (block) { if (new RegExp(`^\\s*#\\+end_${block}\\s*$`, 'i').test(line)) block = null; cur.lines.push(line); return; }
    const b = line.match(/^\s*#\+begin_(\w+)/i);
    if (b) { block = b[1]; cur.lines.push(line); return; }
    const h = line.match(/^(\*{1,2})\s+(.*?)\s*$/);
    if (h) { chunks.push(cur); cur = { level: h[1].length, line: i, head: h[2], lines: [] }; return; }
    cur.lines.push(line);
  });
  chunks.push(cur);

  // Before the first heading: #+keywords and the lede.
  const lede = [];
  chunks[0].lines.forEach((line, k) => {
    const m = line.match(/^#\+(\w+):\s*(.*?)\s*$/);
    if (m) {
      const key = m[1].toLowerCase();
      if (key === 'title') board.title = m[2];
      else if (key === 'language' || key === 'lang') board.lang = m[2] || 'en';
      else if (key === 'author') board.author = m[2];
      else if (key === 'description') board.description = m[2];
      else if (key === 'translation_of') {
        board.translationOf = m[2];
        if (!ID_RE.test(m[2])) err(k, `#+translation_of: "${m[2]}" must be the name of a board`, '#+translation_of: pick-a-queue');
      } else if (key === 'todo' || key === 'seq_todo' || key === 'typ_todo') board.todo = `${board.todo || ''} ${m[2]}`;
      else if (!ORG_SETTINGS.includes(key)) board.unknown.push({ line: k + 1, what: `#+${m[1]}:` });
    } else lede.push(line);
  });
  board.lede = lede.join('\n').trim();
  if (!/^#\+title:\s*\S/im.test(chunks[0].lines.join('\n'))) {
    err(0, 'board has no title', '#+title: Pick a queue for ingest');
  }

  let section = null;
  const ensureSection = (line) => {
    if (!section) {
      section = { id: '', title: '', note: '', layout: 'grid', line, cards: [] };
      board.sections.push(section);
    }
    return section;
  };

  for (const c of chunks.slice(1)) {
    const headLine = lines[c.line];
    if (/\{[^{}]*\}\s*$/.test(c.head)) {
      err(c.line, 'org headings take no {...} attributes', '** The claim\n:PROPERTIES:\n:CUSTOM_ID: the-id\n:BASIS: inference\n:END:');
      continue;
    }
    const h = orgHead(c.head);
    const d = drawer(c.lines);
    if (d.open) err(c.line, ':PROPERTIES: drawer has no :END:', ':PROPERTIES:\n:CUSTOM_ID: the-id\n:END:');
    const text = d.rest.join('\n').trim();

    if (c.level === 1) {
      const layout = h.tags.find((t) => t === 'compare' || t === 'list') || 'grid';
      for (const t of h.tags) {
        if (t !== 'compare' && t !== 'list') err(c.line, `unknown section tag ":${t}:"`, `* ${h.title}  :compare:   (tags: compare, list)`);
      }
      if (h.todo || h.cookie) err(c.line, 'a section takes no TODO keyword or [n/m] cookie', `* ${h.title}`);
      for (const [k, at] of d.at) {
        if (k !== 'CUSTOM_ID' && !ORG_OWNED.test(k)) err(c.line + 1 + at, `sections take only :CUSTOM_ID:, not :${k}:`, `* ${h.title}  :list:`);
      }
      section = { id: d.props.CUSTOM_ID || sectionId(h.title), title: h.title, note: text, layout, line: c.line + 1, cards: [] };
      board.sections.push(section);
      continue;
    }

    // ---- a card ----
    const s = ensureSection(c.line + 1);
    const p = d.props;
    const cid = p.CUSTOM_ID;
    if (!h.title) err(c.line, 'card has an empty claim', '** NATS covers the peak with one binary');
    if (!cid) {
      err(c.line, 'card has no id', `${headLine.trim()}\n:PROPERTIES:\n:CUSTOM_ID: ${slug(h.title)}\n:END:\n(or let the tool write the ids of every such card: cards ids ${id})`);
    } else if (!ID_RE.test(cid)) {
      err(c.line, `id "${cid}" must be lowercase letters, digits and dashes`, `:CUSTOM_ID: ${slug(cid)}`);
    }
    for (const [k, at] of d.at) {
      if (!ORG_CARD_PROPS.includes(k) && !ORG_OWNED.test(k)) {
        const hint = k === 'STATUS' ? '; status is the TODO keyword: ** DOING The claim' : k === 'PROGRESS' ? '; progress is a cookie: ** The claim [3/7]' : '';
        err(c.line + 1 + at, `unknown property :${k}:`, `allowed: CUSTOM_ID, ASK, MULTI, SUGGEST, BASIS, FROM, NEEDS${hint}`);
      }
    }
    const enumCheck = (key, value, allowed) => {
      if (value !== undefined && !allowed.includes(value)) {
        err(c.line, `:${key}: ${value} is not one of ${allowed.join(', ')}`, `:${key}: ${allowed[0]}`);
      }
    };
    const ask = p.ASK?.toLowerCase();
    const basis = p.BASIS?.toLowerCase();
    enumCheck('ASK', ask, ASKS);
    enumCheck('BASIS', basis, BASES);
    const multi = p.MULTI !== undefined && /^(t|yes|true)$/i.test(p.MULTI);
    if (multi && ask !== 'choose') err(c.line, ':MULTI: only applies to :ASK: choose', ':ASK: choose\n:MULTI: t');
    // :SUGGEST: none -- only the human knows; the agent recommends no option.
    const suggest = p.SUGGEST?.toLowerCase();
    enumCheck('SUGGEST', suggest, ['none']);
    if (suggest && ask !== 'choose') err(c.line, ':SUGGEST: only applies to :ASK: choose', ':ASK: choose\n:SUGGEST: none');
    if (h.progress && (h.progress.total === 0 || h.progress.done > h.progress.total)) {
      err(c.line, `progress cookie ${h.cookie} must be done/total`, `** ${h.title} [3/7]`);
    }
    for (const t of h.tags) {
      if (!ID_RE.test(t)) err(c.line, `tag ":${t}:" must be lowercase letters, digits and dashes`, ':perf:security:');
    }

    const needs = orgNeeds(p.NEEDS);
    const card = {
      id: cid || slug(h.title),
      title: h.title,
      line: c.line + 1,
      section: s.id,
      ask: ask || null,
      status: h.todo ? TODO[h.todo] : 'open',
      basis: basis || null,
      from: orgList(p.FROM),
      needs: needs.ids,
      when: needs.when,
      tags: h.tags,
      multi,
      suggest: suggest === 'none' ? 'none' : null,
      progress: h.progress && h.progress.total > 0 && h.progress.done <= h.progress.total ? h.progress : null,
      body: text,
      bodyLine: c.line + 2 + (c.lines.length - d.rest.length) + Math.max(0, d.rest.findIndex((l) => l.trim())),
      src: [headLine, ...c.lines].join('\n').trim(),
      fmt: 'org',
      keyword: h.todo,
      drawerGap: !!d.gap,
    };
    card.anatomy = anatomy(card);
    if (card.ask === 'choose') {
      const opts = card.anatomy.options;
      const ex = `** ${h.title}\n:PROPERTIES:\n:CUSTOM_ID: ${card.id}\n:ASK: choose\n:END:\n- [X] The option you recommend\n- [ ] Another option`;
      if (opts.length < 2) err(c.line, ':ASK: choose needs at least two options written as checkboxes', ex);
      if (!multi && opts.filter((o) => o.default).length > 1) err(c.line, 'single choice has more than one [X]; add :MULTI: t or keep one', ex);
      if (card.suggest === 'none' && opts.some((o) => o.default)) err(c.line, ':SUGGEST: none with an option marked [X]; keep one of the two', '- [ ] The option');
      const seen = new Set();
      for (const o of opts) {
        if (seen.has(o.value)) err(c.line, `two options answer "${o.value}"; give each its own key`, '- [ ] small :: S/M, 140 to 180 mm\n- [ ] large :: M/L, 160 to 210 mm');
        seen.add(o.value);
      }
    }
    board.cards.push(card);
    s.cards.push(card.id);
  }
  return board;
}

// addIds(src) -> { src, added: [[line, id]] }. Gives every card of a board.org
// that has no :CUSTOM_ID: one made from its claim, written into the file once.
// After that the id is the card's own: the claim may change, the id stays.
export function addIds(src) {
  const lines = String(src).split('\n');
  const taken = new Set([...String(src).matchAll(/^\s*:CUSTOM_ID:\s*(\S+)\s*$/gim)].map((m) => m[1]));
  const fresh = (title) => {
    let base = slug(title).replace(/-+$/, ''); // a cut at 32 characters may end on a dash
    if (!/[a-z0-9]/i.test(plain(title))) {
      let hsh = 0x811c9dc5;
      for (const ch of String(title)) hsh = Math.imul(hsh ^ ch.codePointAt(0), 0x01000193) >>> 0;
      base = `card-${hsh.toString(16).padStart(8, '0').slice(0, 6)}`;
    }
    let idv = base;
    for (let k = 2; taken.has(idv); k++) idv = `${base.slice(0, 44)}-${k}`;
    taken.add(idv);
    return idv;
  };
  const added = [];
  let block = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (block) { if (new RegExp(`^\\s*#\\+end_${block}\\s*$`, 'i').test(line)) block = null; continue; }
    const b = line.match(/^\s*#\+begin_(\w+)/i);
    if (b) { block = b[1]; continue; }
    const hd = line.match(/^\*\*\s+(.*?)\s*$/);
    if (!hd) continue;
    const eol = lines[i].endsWith('\r') ? '\r' : '';
    let at = i + 1;
    if (PLANNING_RE.test(lines[at] || '')) at++;
    const drawer = (lines[at] || '').trim().toUpperCase() === ':PROPERTIES:';
    if (drawer) {
      let end = at + 1;
      while (end < lines.length && lines[end].trim().toUpperCase() !== ':END:') end++;
      if (lines.slice(at, end).some((l) => /^\s*:CUSTOM_ID:/i.test(l))) continue;
      const idv = fresh(orgHead(hd[1]).title);
      lines.splice(at + 1, 0, `:CUSTOM_ID: ${idv}${eol}`);
      added.push([i + 1, idv]);
    } else {
      const idv = fresh(orgHead(hd[1]).title);
      lines.splice(at, 0, `:PROPERTIES:${eol}`, `:CUSTOM_ID: ${idv}${eol}`, `:END:${eol}`);
      added.push([i + 1, idv]);
    }
  }
  return { src: lines.join('\n'), added };
}

// canonical(card) -> what a card means, independent of its source format and
// of formatting: its attributes and its rendered body. Two sources with the
// same canonical form are the same version, so converting a board from
// markdown to org, or re-wrapping a paragraph, is not a revision.
export function canonical(card) {
  const sx = syntaxOf(card.fmt);
  const ctx = {
    inline: sx.inline,
    ref: (id, label) => `[ref:${id}${label ? '|' + label : ''}]`,
    figure: (b) => {
      if (b.type !== 'code' || !FIGURE_LANGS.includes(b.lang)) return null;
      const g = b.lang === 'flow' ? parseFlow(b.text) : null;
      const body = g ? JSON.stringify([g.dir, g.nodes, g.edges]) : sketchLines(b.text).join('\n');
      return `[fig:${b.lang}|${esc(sx.inline(b.info || '', ctx))}|${esc(body)}]`;
    },
    // A file stands for its path here; what the file holds is versioned by
    // its hash in the log (store.sync), since the file can change on its own.
    asset: (b) => (b.type === 'include'
      ? `[include:${esc(b.path)}|${b.kind}|${b.lang}|${b.from ?? ''}-${b.to ?? ''}|${esc(b.info || '')}]`
      : `[file:${esc(b.path)}|${esc(b.info || '')}]`),
  };
  return JSON.stringify([
    sx.inline(card.title, ctx), card.ask, card.status, card.basis, card.from, card.needs, card.tags, card.multi, card.progress,
    renderBlocks(sx.blocks(card.body), ctx).replace(/\s+/g, ' '),
    ...(card.suggest ? [card.suggest] : []),
    ...(card.when && Object.keys(card.when).length ? [card.when] : []),
  ]);
}

// parseCard(src, fmt) -> the card a logged source describes (for history and diffs).
export function parseCard(src, fmt = 'md') {
  const head = fmt === 'org' ? '#+title: past\n' : '---\ntitle: past\n---\n';
  return parseBoard(`${head}${src}\n`, { fmt }).cards[0] || null;
}

// Checks across cards, the same for both formats.
function crossChecks(board) {
  const errors = board.errors;
  const err = (line, msg, fix) => errors.push({ line: line + 1, msg, fix });
  const sx = syntaxOf(board.fmt);
  const ids = new Set();
  for (const card of board.cards) {
    if (ids.has(card.id)) err(card.line - 1, `duplicate id "${card.id}"`, board.fmt === 'org' ? `:CUSTOM_ID: ${card.id}-2` : `## ${card.title} {#${card.id}-2}`);
    ids.add(card.id);
  }
  const secIds = new Set();
  for (const s of board.sections) {
    if (s.id && secIds.has(s.id)) err(s.line - 1, `duplicate section "${s.title}"`, board.fmt === 'org' ? `:CUSTOM_ID: ${s.id}-2` : `# ${s.title} {#${s.id}-2}`);
    secIds.add(s.id);
  }
  const known = () => `known ids: ${[...ids].slice(0, 12).join(', ')}`;
  const refText = (ref) => (board.fmt === 'org' ? `[[#${ref}]]` : `[[${ref}]]`);
  for (const card of board.cards) {
    for (const key of ['from', 'needs']) {
      for (const ref of card[key]) {
        if (!ids.has(ref)) err(card.line - 1, `${key}=${ref} names no card`, known());
        if (ref === card.id) err(card.line - 1, `card lists itself in ${key}=`, `remove ${card.id} from ${key}=`);
      }
    }
    for (const ref of card.anatomy.refs) {
      if (!ids.has(ref)) err(card.line - 1, `${refText(ref)} names no card`, known());
    }
    // a=value and a=* say which answer of the ask `a` this ask is written for.
    for (const [ref, want] of Object.entries(card.when || {})) {
      const up = board.cards.find((c) => c.id === ref);
      if (!up) continue;
      const fix = (allowed) => `:NEEDS: ${ref}=${allowed[0]}   (${ref} can be: ${allowed.join(', ')}; * is any answer)`;
      if (!card.ask || !up.ask) { err(card.line - 1, `:NEEDS: ${ref}=${want}: an answer can be named only where an ask waits on an ask`, `:NEEDS: ${ref}`); continue; }
      if (want === '*') continue;
      const allowed = up.ask === 'choose' ? up.anatomy.options.map((o) => o.value) : up.ask === 'approve' ? ['approve', 'reject'] : up.ask === 'do' ? ['done', 'cannot'] : [];
      if (!allowed.length) err(card.line - 1, `:NEEDS: ${ref}=${want}: ${ref} takes free text, so only * (any answer) can be named`, `:NEEDS: ${ref}=*`);
      else if (!allowed.includes(want)) err(card.line - 1, `:NEEDS: ${ref}=${want}: "${want}" is not an answer of ${ref}`, fix(allowed));
    }
  }
  // Asks that wait on each other would wait forever.
  const asks = new Map(board.cards.filter((c) => c.ask).map((c) => [c.id, c]));
  const state = new Map();
  const walk = (c, trail) => {
    if (state.get(c.id) === 2) return;
    if (state.get(c.id) === 1) {
      const loop = [...trail.slice(trail.indexOf(c.id)), c.id];
      err(c.line - 1, `asks wait on each other: ${loop.join(' -> ')}`, `remove one :NEEDS: so that one of them can be answered first`);
      return;
    }
    state.set(c.id, 1);
    for (const ref of c.needs) if (asks.has(ref) && ref !== c.id) walk(asks.get(ref), [...trail, c.id]);
    state.set(c.id, 2);
  };
  for (const c of asks.values()) walk(c, []);
  for (const ref of refsIn(sx.blocks(board.lede), sx.refs)) {
    if (!ids.has(ref)) err(0, `${refText(ref)} in the lede names no card`, known());
  }
}

// anatomy(card) -> { gist, figure, facts, options, depth, refs }
//   gist     first block, when it is a paragraph
//   figure   the first sketch or flow block, or image file (shown with the gist)
//   facts    the first ```facts block (shown with the gist; aligned in compare rows)
//   options  task-list items of a choose card
//   depth    every other block, in order
export function anatomy(card) {
  const sx = syntaxOf(card.fmt);
  const blocks = sx.blocks(card.body);
  const out = { gist: null, figure: null, facts: null, options: [], depth: [], refs: [] };
  let rest = blocks;
  if (rest[0]?.type === 'paragraph') { out.gist = rest[0]; rest = rest.slice(1); }
  for (const b of rest) {
    if (!out.figure && isFigure(b)) { out.figure = b; continue; }
    if (!out.facts && b.type === 'code' && b.lang === 'facts') { out.facts = b; continue; }
    if (card.ask === 'choose' && !out.options.length && b.type === 'list' && b.items.length && b.items.every((it) => it.task !== null)) {
      out.options = b.items.map((it) => {
        const text = it.blocks[0]?.type === 'paragraph' ? it.blocks[0].text : '';
        // An option that starts with a card reference: [[id]] (md) or [[#id]] (org).
        const rm = text.match(/^\[\[#?([a-z0-9][a-z0-9-]*)\](?:\[[^\]]*\])?\]\s*(.*)$/);
        if (rm) return { value: rm[1], ref: rm[1], key: null, text: rm[2], default: it.task };
        // "- [ ] small :: S/M, 140 to 180 mm": the term is a key that stays the
        // same when the words change or the board is translated.
        if (it.term !== undefined && ID_RE.test(it.term)) return { value: it.term, ref: null, key: it.term, text, default: it.task };
        const whole = it.term !== undefined ? `${it.term} :: ${text}` : text;
        return { value: sx.plain(whole), ref: null, key: null, text: whole, badKey: it.term !== undefined ? it.term : null, default: it.task };
      });
      continue;
    }
    out.depth.push(b);
  }
  out.refs = [...new Set(refsIn(blocks, sx.refs))];
  return out;
}

function refsIn(blocks, refs) {
  const found = [];
  // Code is inert: a reference inside a code span is text, as it is when rendered.
  const scan = (s) => { found.push(...refs(s)); };
  const walk = (bs) => {
    for (const b of bs) {
      if (b.type === 'paragraph' || b.type === 'heading') scan(b.text);
      else if (b.type === 'list') b.items.forEach((it) => walk(it.blocks));
      else if (b.type === 'quote') walk(b.blocks);
      else if (b.type === 'table') [...b.head, ...b.rows.flat()].forEach(scan);
      else if (b.type === 'code' && (b.lang === 'facts' || b.lang === 'tradeoffs')) scan(b.text);
    }
  };
  walk(blocks);
  return found;
}

export function formatErrors(errors, file = 'board.md') {
  return errors.map((e) => `${file}:${e.line}  ${e.msg}\n  fix: ${String(e.fix).split('\n').join('\n       ')}`).join('\n');
}
