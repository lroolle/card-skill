#!/usr/bin/env node
// cards -- the card-skill command line. Node stdlib only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseBoard, formatErrors, boardTitle as titleOf, ID_RE, addIds, setStatus, moveCards } from '../lib/board.mjs';
import { lint, formatWarnings } from '../lib/lint.mjs';
import { buildBoard, outline, safeHome } from '../lib/compile.mjs';
import { resolveAssets } from '../lib/assets.mjs';
import { resolveBoard, listBoards, readLog, fold, unread, markRead, boardsRoot, addSay, addSend } from '../lib/store.mjs';
import { serve, validItems } from '../lib/serve.mjs';
import { parseReply, replyItems } from '../lib/ingest.mjs';
import { family, translationChecks } from '../lib/siblings.mjs';
import { VERSION, HOME } from '../lib/version.mjs';
import '../runtime/digest.js';

const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PATTERNS = ['decide', 'review', 'plan', 'brief', 'status'];

const USAGE = `cards -- agent-native card boards

  cards new <board> [--pattern ${PATTERNS.join('|')}] [--title "..."]
  cards check <board>              validate board.org; errors show a fix
  cards render <board> [--quiet]   check, record revisions, write board.html
                                   (--quiet: no outline, only warnings and the result)
  cards show <board> [id|n]        the board, or one card, as text
  cards ls                         boards under ${process.env.CARDS_ROOT || '.cards'}/

  cards serve [--port 4747]        live boards; replies are written to disk
  cards wait <board> [--timeout s] block until the human sends, then print it
  cards inbox [<board>] [--peek]   print unread replies and mark them read
  cards ingest [<board>]           record a reply the human pasted (text on stdin, or --file)
  cards settle <board> [id ...]    mark answered asks DONE in board.org
  cards set <board> <id|n ...> --status todo|doing|blocked|done|none
                                   set the TODO keyword of cards in board.org
  cards move <board> <id|n ...> --to <section> | --before <id|n> | --after <id|n>
                                   move cards in board.org, in the order given
  cards ids <board>                give every card without one a :CUSTOM_ID:,
                                   made from its claim and written into board.org
  cards say <board> "message"      answer the human in the board's chat
  cards hook                       the lines for a Claude Code hook that hands you
                                   unread replies with the human's next message

  cards export <board> --out <dir> a copy to publish: <dir>/index.html, with no
                                   replies, no history and no local path
                                   [--home <url>]: where its "Back" link goes
  cards shot <board> [--out f.png] a picture of the page as the human sees it
                                   [--view desk|rack] [--level claim|gist|full]
                                   [--width 1440] [--height 900] (needs playwright)
  cards --version                  this build; what changed is in CHANGES.md

A <board> is a name under .cards/, a directory, or a board.org path.
An older board.md is read as well.
Exit codes: 0 ok, 1 board errors, 2 usage, 3 wait timed out.`;

const BOOL = new Set(['peek', 'quiet', 'help', 'version']);

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

// A board.org that a command is about to edit: it must parse, so every card
// has a line. find() takes an id or the card's numeral.
function editable(name, verb) {
  const ref = resolveBoard(name);
  if (!fs.existsSync(ref.file)) die(`no board at ${rel(ref.file)}`, 1);
  if (!/\.org$/.test(ref.file)) die(`cards ${verb} edits board.org; this board is an older board.md`, 1);
  const src = fs.readFileSync(ref.file, 'utf8');
  const board = parseBoard(src, { id: ref.id, file: ref.file });
  if (board.errors.length) die(formatErrors(board.errors, rel(ref.file)), 1);
  const st = fold(readLog(ref.dir));
  const find = (name0) => {
    const w = String(name0).replace(/^#/, '');
    return board.cards.find((c) => c.id === w || String(st.cards.get(c.id)?.n) === w) || die(`no card "${w}" on ${ref.id}`, 1);
  };
  return { ref, src, board, st, find };
}
const writeStatus = (e, cards, kw) => {
  const r = setStatus(e.src, cards, kw);
  if (r.bad) die(`line ${r.bad.line} of ${rel(e.ref.file)} is not the heading of ${r.bad.id}; nothing was written. Set the keyword by hand: ** ${kw ? `${kw} ` : ''}${r.bad.title}`, 1);
  fs.writeFileSync(e.ref.file, r.src);
};

function boardTitle(ref) {
  return (fs.existsSync(ref.file) && titleOf(fs.readFileSync(ref.file, 'utf8'), ref.file)) || ref.id;
}

// Said once per board, on the first check or render by a build other than the
// one that rendered it last: an update of the skill is never silent.
const noteText = (id, from) => `note: ${id} was last rendered by ${from ? `cards ${from}` : 'an older build of cards'}; this is cards ${VERSION}. What changed: ${path.join(SKILL, 'CHANGES.md')}`;
// For `check`, which records nothing: the note stays until a render.
function buildNote(ref) {
  const st = fold(readLog(ref.dir));
  return !st.rev || st.build === VERSION ? '' : noteText(ref.id, st.build);
}
// For every command that writes the page: the render records the build, so this is said once.
const fontText = (f) => (f.state === 'embedded'
  ? `font: the page carries its own font for this language (${f.why}).`
  : `font: the page uses the reader's system font for this language: ${f.why}. To carry one in the page, see ${path.join(SKILL, 'reference', 'format.md')}, "A font in the page".`);
const saidOnce = (ref, r) => {
  if (r.built) console.log(noteText(ref.id, r.built.from) + '\n');
  if (r.font && r.font.changed) console.log(fontText(r.font) + '\n');
};

async function stdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const inContainer = () => fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');

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
    if (!board.errors.length) {
      // The files a board shows must exist and be safe to put into the page.
      const assets = resolveAssets(board, ref.dir);
      const tr = translationChecks(ref, board);
      board.errors.push(...assets.errors, ...tr.errors);
      ws.push(...assets.warnings, ...tr.warnings);
      ws.sort((x, y) => x.line - y.line);
    }
    if (board.errors.length) console.log(formatErrors(board.errors, rel(ref.file)));
    if (ws.length) console.log(formatWarnings(ws, rel(ref.file)));
    if (board.errors.length) process.exit(1);
    const note = buildNote(ref);
    if (note) console.log(note);
    console.log(`ok: ${board.cards.length} cards, ${board.sections.length} sections${ws.length ? `, ${ws.length} warnings` : ''}`);
  },

  render(a) {
    const ref = resolveBoard(a._[0]);
    const r = buildBoard(ref);
    saidOnce(ref, r);
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
    // The build that ran, so an agent whose loaded SKILL.md names another one knows its text is stale.
    console.log(`cards ${VERSION}`);
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
    if (inContainer()) {
      console.log('\nThis is a container: the human\'s browser reaches this address only if the port is published to the host.\n' +
        'If it is not, give the human the file (cards render prints its path). They answer there, press Send, and paste\n' +
        'the copied reply into the chat; record it with: cards ingest <board>');
    }
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
    let refs = listBoards();
    if (a._[0]) {
      // A board's inbox includes the replies sent from its translations.
      const ref = resolveBoard(a._[0]);
      const board = fs.existsSync(ref.file) ? parseBoard(fs.readFileSync(ref.file, 'utf8'), { id: ref.id, file: ref.file }) : null;
      const others = board ? family(ref, board).filter((m) => !m.self).map((m) => resolveBoard(m.dir)) : [];
      refs = [ref, ...others];
    }
    let total = 0;
    for (const ref of refs) total += printUnread(ref, { peek: !!a.peek });
    if (!total && !a.quiet) console.log('no unread replies');
  },

  // A reply that came as text: the human pressed Send on a page with no server
  // and pasted what it copied. Recording it makes the board show the answers.
  async ingest(a) {
    const text = typeof a.file === 'string' ? fs.readFileSync(a.file, 'utf8') : await stdin();
    if (!text.trim()) die('cards ingest [<board>] reads the pasted reply on stdin:\n  cards ingest <board> <<\'EOF\'\n  cards: reply from the board "..."\n  ...\n  EOF');
    const reply = parseReply(text);
    const name = a._[0] || reply.id || die('the reply names no board; say which: cards ingest <board>');
    const ref = resolveBoard(name);
    if (!fs.existsSync(ref.file)) die(`no board at ${rel(ref.file)}`, 1);
    if (a._[0] && reply.id && reply.id !== ref.id) die(`the reply is from the board "${reply.id}", not ${ref.id}; run: cards ingest ${reply.id}`, 1);
    const board = parseBoard(fs.readFileSync(ref.file, 'utf8'), { id: ref.id, file: ref.file });
    const st = fold(readLog(ref.dir));
    const { items, problems } = replyItems(reply, board, st);
    // One paste is one round: by its key, or for a reply with no key, by what it says.
    const dup = st.sends.find((x) => (reply.key ? x.key === reply.key : x.via === 'paste' && JSON.stringify(x.items) === JSON.stringify(items)));
    if (dup) return console.log(`already recorded as round ${dup.round} of ${ref.id}; nothing to do.`);
    if (problems.length) die(`the reply does not fit ${ref.id}:\n  ${problems.join('\n  ')}`, 1);
    if (!items.length) die('the reply holds no responses', 1);
    if (!validItems(items)) die('the reply holds a response this build cannot record; paste the text exactly as the board copied it', 1);
    const ev = addSend(ref.dir, { rev: reply.rev || st.rev, items, via: 'paste', key: reply.key });
    // The agent has this text in front of it, so this round is read. A round
    // that came before it and is still unread stays unread.
    const earlier = unread(st).length;
    if (!earlier) markRead(ref.dir, ev.round);
    const answered = items.filter((it) => it.card && it.state !== 'untouched' && it.state !== 'held' && ['choose', 'approve', 'answer', 'do'].includes(it.kind)).length;
    const held = items.filter((it) => it.state === 'held');
    console.log(`recorded round ${ev.round} of ${ref.id}: ${items.length} responses, ${answered} asks answered${held.length ? `, ${held.length} held (${held.map((it) => it.card).join(', ')}: ask again)` : ''}.`);
    if (earlier) console.log(`${earlier} earlier round${earlier > 1 ? 's are' : ' is'} unread. Read ${earlier > 1 ? 'them' : 'it'} first: cards inbox ${ref.id}`);
    console.log(`Next: revise ${rel(ref.file)}, close the answered asks (cards settle ${ref.id}), then: cards render ${ref.id}`);
  },

  // Write a card as a heading and its text; this adds the drawer with an id made
  // from the claim. The id is written once, so a later change of the claim keeps it.
  ids(a) {
    const ref = resolveBoard(a._[0]);
    if (!fs.existsSync(ref.file)) die(`no board at ${rel(ref.file)}`, 1);
    if (!/\.org$/.test(ref.file)) die('cards ids edits board.org; this board is an older board.md', 1);
    const { src, added } = addIds(fs.readFileSync(ref.file, 'utf8'));
    if (!added.length) return console.log('every card has an id; nothing to do.');
    fs.writeFileSync(ref.file, src);
    console.log(`added ${added.length} id${added.length > 1 ? 's' : ''}: ${added.map(([, idv]) => idv).join(', ')}.`);
    console.log(`Use these ids in :NEEDS:, :FROM: and [[#id]] links. Then: cards render ${ref.id}`);
  },

  // One word per card: the TODO keyword becomes DONE. The card keeps its ask and
  // its options as the record of what was asked; the page shows the answer.
  settle(a) {
    const e = editable(a._[0], 'settle');
    const { ref, board, st } = e;
    const answered = globalThis.cardsAnswered(st.sends);
    // Answered means: at the version of the card the log holds now. An answer to an older version is stale.
    const isAnswered = (c) => answered.has(`${c.id}@${st.cards.get(c.id)?.v}`);
    const want = a._.slice(1);
    const pick = want.length ? want.map(e.find) : board.cards.filter((c) => c.ask && c.status !== 'done' && isAnswered(c));
    const todo = pick.filter((c) => c.status !== 'done');
    if (!todo.length) return console.log(want.length ? 'already DONE; nothing to do.' : `no open ask on ${ref.id} has an answer on disk. A pasted reply is recorded with: cards ingest ${ref.id}`);
    writeStatus(e, todo, 'DONE');
    console.log(`DONE: ${todo.map((c) => c.id).join(', ')}. Then: cards render ${ref.id}`);
  },

  // The two other common revisions, so the agent does not match text in board.org by hand.
  set(a) {
    const kw = { todo: 'TODO', doing: 'DOING', blocked: 'BLOCKED', done: 'DONE', none: '' }[String(a.status).toLowerCase()];
    if (kw === undefined || a._.length < 2) die('usage: cards set <board> <id|n ...> --status todo|doing|blocked|done|none');
    const e = editable(a._[0], 'set');
    const picked = [...new Set(a._.slice(1).map(e.find))];
    writeStatus(e, picked, kw);
    console.log(`${kw || 'no keyword'}: ${picked.map((c) => c.id).join(', ')}. Then: cards render ${e.ref.id}`);
  },

  move(a) {
    const where = ['to', 'before', 'after'].filter((k) => typeof a[k] === 'string');
    if (a._.length < 2 || where.length !== 1) die('usage: cards move <board> <id|n ...> --to <section> | --before <id|n> | --after <id|n>');
    const e = editable(a._[0], 'move');
    const picked = [...new Set(a._.slice(1).map(e.find))];
    const k = where[0];
    const r = moveCards(e.src, e.board, picked, { [k]: k === 'to' ? a.to : e.find(a[k]) });
    // The same cards and no error after the move, or nothing is written.
    const after = parseBoard(r.src, { id: e.ref.id, file: e.ref.file });
    const ids = (b) => b.cards.map((c) => c.id).sort().join(' ');
    if (after.errors.length) die(`the move would break the board; nothing was written.\n${formatErrors(after.errors, rel(e.ref.file))}`, 1);
    if (ids(after) !== ids(e.board)) die('the move would lose or double a card; nothing was written.', 1);
    fs.writeFileSync(e.ref.file, r.src);
    console.log(`moved ${picked.map((c) => c.id).join(', ')} to ${r.into}. Then: cards render ${e.ref.id}`);
  },

  export(a) {
    const ref = resolveBoard(a._[0]);
    const out = typeof a.out === 'string' ? path.resolve(a.out) : die('cards export <board> --out <dir> [--home <url>]');
    const copies = new Map(); // file on disk -> name beside the page
    const chipHref = (asset) => {
      if (asset.kind === 'dir') return null;
      if (!copies.has(asset.abs)) {
        let name = asset.name;
        for (let k = 2; [...copies.values()].includes(name); k++) name = asset.name.replace(/(\.[^.]*)?$/, `-${k}$1`);
        copies.set(asset.abs, name);
      }
      return `files/${encodeURIComponent(copies.get(asset.abs))}`;
    };
    // --home: where the copy's "Back" link goes (the page that links to it); none without it.
    if (typeof a.home === 'string' && !safeHome(a.home)) die(`--home takes a relative address or an http(s) one, not "${a.home}"`);
    const r = buildBoard(ref, { publish: true, write: false, chipHref, home: typeof a.home === 'string' ? a.home : null });
    if (r.errors.length) die(formatErrors(r.errors, rel(ref.file)), 1);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'index.html'), r.html);
    if (copies.size) fs.mkdirSync(path.join(out, 'files'), { recursive: true });
    for (const [abs, name] of copies) fs.copyFileSync(abs, path.join(out, 'files', name));
    const langs = r.data.board.langs.filter((m) => !m.self);
    console.log(`wrote ${rel(path.join(out, 'index.html'))}${copies.size ? ` and ${copies.size} linked file${copies.size > 1 ? 's' : ''} in files/` : ''}: rev ${r.data.board.rev}, ${Object.keys(r.data.cards).length} cards.`);
    console.log('It holds the board as it is now: no replies, no chat, no past versions, no local path. Read it once before you share it; the text of the cards is yours to check.');
    if (r.font && r.font.state !== 'none') console.log(fontText(r.font));
    if (langs.length) console.log(`It links to ${langs.map((m) => `${m.href} (${m.lang})`).join(', ')}: export each of those boards into a folder with its own name, next to this one.`);
  },

  // What the human sees, as a picture: the outline cannot show a layout fault.
  async shot(a) {
    const ref = resolveBoard(a._[0]);
    const r = buildBoard(ref);
    if (r.errors.length) die(formatErrors(r.errors, rel(ref.file)), 1);
    saidOnce(ref, r);
    // Playwright is not a dependency of the skill. It is used where it already is:
    // in the project, or installed globally.
    let chromium = null;
    const from = [createRequire(path.join(process.cwd(), 'package.json')), createRequire(import.meta.url)];
    const names = ['playwright', 'playwright-core', path.join(process.env.HOME || '', '.npm-global/lib/node_modules/playwright')];
    for (const req of from) for (const p of names) {
      if (chromium) break;
      try { ({ chromium } = req(p)); } catch { /* next */ }
    }
    if (!chromium) die('cards shot needs a browser: npm install -g playwright && npx playwright install chromium\nWithout one, ask the human what they see, or read: cards show ' + ref.id, 1);
    const out = path.resolve(typeof a.out === 'string' ? a.out : path.join(ref.dir, 'shot.png'));
    const q = new URLSearchParams();
    if (typeof a.view === 'string') q.set('view', a.view);
    if (typeof a.level === 'string') q.set('level', a.level);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: Number(a.width || 1440), height: Number(a.height || 900) }, deviceScaleFactor: 2, locale: r.data.board.lang });
      await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href + (String(q) ? `?${q}` : '') + (typeof a.card === 'string' ? `#c-${a.card}` : ''));
      await page.waitForSelector('.card');
      await page.waitForTimeout(500);
      const view = await page.evaluate(() => {
        const b = document.querySelector('.board');
        const hidden = [...document.querySelectorAll('.card')].filter((c) => c.querySelector('.fig') && !c.querySelector('.fig').offsetHeight).length;
        const zoom = document.querySelector('.plane') && getComputedStyle(document.querySelector('.plane')).transform;
        return { cls: b.className, hidden, scale: zoom && zoom !== 'none' ? Number(zoom.match(/matrix\(([\d.]+)/)?.[1] || 1) : 1 };
      });
      await page.screenshot({ path: out });
      const level = (view.cls.match(/alt-(\w+)/) || [])[1];
      console.log(`wrote ${rel(out)}: the ${/view-desk/.test(view.cls) ? 'desk' : 'rack'} at ${level}${/view-desk/.test(view.cls) ? `, ${Math.round(view.scale * 100)}%` : ''}.${view.hidden ? ` ${view.hidden} figure${view.hidden > 1 ? 's are' : ' is'} not shown at this level.` : ''}`);
      // A page that carries its own font cannot show boxes for that language; the hint is for the others.
      if (!/^en/i.test(r.data.board.lang) && !(r.font && r.font.state === 'embedded')) console.log('If the text shows as boxes, this machine has no font for the language; the human\'s browser will have one.');
    } finally { await browser.close(); }
  },

  // Replies that arrive on their own: the lines for a Claude Code hook. The
  // agent shows them to the human; it does not edit the human's settings itself.
  hook() {
    // The hook runs where the session stands at that moment, and an agent changes directory.
    // Claude Code names the project's root in CLAUDE_PROJECT_DIR: the boards are looked for there.
    const command = `cd "\${CLAUDE_PROJECT_DIR:-.}" && node ${JSON.stringify(path.join(SKILL, 'bin', 'cards.mjs'))} inbox --quiet`;
    const snippet = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command }] }] } };
    console.log('With this hook, Claude Code runs `cards inbox` each time the human sends a message.');
    console.log('Unread replies from every board under .cards/ of the project then reach the agent with that message,');
    console.log('and are marked read. Merge it into .claude/settings.json of the project (or of the user):\n');
    console.log(JSON.stringify(snippet, null, 2));
    console.log('\nIt prints nothing when no reply waits. Ask the human before you change their settings.');
  },

  version() { console.log(`cards ${VERSION}\n${HOME}\nWhat changed: ${path.join(SKILL, 'CHANGES.md')}`); },

  // The agent's side of the chat: a short message, shown in the chat box. It
  // changes no card; anything the human should judge belongs on the board.
  say(a) {
    const ref = resolveBoard(a._[0]);
    const text = a._.slice(1).join(' ').trim();
    if (!text) die('cards say <board> "message"');
    if (text.length > 2000) die('a chat message is 2000 characters at most; put longer content on the board', 1);
    if (!fs.existsSync(ref.file)) die(`no board at ${rel(ref.file)}`, 1);
    addSay(ref.dir, text);
    const r = buildBoard(ref, { cwd: process.cwd() });
    if (r.errors.length) die(`said; but the board has errors, so board.html was not rebuilt:\n${formatErrors(r.errors, rel(ref.file))}`, 1);
    saidOnce(ref, r);
    console.log(`said on ${ref.id}. A served page shows it now; a file page shows it after a reload.`);
  },

  help() { console.log(USAGE); },
};

const a = args(process.argv.slice(2));
const cmd = a._.shift();
if (a.version === true && !cmd) commands.version();
else if (!cmd || cmd === '--help' || a.help === true) commands.help();
else if (!commands[cmd]) die(`unknown command "${cmd}"\n\n${USAGE}`);
else {
  try { await commands[cmd](a); } catch (e) { die(`cards ${cmd}: ${e.message}`, 1); }
}
