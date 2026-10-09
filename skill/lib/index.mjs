// index.mjs -- one page that lists the boards of a project.
//
// With more than one board, nobody remembers which one waits. Each render
// also writes `.cards/index.html`: every board with its title, its
// revision, and how many asks wait on the human. Boards that wait come
// first. Each board page links back to it. `cards serve` shows the same
// list at `/`.
//
//   indexRows(root)        -> [{ id, title, lang, rev, cards, waiting, unread, at, broken }]
//   indexHtml(rows, opts)  -> the page
//   writeIndex(root)       -> writes <root>/index.html

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBoard } from './board.mjs';
import { SOURCES, sourceIn, fold, readLog, unread } from './store.mjs';
import { esc } from './md.mjs';
import { VERSION, HOME } from './version.mjs';
import '../runtime/digest.js';

const RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime');
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

export function indexRows(root) {
  if (!fs.existsSync(root)) return [];
  const rows = [];
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || !SOURCES.some((f) => isFile(path.join(root, d.name, f)))) continue;
    const dir = path.join(root, d.name);
    // One board that cannot be read is one row that says so, never the end of the list.
    try {
      const file = sourceIn(dir);
      const board = parseBoard(fs.readFileSync(file, 'utf8'), { id: d.name, file });
      const st = fold(readLog(dir));
      const answered = globalThis.cardsAnswered(st.sends);
      // An ask is open when its card is not done and it has no answer at the version of the card the log holds.
      const waiting = board.cards.filter((c) => c.ask && c.status !== 'done' && !answered.has(`${c.id}@${st.cards.get(c.id)?.v ?? 1}`)).length;
      const last = [...st.revs.map((r) => r.at), ...st.sends.map((s) => s.at)].filter(Boolean).sort().pop() || '';
      rows.push({ id: d.name, title: board.title, lang: board.lang, rev: st.rev, cards: board.cards.length, waiting, unread: unread(st).length, at: last, broken: board.errors.length > 0, rendered: isFile(path.join(dir, 'board.html')) });
    } catch {
      rows.push({ id: d.name, title: d.name, lang: 'en', rev: 0, cards: 0, waiting: 0, unread: 0, at: '', broken: true, rendered: isFile(path.join(dir, 'board.html')) });
    }
  }
  // What waits on the human first; then the board that moved last.
  return rows.sort((a, b) => (b.waiting > 0) - (a.waiting > 0) || String(b.at).localeCompare(String(a.at)) || a.id.localeCompare(b.id));
}

export function indexHtml(rows, { live = false, name = 'Boards' } = {}) {
  const css = fs.readFileSync(path.join(RUNTIME, 'board.css'), 'utf8');
  const tokens = css.slice(css.indexOf(':root {'), css.indexOf('* { box-sizing')).trim();
  const waiting = rows.reduce((n, r) => n + r.waiting, 0);
  const item = (r) => {
    const href = live ? `/b/${r.id}` : `${encodeURIComponent(r.id)}/board.html`;
    const meta = [esc(r.id), r.rev ? `rev ${r.rev}` : 'not rendered yet', `${r.cards} card${r.cards === 1 ? '' : 's'}`];
    if (r.unread) meta.push(`${r.unread} repl${r.unread === 1 ? 'y' : 'ies'} the agent has not read`);
    if (r.broken) meta.push('has errors: cards check');
    const state = r.waiting ? `<span class="wait"><i></i>${r.waiting} open ask${r.waiting === 1 ? '' : 's'}</span>` : '<span class="idle">no open ask</span>';
    const title = r.rendered || live ? `<a href="${href}" lang="${esc(r.lang)}">${esc(r.title)}</a>` : `<span lang="${esc(r.lang)}">${esc(r.title)}</span>`;
    return `<li>${title}${state}<span class="meta">${meta.join(' · ')}</span></li>`;
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="generator" content="cards ${esc(VERSION)}">
<meta name="cards-page" content="boards">
<title>${waiting ? `(${waiting}) ` : ''}${esc(name)}</title>
<style>
${tokens}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: var(--w-regular) var(--t-m)/1.55 var(--font); -webkit-font-smoothing: antialiased; }
a { color: inherit; text-underline-offset: 3px; text-decoration-thickness: 1px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
main { max-width: 760px; margin: 0 auto; padding: var(--s6) var(--s5) var(--s7); }
h1 { margin: 0; font-size: var(--t-xxl); line-height: 1.2; font-weight: var(--w-strong); }
.lead { margin: var(--s2) 0 var(--s5); font-size: var(--t-s); color: var(--fg-2); }
ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line-strong); }
li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--s1) var(--s4); align-items: baseline; padding: var(--s3) 0; border-bottom: 1px solid var(--line); }
li > a, li > span:first-child { font-size: var(--t-l); font-weight: var(--w-strong); min-height: 24px; }
.wait { display: inline-flex; align-items: center; gap: var(--s2); font-size: var(--t-s); font-weight: var(--w-strong); white-space: nowrap; }
.wait i { width: 10px; height: 10px; border-radius: var(--r-s); background: var(--signal); }
.idle { font-size: var(--t-s); color: var(--fg-3); white-space: nowrap; }
.meta { grid-column: 1 / -1; font-size: var(--t-s); color: var(--fg-3); }
.empty { padding: var(--s5) 0; color: var(--fg-2); }
footer { margin-top: var(--s5); font-size: var(--t-xs); color: var(--fg-3); }
</style>
</head>
<body>
<main>
<h1>${esc(name)}</h1>
<p class="lead">${rows.length} board${rows.length === 1 ? '' : 's'}${waiting ? ` · ${waiting} open ask${waiting === 1 ? '' : 's'}` : ' · no open ask'}</p>
${rows.length ? `<ul>${rows.map(item).join('')}</ul>` : '<p class="empty">No boards yet. An agent makes one with <code>cards new &lt;name&gt;</code>.</p>'}
<footer><a href="${esc(HOME)}">cards ${esc(VERSION)}</a></footer>
</main>
</body>
</html>
`;
}

// The index is written into a boards directory only: `.cards`, or the one CARDS_ROOT names.
export const isBoardsRoot = (root) => path.basename(root) === '.cards' || (process.env.CARDS_ROOT && path.resolve(process.env.CARDS_ROOT) === root);

// The list is ours to write only where no index.html is, or where the one that is
// there is a list we wrote: it says so in its head. (A list of an earlier build has
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

// Never throws: the list is a convenience, and a render must not fail for it.
export function writeIndex(root) {
  if (!ownsIndex(root)) return null;
  const file = path.join(root, 'index.html');
  try {
    fs.writeFileSync(file, indexHtml(indexRows(root), { name: `Boards of ${path.basename(path.dirname(root)) || 'this project'}` }));
    return file;
  } catch { return null; }
}
