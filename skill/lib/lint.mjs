// lint.mjs -- warnings: the board is valid but will read worse than it could.
//
// Errors stop a render. Warnings do not; they are the writing rules from
// SKILL.md made checkable, so an agent hears them at the moment it can act.

import { plain } from './md.mjs';

export const LIMITS = {
  claimChars: 110,
  claimMinWords: 3,
  gistWords: 60,
  sectionCards: 7,
  boardCards: 30,
  openAsks: 5,
};

const words = (s) => plain(s).split(/\s+/).filter(Boolean).length;
// CJK text has no spaces; count roughly two characters per word.
const wordish = (s) => {
  const t = plain(s);
  const cjk = (t.match(/[㐀-鿿぀-ヿ가-힯]/g) || []).length;
  return words(t.replace(/[㐀-鿿぀-ヿ가-힯]/g, ' ')) + Math.ceil(cjk / 2);
};

export function lint(board) {
  const out = [];
  const warn = (line, msg) => out.push({ line, msg });

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
  }

  for (const s of board.sections) {
    if (s.cards.length > LIMITS.sectionCards) {
      warn(s.line, `section "${s.title || '(untitled)'}" has ${s.cards.length} cards; split it or cut to ${LIMITS.sectionCards}`);
    }
    if (s.layout === 'compare' && s.cards.length < 2) {
      warn(s.line, `compare section "${s.title}" has fewer than two cards`);
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
