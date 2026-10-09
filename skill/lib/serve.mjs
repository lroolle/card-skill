// serve.mjs -- the live loop: boards in a browser, replies to disk.
//
//   GET  /                   boards under .cards/
//   GET  /b/<id>             the board page, live
//   GET  /api/<id>/data      page data (409 + errors while the board source is broken)
//   GET  /api/<id>/events    server-sent "change" whenever the board source or the log moves
//   POST /api/<id>/send      { token, rev, items } -> log.jsonl
//
// Threat model: another web page open in the same browser, and anything that
// can reach the port. So: loopback binds only; an exact Host allowlist (DNS
// rebinding); a board id is a slug, never a path; a POST needs the per-run
// token from the served page and an Origin naming this server; every item is
// checked by kind before it reaches the log the agent reads.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildBoard } from './compile.mjs';
import { boardTitle, ID_RE } from './board.mjs';
import { addSend, boardRef, listBoards, fold, readLog, unread } from './store.mjs';
import { esc } from './md.mjs';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const MAX_BODY = 256 * 1024;
const MAX_TEXT = 10000;
const POLL_MS = 600;

// ---- payload validation, by kind ----

const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const isText = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT;
const isVer = (v) => Number.isInteger(v) && v > 0 && v < 1e6;
const strList = (v, max = 50) => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && x.length <= 500);
const only = (it, keys) => Object.keys(it).every((k) => keys.includes(k));

// An ask is answered, untouched, or held. Held: it depends on another ask
// (:NEEDS:) that has no answer yet (why: open), that the human changed from
// the suggestion (why: changed), or whose answer is not the one this ask is
// written for (why: skip). `after` marks an answer the human gave anyway.
const idList = (v) => Array.isArray(v) && v.length <= 20 && v.every(isId);
const ASK_KEYS = ['kind', 'card', 'v', 'state', 'needs', 'why', 'after'];
const ask = (it, keys, answered) => only(it, [...ASK_KEYS, ...keys]) && isId(it.card) && isVer(it.v) &&
  (it.after === undefined || idList(it.after)) &&
  (it.state === 'held' ? idList(it.needs) && it.needs.length > 0 && ['open', 'changed', 'skip'].includes(it.why) && it.value === undefined && it.text === undefined
    : it.needs === undefined && it.why === undefined && (it.state === 'untouched' ? it.value === undefined && it.text === undefined : answered(it)));

const ITEM = {
  mark: (it) => only(it, ['kind', 'card', 'v', 'value']) && isId(it.card) && isVer(it.v) && ['keep', 'drop', 'more'].includes(it.value),
  // chosen: the agent suggested nothing (:SUGGEST: none), so there was no default to keep or change.
  choose: (it) => ask(it, ['value', 'default'], (x) => ['confirmed', 'changed', 'chosen'].includes(x.state) && strList(x.value) && x.value.length > 0 && strList(x.default ?? []) && (x.state !== 'chosen' || !(x.default || []).length)) &&
    (it.default === undefined || strList(it.default)),
  approve: (it) => ask(it, ['value'], (x) => x.state === undefined && ['approve', 'reject'].includes(x.value)),
  do: (it) => ask(it, ['value'], (x) => x.state === undefined && ['done', 'cannot'].includes(x.value)),
  answer: (it) => ask(it, ['text'], (x) => x.state === undefined && isText(x.text)),
  reply: (it) => only(it, ['kind', 'card', 'v', 'text']) && isId(it.card) && isVer(it.v) && isText(it.text),
  order: (it) => only(it, ['kind', 'section', 'value']) && typeof it.section === 'string' && it.section.length <= 64 && strList(it.value, 200) && it.value.every(isId),
  note: (it) => only(it, ['kind', 'text']) && isText(it.text),
};

export function validItems(items) {
  return Array.isArray(items) && items.length > 0 && items.length <= 500 &&
    items.every((it) => it && typeof it === 'object' && !Array.isArray(it) && ITEM[it.kind] && ITEM[it.kind](it));
}

function stamp(file) {
  try { const s = fs.statSync(file); return `${s.mtimeMs}:${s.size}`; } catch { return 'none'; }
}
const boardStamp = (ref) => stamp(ref.file) + '|' + stamp(path.join(ref.dir, 'log.jsonl'));

export function serve({ cwd = process.cwd(), port = 4747, host = '127.0.0.1', log = console.log } = {}) {
  if (!LOOPBACK.has(host)) {
    return Promise.reject(new Error(`refusing to bind ${host}: boards and replies would be open to the network. Use 127.0.0.1.`));
  }
  const token = crypto.randomBytes(16).toString('hex');
  const listeners = new Map(); // board id -> Set<res>
  const stamps = new Map();
  let hosts = new Set();
  let origins = new Set();

  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  function handle(req, res) {
    if (!hosts.has(String(req.headers.host || '').toLowerCase())) return send(res, 403, { error: 'host not allowed' });
    // Segments are matched raw: a board id is a slug, so nothing needs decoding.
    const parts = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && parts.length === 0) return send(res, 200, indexPage(cwd), 'text/html; charset=utf-8');

    const ref = parts[1] ? boardRef(parts[1], cwd) : null;
    if (!ref || !fs.existsSync(ref.file)) return send(res, 404, { error: 'no such board' });

    if (req.method === 'GET' && parts[0] === 'b' && parts.length === 2) {
      const r = buildBoard(ref, { live: true, token, write: false, cwd });
      if (r.errors.length) return send(res, 409, errorPage(ref.id, r.errors), 'text/html; charset=utf-8');
      return send(res, 200, r.html, 'text/html; charset=utf-8');
    }
    if (parts[0] !== 'api' || parts.length !== 3) return send(res, 404, { error: 'not found' });

    if (req.method === 'GET' && parts[2] === 'data') {
      const r = buildBoard(ref, { live: true, token, write: false, cwd });
      if (r.errors.length) return send(res, 409, { errors: r.errors });
      return send(res, 200, r.data);
    }

    if (req.method === 'GET' && parts[2] === 'events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('event: hello\ndata: {}\n\n');
      // Baseline now, not on the next tick, so an edit right after connect is not lost.
      if (!stamps.has(ref.id)) stamps.set(ref.id, boardStamp(ref));
      if (!listeners.has(ref.id)) listeners.set(ref.id, new Set());
      listeners.get(ref.id).add(res);
      req.on('close', () => listeners.get(ref.id)?.delete(res));
      return;
    }

    if (req.method === 'POST' && parts[2] === 'send') {
      if (!origins.has(String(req.headers.origin || ''))) return send(res, 403, { error: 'origin not allowed' });
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'json only' });
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { send(res, 413, { error: 'too large' }); req.destroy(); } else chunks.push(c);
      });
      req.on('end', () => {
        if (res.writableEnded) return;
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { error: 'bad json' }); }
        if (!body || body.token !== token) return send(res, 403, { error: 'bad token; reload the page' });
        if (!validItems(body.items)) return send(res, 400, { error: 'bad items' });
        const ev = addSend(ref.dir, { rev: Number.isInteger(body.rev) ? body.rev : 0, items: body.items, via: 'board' });
        log(`cards: round ${ev.round} from ${ref.id} (${ev.items.length} responses) -> cards inbox ${ref.id}`);
        return send(res, 200, { round: ev.round });
      });
      return;
    }
    return send(res, 405, { error: 'method not allowed' });
  }

  const server = http.createServer((req, res) => {
    try { handle(req, res); } catch (e) {
      log(`cards: ${req.method} ${req.url}: ${e.message}`);
      if (!res.headersSent) send(res, 500, { error: 'server error' });
    }
  });

  const timer = setInterval(() => {
    for (const [id, set] of listeners) {
      if (!set.size) continue;
      const s = boardStamp(boardRef(id, cwd));
      if (stamps.has(id) && stamps.get(id) !== s) {
        for (const res of set) res.write('event: change\ndata: {}\n\n');
      }
      stamps.set(id, s);
    }
  }, POLL_MS);
  const beat = setInterval(() => {
    for (const set of listeners.values()) for (const res of set) res.write(': beat\n\n');
  }, 15000);

  server.on('close', () => { clearInterval(timer); clearInterval(beat); });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const p = server.address().port;
      hosts = new Set([`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`]);
      origins = new Set([...hosts].map((h) => `http://${h}`));
      const shown = host === '::1' ? '[::1]' : host;
      resolve({ server, port: p, url: `http://${shown}:${p}`, token });
    });
  });
}

function indexPage(cwd) {
  const rows = listBoards(cwd).filter((ref) => ID_RE.test(ref.id)).map((ref) => {
    const st = fold(readLog(ref.dir));
    const title = boardTitle(fs.readFileSync(ref.file, 'utf8'), ref.file) || ref.id;
    const n = unread(st).length;
    return `<li><a href="/b/${ref.id}">${esc(title)}</a><span>${esc(ref.id)} · rev ${st.rev}${n ? ` · ${n} unread` : ''}</span></li>`;
  });
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>cards</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1.5rem;color:#22252b;background:#eef0f2}
h1{font-size:1.25rem;font-weight:600}ul{list-style:none;padding:0}li{display:flex;justify-content:space-between;gap:1rem;padding:.75rem 0;border-top:1px solid #d5d9de}
a{color:inherit;font-weight:600}span{color:#5d6470;font-size:.875rem}</style>
<h1>Boards</h1><ul>${rows.join('') || '<li>No boards yet. Run <code>cards new &lt;name&gt;</code>.</li>'}</ul>`;
}

function errorPage(id, errors) {
  const list = errors.map((e) => `<li><b>line ${e.line}</b> ${esc(e.msg)}<pre>${esc(e.fix)}</pre></li>`).join('');
  // id is a slug here; it still goes in as JSON with < escaped, never spliced into a JS string.
  const url = JSON.stringify(`/api/${id}/events`).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><title>${esc(id)}: errors</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:44rem;margin:4rem auto;padding:0 1.5rem}pre{background:#f3f4f6;padding:.5rem}</style>
<h1>${esc(id)} has errors</h1><p>The agent is mid-edit, or the board source needs a fix. This page reloads when it changes.</p><ul>${list}</ul>
<script>new EventSource(${url}).addEventListener('change',()=>location.reload())</script>`;
}
