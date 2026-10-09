// store.mjs -- a board directory on disk.
//
//   .cards/<board>/board.org   the agent's current intent (source of truth;
//                              an older board.md is read too)
//   .cards/<board>/log.jsonl   append-only memory: card versions, sends, reads, the build
//   .cards/<board>/board.html  compiled, discardable
//
// The agent never writes history. `sync` diffs board.md against the log on
// every render and records new versions itself, so revisions cannot be
// forgotten. A version is a change in meaning (board.mjs canonical), not in
// syntax: converting markdown to org or re-wrapping a line is not a revision.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ID_RE, canonical, parseCard } from './board.mjs';

export const ROOT_DIR = '.cards';

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const now = () => new Date().toISOString();

// The source file in a board directory: board.org, or an older board.md.
export const SOURCES = ['board.org', 'board.md'];
export function sourceIn(dir) {
  return path.join(dir, SOURCES.find((f) => fs.existsSync(path.join(dir, f))) || SOURCES[0]);
}

export function boardsRoot(cwd = process.cwd()) {
  return path.resolve(cwd, process.env.CARDS_ROOT || ROOT_DIR);
}

// resolveBoard('queue') -> { id, dir, file }. Accepts an id, a dir, or a source file path.
export function resolveBoard(arg, cwd = process.cwd()) {
  if (!arg) throw new Error('name a board: cards <command> <board>');
  let dir;
  const asPath = path.resolve(cwd, arg);
  if (/\.(org|md)$/.test(arg) && fs.existsSync(asPath)) {
    // A loose source file is fine for `check`; a board that renders is a directory.
    const base = path.basename(asPath).replace(/\.(org|md)$/, '');
    dir = path.dirname(asPath);
    if (base !== 'board') return { id: base, dir, file: asPath };
    return { id: path.basename(dir), dir, file: asPath };
  } else if ((arg.includes('/') || arg.startsWith('.')) && fs.existsSync(asPath)) dir = asPath;
  else dir = path.join(boardsRoot(cwd), arg);
  return { id: path.basename(dir), dir, file: sourceIn(dir) };
}

// boardRef(id) -> a board under the root, from an id only: no paths, no
// traversal. Everything that takes a board name from a URL goes through here.
export function boardRef(id, cwd = process.cwd()) {
  if (!ID_RE.test(String(id))) return null;
  const dir = path.join(boardsRoot(cwd), id);
  return { id, dir, file: sourceIn(dir) };
}

export function listBoards(cwd = process.cwd()) {
  const root = boardsRoot(cwd);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && SOURCES.some((f) => fs.existsSync(path.join(root, d.name, f))))
    .map((d) => resolveBoard(path.join(root, d.name)));
}

export function readLog(dir) {
  const file = path.join(dir, 'log.jsonl');
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn last line is skipped, never fatal */ }
  }
  return out;
}

export function append(dir, events) {
  const list = Array.isArray(events) ? events : [events];
  if (!list.length) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'log.jsonl'), list.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

// fold(events) -> the state the log describes
export function fold(events) {
  const st = { rev: 0, boardHash: null, cards: new Map(), gone: new Set(), nextN: 1, sends: [], read: 0, says: [], revs: [], build: null };
  const perRev = new Map();
  for (const e of events) {
    if (e.t === 'card') {
      const prev = st.cards.get(e.id);
      const entry = prev || { n: e.n, history: [] };
      const fmt = e.fmt || 'md';
      entry.history.push({ v: e.v, rev: e.rev, at: e.at, src: e.src, fmt });
      Object.assign(entry, { v: e.v, hash: e.hash, src: e.src, fmt, rev: e.rev, at: e.at, files: e.files || null });
      st.cards.set(e.id, entry);
      st.gone.delete(e.id);
      st.nextN = Math.max(st.nextN, e.n + 1);
      perRev.set(e.rev, (perRev.get(e.rev) || 0) + 1);
    } else if (e.t === 'gone') st.gone.add(e.id);
    else if (e.t === 'back') st.gone.delete(e.id);
    else if (e.t === 'rev') { st.rev = e.rev; st.boardHash = e.hash; st.revs.push({ rev: e.rev, at: e.at, cards: perRev.get(e.rev) || 0 }); }
    else if (e.t === 'send') st.sends.push(e);
    else if (e.t === 'read') st.read = Math.max(st.read, e.round);
    else if (e.t === 'say') st.says.push({ at: e.at, text: e.text });
    else if (e.t === 'build') st.build = e.v;
  }
  return st;
}

function boardShape(board) {
  return JSON.stringify([board.title, board.lang, board.lede,
    board.sections.map((s) => [s.id, s.title, s.note, s.layout, s.cards])]);
}

// sync(dir, board) -> { rev, changed: [ids], removed: [ids] }. Appends to the log.
// With write: false nothing is written, and `events` is what a render would record.
export function sync(dir, board, { write = true } = {}) {
  const st = fold(readLog(dir));
  const at = now();
  const events = [];
  const changed = [];
  const nextRev = st.rev + 1;
  let nextN = st.nextN;
  for (const c of board.cards) {
    // A card that shows files is also a new version when a file changes.
    const files = board.assets ? board.assets.files(c.id) : null;
    const h = hash(c.src + (files ? JSON.stringify(files) : ''));
    const prev = st.cards.get(c.id);
    if (prev && (prev.hash === h || (sameMeaning(prev, c) && sameFiles(prev.files, files)))) {
      // Gone and back unchanged (a cut and paste mid-edit): same version, so answers stay valid.
      if (st.gone.has(c.id)) events.push({ t: 'back', id: c.id, rev: nextRev, at });
      continue;
    }
    const n = prev ? prev.n : nextN++;
    const v = prev ? prev.v + 1 : 1;
    events.push({ t: 'card', id: c.id, n, v, rev: nextRev, at, hash: h, src: c.src, fmt: c.fmt || 'md', ...(files ? { files } : {}) });
    changed.push(c.id);
  }
  const live = new Set(board.cards.map((c) => c.id));
  const removed = [];
  for (const id of st.cards.keys()) {
    if (!live.has(id) && !st.gone.has(id)) {
      events.push({ t: 'gone', id, rev: nextRev, at });
      removed.push(id);
    }
  }
  const shape = hash(boardShape(board));
  if (!events.length && shape === st.boardHash) return { rev: st.rev, changed, removed, ...(write ? {} : { events: [] }) };
  events.push({ t: 'rev', rev: nextRev, at, hash: shape });
  if (write) append(dir, events);
  return { rev: nextRev, changed, removed, ...(write ? {} : { events }) };
}

const sameFiles = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

function sameMeaning(prev, card) {
  const before = parseCard(prev.src, prev.fmt);
  return !!before && canonical(before) === canonical(card);
}

// via: 'board' (the served page posted it) or 'paste' (`cards ingest`). A
// pasted reply carries the key the page gave it, so one paste is one round.
export function addSend(dir, { rev, items, via = 'board', key = null }) {
  const st = fold(readLog(dir));
  const round = st.sends.length + 1;
  const ev = { t: 'send', round, rev, at: now(), via, ...(key ? { key } : {}), items };
  append(dir, ev);
  return ev;
}

// markBuild(dir, version): which build rendered this board last. A render by
// another build is said once, so an update of the skill is never silent.
export function markBuild(dir, version) {
  const st = fold(readLog(dir));
  if (st.build === version) return null;
  append(dir, { t: 'build', v: version, at: now() });
  return { from: st.build, fresh: st.rev === 0 || (st.build === null && st.revs.length <= 1) };
}

// addSay(dir, text): the agent's message in the board's chat. It changes no card.
export function addSay(dir, text) {
  const ev = { t: 'say', at: now(), text: String(text) };
  append(dir, ev);
  return ev;
}

export function markRead(dir, round) {
  append(dir, { t: 'read', round, at: now() });
}

export function unread(st) {
  return st.sends.filter((s) => s.round > st.read);
}
