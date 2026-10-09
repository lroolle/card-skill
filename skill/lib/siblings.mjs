// siblings.mjs -- one board in more than one language.
//
// A board is written in one language. A translation is a second board, next
// to the first, that says so: `#+translation_of: <board>`. It keeps the card
// ids and option keys of its source, so an answer means the same thing on
// either page. The pages link to each other; `cards check` says where a
// translation has fallen behind.

import fs from 'node:fs';
import path from 'node:path';
import { SOURCES, sourceIn, fold, readLog } from './store.mjs';
import { parseBoard } from './board.mjs';

const head = (file) => {
  const src = fs.readFileSync(file, 'utf8').split(/^\*+\s/m)[0];
  const get = (k) => src.match(new RegExp(`^#\\+${k}:\\s*(.*?)\\s*$`, 'im'))?.[1] || '';
  return { of: get('translation_of'), lang: get('language') || get('lang') || 'en', title: get('title') };
};

// family(ref, board) -> [{ id, lang, title, self, dir, file }], the source first; [] when the board stands alone.
export function family(ref, board) {
  if (!ref || !ref.dir) return [];
  const root = path.dirname(ref.dir);
  const top = board.translationOf || ref.id;
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || !SOURCES.some((f) => fs.existsSync(path.join(root, d.name, f)))) continue;
    const dir = path.join(root, d.name);
    const file = sourceIn(dir);
    const h = d.name === ref.id ? { of: board.translationOf, lang: board.lang, title: board.title } : head(file);
    if (d.name === top ? !h.of : h.of === top) out.push({ id: d.name, lang: h.lang, title: h.title, self: d.name === ref.id, dir, file });
  }
  out.sort((a, b) => (a.id === top ? -1 : b.id === top ? 1 : a.id.localeCompare(b.id)));
  return out.length > 1 && out.some((m) => m.self) ? out : [];
}

// What a translation must keep in step with its source: the cards, their asks,
// their option keys, and the text when the source moves on.
export function translationChecks(ref, board) {
  const errors = [];
  const warnings = [];
  if (!board.translationOf || !ref || !ref.dir) return { errors, warnings };
  const dir = path.join(path.dirname(ref.dir), board.translationOf);
  const file = sourceIn(dir);
  if (board.translationOf === ref.id || !fs.existsSync(file)) {
    errors.push({ line: 1, msg: `#+translation_of: ${board.translationOf} names no other board next to this one`, fix: `put the source board at ${path.join(path.dirname(ref.dir), board.translationOf, 'board.org')}` });
    return { errors, warnings };
  }
  const src = parseBoard(fs.readFileSync(file, 'utf8'), { id: board.translationOf, file });
  const theirs = new Map(src.cards.map((c) => [c.id, c]));
  const mine = new Map(board.cards.map((c) => [c.id, c]));
  const srcLog = fold(readLog(dir));
  const myLog = fold(readLog(ref.dir));
  const keys = (c) => c.anatomy.options.map((o) => o.value).join(', ');
  for (const c of board.cards) {
    const s = theirs.get(c.id);
    if (!s) { warnings.push({ line: c.line, msg: `card ${c.id} is not on the source board ${src.id}; an answer to it reaches no card there` }); continue; }
    if ((s.ask || '') !== (c.ask || '')) warnings.push({ line: c.line, msg: `${c.id} asks "${c.ask || 'nothing'}" here and "${s.ask || 'nothing'}" on ${src.id}` });
    else if (c.ask === 'choose') {
      const loose = c.anatomy.options.some((o) => !o.key && !o.ref);
      if (loose) warnings.push({ line: c.line, msg: `${c.id}: give each option a key (- [ ] key :: words), the same on ${src.id}; without one an answer comes back as a translated sentence` });
      else if (keys(c) !== keys(s)) warnings.push({ line: c.line, msg: `${c.id}: option keys differ from ${src.id} (${keys(s)})` });
    }
    const a = srcLog.cards.get(c.id);
    const b = myLog.cards.get(c.id);
    if (a && b && a.at > b.at) warnings.push({ line: c.line, msg: `${c.id}: ${src.id} changed this card (v${a.v}) after it was last written here; translate it again` });
  }
  for (const s of src.cards) {
    if (!mine.has(s.id)) warnings.push({ line: 1, msg: `card ${s.id} of ${src.id} has no translation here` });
  }
  return { errors, warnings };
}
