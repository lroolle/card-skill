// lint.mjs -- warnings: the board is valid but will read worse than it could.
//
// Errors stop a render. Warnings do not; they are the writing rules from
// SKILL.md made checkable, so an agent hears them at the moment it can act.

import { LIMITS as FIG, parseFlow, sketchLines, cols, isFigure, figuresIn } from './figure.mjs';
import { syntaxOf } from './board.mjs';

export const LIMITS = {
  claimChars: 110,
  claimMinWords: 3,
  gistWords: 60,
  sectionCards: 7,
  boardCards: 30,
  openAsks: 5,
  sentenceWords: 25,     // ASD-STE100 descriptive limit; procedures are 20
  paragraphSentences: 6, // ASD-STE100
};

// Words to replace, near ASD-STE100. The first group is from the STE summary
// sheet in https://x.com/karpathy/status/2105819303471976479; the rest is ours: words
// that make agent prose longer or vaguer. Full list and reasons: reference/writing.md.
export const WORDS = [
  ['utilize', 'use'], ['utilise', 'use'], ['in order to', 'to'], ['prior to', 'before'],
  ['approximately', 'about'], ['commence', 'start'], ['ensure', 'make sure'], ['replenish', 'fill'],
  ['leverage', 'use'], ['facilitate', 'help'], ['subsequently', 'then'], ['numerous', 'many'],
  ['additional', 'more'], ['demonstrate', 'show'], ['sufficient', 'enough'], ['terminate', 'stop'],
  ['initiate', 'start'], ['obtain', 'get'], ['endeavor', 'try'], ['regarding', 'about'],
  ['in the event that', 'if'], ['due to the fact that', 'because'], ['a number of', 'some, or the number'],
  ['delve', 'look at'], ['seamless', 'nothing; say what works'], ['robust', 'strong, or say what it survives'],
  ['crucial', 'important'], ['pivotal', 'important'], ['comprehensive', 'full'], ['streamline', 'simplify'],
  ['empower', 'let'], ['harness', 'use'], ['myriad', 'many'], ['plethora', 'many'], ['holistic', 'whole'],
  ['synergy', 'nothing; say what it does'], ['paradigm', 'model'], ['cutting-edge', 'new'], ['unlock', 'let'],
];
const forms = (w) => {
  if (w.includes(' ')) return [w];
  if (w.endsWith('e')) return [w, w + 's', w + 'd', w.slice(0, -1) + 'ing', w + 'ly'];
  if (w.endsWith('y')) return [w, w.slice(0, -1) + 'ies', w.slice(0, -1) + 'ied', w + 'ing'];
  return [w, w + 's', w + 'ed', w + 'ing', w + 'ly'];
};
const WORD_RE = WORDS.map(([w, use]) => [new RegExp(`\\b(${forms(w).join('|')})\\b`, 'i'), w, use]);

// The plain-text reader of the board being checked (markdown or org).
let plain = syntaxOf('md').plain;

// The text a reader reads as sentences: no code, no quoted words of others.
function prose(text) {
  const noCode = String(text).replace(/(`+)[\s\S]*?\1/g, 'code')
    .replace(/(^|[\s\-('"{])([=~])(\S|\S[\s\S]*?\S)\2(?=$|[\s\-.,;:!?'")}\[])/g, '$1code');
  // A link is one word; the full stop or bracket after it is not part of it.
  return plain(noCode.replace(/https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"]/g, 'link'));
}
const unquoted = (t) => t.replace(/"[^"]*"|“[^”]*”/g, ' ');
// Split into sentences. "e.g." and "i.e." do not end one; a decimal point does not either.
export function sentences(text) {
  const t = prose(text).replace(/\b(e\.g|i\.e|vs|etc)\./gi, '$1\u0001');
  // A sentence may start with code (prose() writes it as the word "code").
  return t.split(/(?<=[.!?])["”)]?\s+(?=["“(]?(?:[A-Z0-9`]|code\b))/).map((x) => x.replace(/\u0001/g, '.').trim()).filter(Boolean);
}

const words = (s) => plain(s).split(/\s+/).filter(Boolean).length;
// CJK text has no spaces; count roughly two characters per word.
const wordish = (s) => {
  const t = plain(s);
  const cjk = (t.match(/[㐀-鿿぀-ヿ가-힯]/g) || []).length;
  return words(t.replace(/[㐀-鿿぀-ヿ가-힯]/g, ' ')) + Math.ceil(cjk / 2);
};

// Paragraph-like text in a card: gist, depth paragraphs, list items. Quotes and code are other people's words or not prose.
// Each piece carries the line of its top-level block, so a warning points at it.
function textBlocks(blocks, acc = [], at = null) {
  for (const b of blocks) {
    const line = at ?? b.line;
    if (b.type === 'paragraph') acc.push({ text: b.text, para: true, line });
    else if (b.type === 'list') b.items.forEach((it) => textBlocks(it.blocks, acc, line));
    else if (b.type === 'table') [...b.head, ...b.rows.flat()].forEach((c) => acc.push({ text: c, para: false, line }));
    else if (b.type === 'code' && (b.lang === 'facts' || b.lang === 'tradeoffs')) acc.push({ text: b.text, para: false, cells: true, line });
  }
  return acc;
}
const lineOf = (c, b) => (c.bodyLine && b && Number.isFinite(b.line) ? c.bodyLine + b.line : c.line);

function steWarnings(c, warn, sx) {
  const seen = new Set();
  const words = (t, at) => {
    for (const [re, w, use] of WORD_RE) {
      const m = unquoted(prose(t)).match(re);
      if (m && !seen.has(w)) { seen.add(w); warn(at, `"${m[1]}": write ${use} (writing.md word list)`); }
    }
  };
  words(c.title, c.line);
  for (const t of textBlocks(sx.blocks(c.body))) {
    const at = lineOf(c, t);
    words(t.text, at);
    if (t.cells) continue;
    const ss = sentences(t.text);
    for (const x of ss) {
      const n = x.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
      if (n > LIMITS.sentenceWords) {
        warn(at, `sentence has ${n} words; split it (<= ${LIMITS.sentenceWords}): "${x.split(/\s+/).slice(0, 8).join(' ')} ..."`);
      }
    }
    if (t.para && ss.length > LIMITS.paragraphSentences) {
      warn(at, `paragraph has ${ss.length} sentences; one topic per paragraph (<= ${LIMITS.paragraphSentences})`);
    }
  }
}

function figureWarnings(c, warn0, sx) {
  const blocks = sx.blocks(c.body);
  // A figure inside a list or a quote is checked as well; its warning points at the list.
  const lineOfTop = new Map();
  for (const top of blocks) for (const f of figuresIn([top])) lineOfTop.set(f, top);
  for (const b of figuresIn(blocks)) {
    const warn = (_line, msg) => warn0(lineOf(c, lineOfTop.get(b) || b), msg);
    if (b.type === 'file') {
      if (!b.info) warn(c.line, `the image ${b.path} has no caption; put "#+caption: What it shows" on the line above it`);
      continue;
    }
    if (!b.info) {
      warn(c.line, sx.fmt === 'org'
        ? `the ${b.lang} block has no caption; put "#+caption: What it shows" on the line above #+begin_src ${b.lang}`
        : `\`\`\`${b.lang} has no caption; say what it shows: \`\`\`${b.lang} Rack view: no lines`);
    }
    if (b.lang === 'sketch') {
      const w = Math.max(0, ...sketchLines(b.text).map(cols));
      if (w > FIG.sketchCols) warn(c.line, `sketch is ${w} columns wide; draw it in ${FIG.sketchCols} or fewer`);
      if (!sketchLines(b.text).length) warn(c.line, 'sketch is empty');
    } else {
      const g = parseFlow(b.text);
      for (const p of g.problems) warn(c.line, `flow: ${p.msg}`);
      if (g.nodes.length > FIG.flowBoxes) warn(c.line, `flow has ${g.nodes.length} boxes; split it (<= ${FIG.flowBoxes})`);
      if (!g.edges.length) warn(c.line, 'flow has no arrows; write a -> b');
    }
  }
}

const slugKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'key';

// Blocks this build shows as something else than the writer meant. A src
// language that names a drawing we do not draw is shown as code; a block type
// we do not know shows its content as plain text. Both are silent on the
// page, so they are said here.
const DRAWS = ['sketch', 'flow'];
const WIDGETS = ['tradeoffs', 'diff', 'facts'];
const DRAW_LIKE = ['image', 'img', 'picture', 'photo', 'figure', 'fig', 'chart', 'graph', 'plot', 'diagram', 'mermaid', 'dot', 'graphviz', 'plantuml', 'ditaa', 'svg', 'canvas', 'bars', 'table'];
const BLOCKS = ['src', 'example', 'quote', 'comment', 'center', 'verse'];
function blockWarnings(c, warn) {
  let inside = null;
  String(c.body).split('\n').forEach((line, k) => {
    const at = (c.bodyLine || c.line) + k;
    if (inside) { if (new RegExp(`^\\s*#\\+end_${inside}\\s*$`, 'i').test(line)) inside = null; return; }
    const m = line.match(/^\s*#\+begin_(\w+)(?:\s+(\S+))?/i);
    if (!m) return;
    const kind = m[1].toLowerCase();
    const lang = (m[2] || '').toLowerCase();
    if (kind === 'src' || kind === 'example' || kind === 'comment' || kind === 'export') inside = m[1];
    if (kind === 'export') warn(at, '#+begin_export is not shown: a board never passes raw markup through');
    else if (!BLOCKS.includes(kind)) warn(at, `#+begin_${kind} has no look of its own here; its content shows as plain text (blocks: ${BLOCKS.join(', ')})`);
    else if (kind === 'src' && DRAW_LIKE.includes(lang)) {
      warn(at, `#+begin_src ${lang} is shown as code, not drawn. Drawn kinds: ${DRAWS.join(', ')}; widgets: ${WIDGETS.join(', ')}. For a picture, put [[file:shot.png]] alone on a line`);
    }
  });
}

export function lint(board) {
  const out = [];
  const warn = (line, msg) => out.push({ line, msg });
  // What keeps the file valid Org for Emacs and GitHub, not only for this build.
  const custom = board.cards.find((c) => c.keyword === 'DOING' || c.keyword === 'BLOCKED');
  if (board.fmt === 'org' && custom && !/\bDOING\b/.test(board.todo || '')) {
    warn(custom.line, `${custom.keyword} is not a TODO keyword to Emacs or GitHub until the board says so; add near the title: #+todo: TODO DOING BLOCKED | DONE`);
  }
  if (board.todo && /[A-Z]/.test(board.todo.replace(/\([^)]*\)/g, '').replace(/\b(TODO|DOING|BLOCKED|DONE)\b|\|/g, ''))) {
    warn(1, '#+todo: names keywords this build does not know; a card state is TODO, DOING, BLOCKED or DONE');
  }
  for (const c of board.cards) {
    if (c.drawerGap) warn(c.line + 1, 'a blank line before :PROPERTIES:; Emacs reads the drawer as the card\'s properties only when it follows the heading directly');
  }
  for (const c of board.cards) {
    if (c.planBare) warn(c.planBare, 'this line is read as a planning line and is not shown: it stands directly above the drawer. With a timestamp it is one for Emacs too (DEADLINE: <2026-10-15 Thu>); a sentence of the card goes under the drawer');
  }
  for (const u of board.unknown || []) {
    const READ = ['title', 'language', 'author', 'description', 'translation_of'];
    const near = u.what.slice(2, -1).toLowerCase().replace(/-/g, '_');
    warn(u.line, READ.includes(near)
      ? `${u.what} does nothing in this build; the keyword is #+${near}: (an underscore, not a hyphen)`
      : `${u.what} does nothing in this build (read before the first heading: ${READ.map((k) => `#+${k}`).join(', ')})`);
  }
  const english = /^en\b/i.test(board.lang || 'en');
  const sx = syntaxOf(board.fmt);
  plain = sx.plain;

  for (const c of board.cards) {
    if (plain(c.title).length > LIMITS.claimChars) {
      warn(c.line, `claim is ${plain(c.title).length} chars; say it in one line (<= ${LIMITS.claimChars})`);
    }
    if (!c.ask && c.status !== 'done' && wordish(c.title) < LIMITS.claimMinWords) {
      warn(c.line, `"${plain(c.title)}" reads like a topic; state the claim ("NATS covers the peak", not "NATS")`);
    }
    const a = c.anatomy;
    if (!a.gist && (a.depth.length || a.facts)) {
      warn(c.line, 'start the body with a one-paragraph gist; it is what the board shows by default');
    }
    if (a.gist && wordish(a.gist.text) > LIMITS.gistWords) {
      warn(c.line, `gist is ${wordish(a.gist.text)} words; keep it under ${LIMITS.gistWords} and move the rest below it`);
    }
    if (c.ask === 'choose' && a.options.length && !a.options.some((o) => o.default) && c.suggest !== 'none') {
      warn(c.line, sx.fmt === 'org'
        ? 'no recommended option; mark the one you would pick with - [X], or say that only the human knows: :SUGGEST: none'
        : 'no recommended option; mark the one you would pick with - [x]');
    }
    for (const o of a.options) {
      if (o.badKey) warn(c.line, `option key "${o.badKey}" must be lowercase letters, digits and dashes to come back as a key: - [ ] ${slugKey(o.badKey)} :: ${o.badKey} ...`);
    }
    if (sx.fmt === 'org') blockWarnings(c, warn);
    figureWarnings(c, warn, sx);
    if (english) steWarnings(c, warn, sx);
  }
  for (const [text, line] of [[board.lede, 1], ...board.sections.map((s) => [s.note, s.line])]) {
    if (sx.blocks(text).some(isFigure)) {
      warn(line, 'figures belong in cards; move it into the card it explains');
    }
  }

  for (const s of board.sections) {
    if (s.cards.length > LIMITS.sectionCards) {
      warn(s.line, `section "${s.title || '(untitled)'}" has ${s.cards.length} cards; split it or cut to ${LIMITS.sectionCards}`);
    }
    if (s.layout === 'compare' && s.cards.length < 2) {
      warn(s.line, `compare section "${s.title}" has fewer than two cards`);
    }
    if (s.layout === 'compare') {
      const drawn = s.cards.map((id) => board.cards.find((c) => c.id === id)).filter((c) => c.anatomy.figure);
      if (drawn.length && drawn.length < s.cards.length) {
        warn(s.line, `compare section "${s.title}": ${drawn.length} of ${s.cards.length} options have a figure; draw every option or none`);
      }
    }
  }

  if (board.cards.length > LIMITS.boardCards) {
    warn(1, `${board.cards.length} cards; past ${LIMITS.boardCards} a board stops being scannable -- split it`);
  }
  const asks = board.cards.filter((c) => c.ask && c.status !== 'done').length;
  if (asks > LIMITS.openAsks) {
    warn(1, `${asks} open asks; decide more yourself and ask only what only the human knows`);
  }
  return out.sort((x, y) => x.line - y.line);
}

export function formatWarnings(ws, file = 'board.md') {
  return ws.map((w) => `${file}:${w.line}  warn: ${w.msg}`).join('\n');
}
