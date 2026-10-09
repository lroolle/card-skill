// lint.mjs -- warnings: the board is valid but will read worse than it could.
//
// Errors stop a render. Warnings do not; they are the writing rules from
// SKILL.md made checkable, so an agent hears them at the moment it can act.

import { plain, parseBlocks } from './md.mjs';
import { FIGURE_LANGS, LIMITS as FIG, parseFlow, sketchLines, cols } from './figure.mjs';

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

// Words to replace, near ASD-STE100. The first group is from the STE sheet
// (vault/assets/x/2105819303471976479-ste100-sheet.png); the rest is ours: words
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

// The text a reader reads as sentences: no code, no quoted words of others.
function prose(text) {
  return plain(String(text).replace(/(`+)[\s\S]*?\1/g, 'code').replace(/https?:\/\/\S+/g, 'link'));
}
const unquoted = (t) => t.replace(/"[^"]*"|“[^”]*”/g, ' ');
// Split into sentences. "e.g." and "i.e." do not end one; a decimal point does not either.
export function sentences(text) {
  const t = prose(text).replace(/\b(e\.g|i\.e|vs|etc)\./gi, '$1\u0001');
  return t.split(/(?<=[.!?])["”)]?\s+(?=["“(]?[A-Z0-9`])/).map((x) => x.replace(/\u0001/g, '.').trim()).filter(Boolean);
}

const words = (s) => plain(s).split(/\s+/).filter(Boolean).length;
// CJK text has no spaces; count roughly two characters per word.
const wordish = (s) => {
  const t = plain(s);
  const cjk = (t.match(/[㐀-鿿぀-ヿ가-힯]/g) || []).length;
  return words(t.replace(/[㐀-鿿぀-ヿ가-힯]/g, ' ')) + Math.ceil(cjk / 2);
};

// Paragraph-like text in a card: gist, depth paragraphs, list items. Quotes and code are other people's words or not prose.
function textBlocks(blocks, acc = []) {
  for (const b of blocks) {
    if (b.type === 'paragraph') acc.push({ text: b.text, para: true });
    else if (b.type === 'list') b.items.forEach((it) => textBlocks(it.blocks, acc));
    else if (b.type === 'table') [...b.head, ...b.rows.flat()].forEach((c) => acc.push({ text: c, para: false }));
    else if (b.type === 'code' && (b.lang === 'facts' || b.lang === 'tradeoffs')) acc.push({ text: b.text, para: false, cells: true });
  }
  return acc;
}

function steWarnings(c, warn) {
  const seen = new Set();
  const words = (t) => {
    for (const [re, w, use] of WORD_RE) {
      const m = unquoted(prose(t)).match(re);
      if (m && !seen.has(w)) { seen.add(w); warn(c.line, `"${m[1]}": write ${use} (writing.md word list)`); }
    }
  };
  words(c.title);
  for (const t of textBlocks(parseBlocks(c.body))) {
    words(t.text);
    if (t.cells) continue;
    const ss = sentences(t.text);
    for (const x of ss) {
      const n = x.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
      if (n > LIMITS.sentenceWords) {
        warn(c.line, `sentence has ${n} words; split it (<= ${LIMITS.sentenceWords}): "${x.split(/\s+/).slice(0, 8).join(' ')} ..."`);
      }
    }
    if (t.para && ss.length > LIMITS.paragraphSentences) {
      warn(c.line, `paragraph has ${ss.length} sentences; one topic per paragraph (<= ${LIMITS.paragraphSentences})`);
    }
  }
}

function figureWarnings(c, warn) {
  for (const b of parseBlocks(c.body)) {
    if (b.type !== 'code' || !FIGURE_LANGS.includes(b.lang)) continue;
    if (!b.info) warn(c.line, `\`\`\`${b.lang} has no caption; say what it shows: \`\`\`${b.lang} Rack view: no lines`);
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

export function lint(board) {
  const out = [];
  const warn = (line, msg) => out.push({ line, msg });
  const english = /^en\b/i.test(board.lang || 'en');

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
    if (c.ask === 'choose' && a.options.length && !a.options.some((o) => o.default)) {
      warn(c.line, 'no recommended option; mark the one you would pick with - [x]');
    }
    if (c.ask && c.status === 'done') {
      warn(c.line, `ask=${c.ask} on a done card; drop the ask once it is answered`);
    }
    figureWarnings(c, warn);
    if (english) steWarnings(c, warn);
  }
  for (const [text, line] of [[board.lede, 1], ...board.sections.map((s) => [s.note, s.line])]) {
    if (parseBlocks(text).some((b) => b.type === 'code' && FIGURE_LANGS.includes(b.lang))) {
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
