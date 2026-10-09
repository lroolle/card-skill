// store.mjs -- a board directory on disk.
//
//   .cards/<board>/board.md    the agent's current intent (source of truth)
//   .cards/<board>/log.jsonl   append-only memory: card versions, sends, reads
//   .cards/<board>/board.html  compiled, discardable
//
// The agent never writes history. `sync` diffs board.md against the log on
// every render and records new versions itself, so revisions cannot be
// forgotten.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ID_RE } from './board.mjs';

export const ROOT_DIR = '.cards';

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const now = () => new Date().toISOString();

export function boardsRoot(cwd = process.cwd()) {
  return path.resolve(cwd, process.env.CARDS_ROOT || ROOT_DIR);
}

// resolveBoard('queue') -> { id, dir, file }. Accepts an id, a dir, or a board.md path.
export function resolveBoard(arg, cwd = process.cwd()) {
  if (!arg) throw new Error('name a board: cards <command> <board>');
  let dir;
  const asPath = path.resolve(cwd, arg);
  if (arg.endsWith('.md') && fs.existsSync(asPath)) {
    // A loose .md file is fine for `check`; a board that renders is a directory.
    const base = path.basename(asPath, '.md');
    dir = path.dirname(asPath);
    if (base !== 'board') return { id: base, dir, file: asPath };
  } else if ((arg.includes('/') || arg.startsWith('.')) && fs.existsSync(asPath)) dir = asPath;
  else dir = path.join(boardsRoot(cwd), arg);
  return { id: path.basename(dir), dir, file: path.join(dir, 'board.md') };
}

// boardRef(id) -> a board under the root, from an id only: no paths, no
// traversal. Everything that takes a board name from a URL goes through here.
export function boardRef(id, cwd = process.cwd()) {
  if (!ID_RE.test(String(id))) return null;
  const dir = path.join(boardsRoot(cwd), id);
  return { id, dir, file: path.join(dir, 'board.md') };
}

export function listBoards(cwd = process.cwd()) {
  const root = boardsRoot(cwd);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'board.md')))
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
  const st = { rev: 0, boardHash: null, cards: new Map(), gone: new Set(), nextN: 1, sends: [], read: 0 };
  for (const e of events) {
    if (e.t === 'card') {
      const prev = st.cards.get(e.id);
      const entry = prev || { n: e.n, history: [] };
      entry.history.push({ v: e.v, rev: e.rev, at: e.at, src: e.src });
      Object.assign(entry, { v: e.v, hash: e.hash, src: e.src, rev: e.rev, at: e.at });
      st.cards.set(e.id, entry);
      st.gone.delete(e.id);
      st.nextN = Math.max(st.nextN, e.n + 1);
    } else if (e.t === 'gone') st.gone.add(e.id);
    else if (e.t === 'back') st.gone.delete(e.id);
    else if (e.t === 'rev') { st.rev = e.rev; st.boardHash = e.hash; }
    else if (e.t === 'send') st.sends.push(e);
    else if (e.t === 'read') st.read = Math.max(st.read, e.round);
  }
  return st;
}

function boardShape(board) {
  return JSON.stringify([board.title, board.lang, board.lede,
    board.sections.map((s) => [s.id, s.title, s.note, s.layout, s.cards])]);
}

// sync(dir, board) -> { rev, changed: [ids], removed: [ids] }. Appends to the log.
export function sync(dir, board) {
  const st = fold(readLog(dir));
  const at = now();
  const events = [];
  const changed = [];
  const nextRev = st.rev + 1;
  let nextN = st.nextN;
  for (const c of board.cards) {
    const h = hash(c.src);
    const prev = st.cards.get(c.id);
    if (prev && prev.hash === h) {
      // Gone and back unchanged (a cut and paste mid-edit): same version, so answers stay valid.
      if (st.gone.has(c.id)) events.push({ t: 'back', id: c.id, rev: nextRev, at });
      continue;
    }
    const n = prev ? prev.n : nextN++;
    const v = prev ? prev.v + 1 : 1;
    events.push({ t: 'card', id: c.id, n, v, rev: nextRev, at, hash: h, src: c.src });
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
  if (!events.length && shape === st.boardHash) return { rev: st.rev, changed, removed };
  events.push({ t: 'rev', rev: nextRev, at, hash: shape });
  append(dir, events);
  return { rev: nextRev, changed, removed };
}

export function addSend(dir, { rev, items, via = 'board' }) {
  const st = fold(readLog(dir));
  const round = st.sends.length + 1;
  const ev = { t: 'send', round, rev, at: now(), via, items };
  append(dir, ev);
  return ev;
}

export function markRead(dir, round) {
  append(dir, { t: 'read', round, at: now() });
}

export function unread(st) {
  return st.sends.filter((s) => s.round > st.read);
}
