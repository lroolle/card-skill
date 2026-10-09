#!/usr/bin/env node
// cards -- the card-skill command line. Node stdlib only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseBoard, formatErrors, boardTitle as titleOf, ID_RE } from '../lib/board.mjs';
import { lint, formatWarnings } from '../lib/lint.mjs';
import { buildBoard, outline } from '../lib/compile.mjs';
import { resolveBoard, listBoards, readLog, fold, unread, markRead, boardsRoot } from '../lib/store.mjs';
import { serve } from '../lib/serve.mjs';
import '../runtime/digest.js';

const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PATTERNS = ['decide', 'review', 'plan', 'brief', 'status'];

const USAGE = `cards -- agent-native card boards

  cards new <board> [--pattern ${PATTERNS.join('|')}] [--title "..."]
  cards check <board>              validate board.org; errors show a fix
  cards render <board>             check, record revisions, write board.html
  cards show <board> [id|n]        the board, or one card, as text
  cards ls                         boards under ${process.env.CARDS_ROOT || '.cards'}/
  cards serve [--port 4747]        live boards; replies are written to disk
  cards wait <board> [--timeout s] block until the human sends, then print it
  cards inbox [<board>] [--peek]   print unread replies and mark them read

A <board> is a name under .cards/, a directory, or a board.org path.
An older board.md is read as well.
Exit codes: 0 ok, 1 board errors, 2 usage, 3 wait timed out.`;

const BOOL = new Set(['peek', 'quiet', 'help']);

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = !BOOL.has(k) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

const die = (msg, code = 2) => { console.error(msg); process.exit(code); };
const rel = (p) => path.relative(process.cwd(), p) || '.';

function cardIndex(ref) {
  const st = fold(readLog(ref.dir));
  const titles = {};
  if (fs.existsSync(ref.file)) {
    for (const c of parseBoard(fs.readFileSync(ref.file, 'utf8'), { id: ref.id, file: ref.file }).cards) titles[c.id] = c.title;
  }
  const cards = {};
  for (const [id, rec] of st.cards) cards[id] = { n: rec.n, v: rec.v, title: titles[id] || id };
  return { st, cards };
}

function boardTitle(ref) {
  return (fs.existsSync(ref.file) && titleOf(fs.readFileSync(ref.file, 'utf8'), ref.file)) || ref.id;
}

function printUnread(ref, { peek = false } = {}) {
  const { st, cards } = cardIndex(ref);
  const batches = unread(st);
  for (const b of batches) {
    console.log(globalThis.cardsDigest({ board: { id: ref.id, title: boardTitle(ref), path: rel(ref.file) }, round: b.round, rev: b.rev, at: b.at, items: b.items }, cards));
    console.log('');
  }
  if (!peek && batches.length) markRead(ref.dir, batches[batches.length - 1].round);
  return batches.length;
}

const commands = {
  new(a) {
    const name = a._[0] || die('cards new <board> [--pattern decide]');
    if (!name.includes('/') && !ID_RE.test(name)) die(`board name "${name}" must be lowercase letters, digits and dashes`);
    const pattern = a.pattern || 'brief';
    if (!PATTERNS.includes(pattern)) die(`unknown pattern "${pattern}"; one of ${PATTERNS.join(', ')}`);
    const ref = resolveBoard(name);
    if (fs.existsSync(ref.file)) die(`${rel(ref.file)} exists; edit it instead`, 1);
    const tpl = fs.readFileSync(path.join(SKILL, 'templates', `${pattern}.org`), 'utf8');
    fs.mkdirSync(ref.dir, { recursive: true });
    const title = typeof a.title === 'string' ? a.title.replace(/\s+/g, ' ').trim() : null;
    fs.writeFileSync(ref.file, title ? tpl.replace(/^#\+title:.*$/m, () => `#+title: ${title}`) : tpl);
    console.log(`wrote ${rel(ref.file)} from the ${pattern} pattern. Replace every card, then: cards render ${ref.id}`);
  },

  check(a) {
    const ref = resolveBoard(a._[0]);
    if (!fs.existsSync(ref.file)) die(`no board at ${rel(ref.file)}`, 1);
    const board = parseBoard(fs.readFileSync(ref.file, 'utf8'), { id: ref.id, file: ref.file });
    const ws = lint(board);
    if (board.errors.length) console.log(formatErrors(board.errors, rel(ref.file)));
    if (ws.length) console.log(formatWarnings(ws, rel(ref.file)));
    if (board.errors.length) process.exit(1);
    console.log(`ok: ${board.cards.length} cards, ${board.sections.length} sections${ws.length ? `, ${ws.length} warnings` : ''}`);
  },

  render(a) {
    const ref = resolveBoard(a._[0]);
    const r = buildBoard(ref);
    if (r.errors.length) {
      console.log(formatErrors(r.errors, rel(ref.file)));
      if (r.warnings.length) console.log(formatWarnings(r.warnings, rel(ref.file)));
      process.exit(1);
    }
    if (r.warnings.length) console.log(formatWarnings(r.warnings, rel(ref.file)) + '\n');
    if (!a.quiet) console.log(outline(r.data) + '\n');
    const added = r.sync.changed.filter((id) => r.data.cards[id]?.v === 1).length;
    const revised = r.sync.changed.length - added;
    const changed = [added && `${added} new`, revised && `${revised} revised`, r.sync.removed.length && `${r.sync.removed.length} removed`].filter(Boolean).join(', ');
    console.log(`rev ${r.data.board.rev}${changed ? ` (${changed})` : ''}. open: ${pathToFileURL(path.join(ref.dir, 'board.html')).href}`);
  },

  show(a) {
    const ref = resolveBoard(a._[0]);
    const r = buildBoard(ref, { write: false });
    if (r.errors.length) die(formatErrors(r.errors, rel(ref.file)), 1);
    const want = a._[1];
    if (!want) return console.log(outline(r.data));
    const card = Object.values(r.data.cards).find((c) => c.id === want || String(c.n) === want.replace(/^#/, ''));
    if (!card) die(`no card "${want}" on ${ref.id}`, 1);
    const src = r.board.cards.find((c) => c.id === card.id).src;
    console.log(`#${card.n} ${card.id}  v${card.v}  ${[card.ask, card.status].filter(Boolean).join(' ')}\n\n${src}`);
    const said = r.data.sends.flatMap((s) => s.items.filter((it) => it.card === card.id).map((it) => ({ ...it, round: s.round })));
    if (said.length) {
      console.log('\nhuman responses:');
      for (const it of said) console.log(`  round ${it.round}: ${it.kind} ${it.state || ''} ${it.value ?? ''} ${it.text ? JSON.stringify(it.text) : ''}`.trimEnd());
    }
  },

  ls() {
    const boards = listBoards();
    if (!boards.length) return console.log(`no boards under ${rel(boardsRoot())}/`);
    for (const ref of boards) {
      const st = fold(readLog(ref.dir));
      const n = unread(st).length;
      console.log(`${ref.id.padEnd(24)} rev ${String(st.rev).padEnd(4)} ${n ? `${n} unread  ` : ''}${boardTitle(ref)}`);
    }
  },

  async serve(a) {
    const port = Number(a.port || 4747);
    const { url } = await serve({ port, host: typeof a.host === 'string' ? a.host : '127.0.0.1' }).catch((e) => {
      if (e.code === 'EADDRINUSE') die(`port ${port} is in use; a cards serve may already be running there. Use --port.`, 1);
      throw e;
    });
    console.log(`cards: serving ${rel(boardsRoot())}/ at ${url}`);
    for (const ref of listBoards()) console.log(`  ${url}/b/${encodeURIComponent(ref.id)}`);
  },

  async wait(a) {
    const ref = resolveBoard(a._[0]);
    if (!fs.existsSync(ref.file)) die(`no board at ${rel(ref.file)}`, 1);
    const limit = Number(a.timeout || 600) * 1000;
    const start = Date.now();
    while (Date.now() - start < limit) {
      if (unread(fold(readLog(ref.dir))).length) { printUnread(ref); return; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log(`no reply on ${ref.id} within ${limit / 1000}s. The human may still be reading; run cards wait again or cards inbox later.`);
    process.exit(3);
  },

  inbox(a) {
    const refs = a._[0] ? [resolveBoard(a._[0])] : listBoards();
    let total = 0;
    for (const ref of refs) total += printUnread(ref, { peek: !!a.peek });
    if (!total && !a.quiet) console.log('no unread replies');
  },

  help() { console.log(USAGE); },
};

const a = args(process.argv.slice(2));
const cmd = a._.shift();
if (!cmd || cmd === '--help' || a.help === true) commands.help();
else if (!commands[cmd]) die(`unknown command "${cmd}"\n\n${USAGE}`);
else {
  try { await commands[cmd](a); } catch (e) { die(`cards ${cmd}: ${e.message}`, 1); }
}
