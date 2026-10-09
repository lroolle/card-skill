// Regressions for the 2026-10-08 code review. One test per finding.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { inline, renderMarkdown, parseBlocks } from '../skill/lib/md.mjs';
import { parseBoard } from '../skill/lib/board.mjs';
import { sync, fold, readLog, resolveBoard } from '../skill/lib/store.mjs';
import { buildBoard, outline } from '../skill/lib/compile.mjs';
import { serve, validItems } from '../skill/lib/serve.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const CLI = path.join(ROOT, 'skill', 'bin', 'cards.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cards-rv-'));
const board = (body, title = 'T') => `---\ntitle: ${title}\n---\n${body}`;

function rawGet(url, pathname, headers = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    http.get({ host: u.hostname, port: u.port, path: pathname, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function withServer(fn) {
  const cwd = tmp();
  const ref = resolveBoard('queue', cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  fs.writeFileSync(ref.file, board('## A claim with words {#a}\nGist.\n'));
  const { server, url, token } = await serve({ cwd, port: 0, log: () => {} });
  try { await fn({ cwd, url, token }); } finally { server.close(); }
}

test('serve: a board id is a slug; quotes, traversal and bad escapes get 404, and the server lives', () => withServer(async ({ cwd, url }) => {
  assert.equal((await rawGet(url, "/b/zz'zz")).status, 404);
  assert.equal((await rawGet(url, '/b/..%2F..%2Foutside')).status, 404);
  assert.equal(fs.existsSync(path.join(cwd, 'outside')), false, 'nothing written outside .cards');
  assert.equal((await rawGet(url, '/api/%2Ftmp%2Fx/data')).status, 404);
  assert.equal((await rawGet(url, '/b/%E0')).status, 404);
  assert.equal((await rawGet(url, '/b/queue')).status, 200, 'still serving');
}));

test('serve: an error page never splices the id into script', () => withServer(async ({ cwd, url }) => {
  fs.writeFileSync(path.join(cwd, '.cards', 'queue', 'board.md'), board('## no id here\n'));
  const r = await rawGet(url, '/b/queue');
  assert.equal(r.status, 409);
  assert.match(r.body, /new EventSource\("\/api\/queue\/events"\)/);
}));

test('serve: a POST without this server as Origin is refused', () => withServer(async ({ url, token }) => {
  const r = await fetch(`${url}/api/queue/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, items: [{ kind: 'note', text: 'x' }] }) });
  assert.equal(r.status, 403, 'Node fetch sends no Origin; a browser always does');
}));

test('serve: refuses to bind beyond loopback', async () => {
  await assert.rejects(serve({ cwd: tmp(), port: 0, host: '0.0.0.0' }), /refusing to bind/);
});

test('serve: items are checked by kind', () => {
  assert.equal(validItems([{ kind: 'choose', card: 'a', v: 1, value: 'nats', state: 'changed' }]), false, 'value must be a list');
  assert.equal(validItems([{ kind: 'mark', card: 'a', v: 1, value: 'love' }]), false);
  assert.equal(validItems([{ kind: 'reply', card: '../x', v: 1, text: 'hi' }]), false);
  assert.equal(validItems([{ kind: 'note', text: 'hi', extra: 1 }]), false);
  assert.equal(validItems([]), false);
  assert.equal(validItems([{ kind: 'choose', card: 'a', v: 1, value: ['nats'], default: ['nats'], state: 'confirmed' }, { kind: 'approve', card: 'b', v: 2, state: 'untouched' }]), true);
});

test('md: NUL in author text cannot name a placeholder', () => {
  const html = inline('[a](x\u00000\u0000) `\u00000\u0000` [[r]]', { ref: () => '<span class="ref">r</span>' });
  assert.ok(!/href="[^"]*</.test(html), 'no markup inside an href');
  assert.ok(html.includes('�'));
});

test('md: one fence rule; backticks in the info string mean not a fence', () => {
  const b = parseBoard(board('## First card here {#a}\n```x``` is the syntax.\n\n## Second card here {#b}\nStill here.\n'));
  assert.deepEqual(b.cards.map((c) => c.id), ['a', 'b']);
  const blocks = parseBlocks('```c++\nint x;\n```\nafter');
  assert.equal(blocks[0].type, 'code');
  assert.equal(blocks[0].lang, 'c++');
  assert.equal(blocks[1].text, 'after');
});

test('md: a trailing # without a space stays in the heading', () => {
  assert.equal(renderMarkdown('### Use C#'), '<h4>Use C#</h4>');
  assert.equal(renderMarkdown('### Closed ###'), '<h4>Closed</h4>');
});

test('store: a card that leaves and returns unchanged keeps its version', () => {
  const dir = tmp();
  const both = parseBoard(board('## Alpha claim here {#a}\nx\n\n## Beta claim here {#b}\ny\n'));
  const onlyA = parseBoard(board('## Alpha claim here {#a}\nx\n'));
  sync(dir, both);
  sync(dir, onlyA);
  sync(dir, both);
  const st = fold(readLog(dir));
  assert.equal(st.cards.get('b').v, 1);
  assert.equal(st.gone.has('b'), false);
});

test('compile: the terminal outline prints plain text, not entities', () => {
  const cwd = tmp();
  const ref = resolveBoard('demo', cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  fs.writeFileSync(ref.file, board(`## R&D owns the "ingest" model's queue {#a}\nx\n`));
  const r = buildBoard(ref, { cwd });
  assert.match(outline(r.data), /R&D owns the "ingest" model's queue/);
});

test('cli: boolean flags do not eat the board name; --title is literal', () => {
  const cwd = tmp();
  execFileSync('node', [CLI, 'new', 'q', '--pattern', 'decide', '--title', 'Cost $& more'], { cwd });
  assert.match(fs.readFileSync(path.join(cwd, '.cards/q/board.md'), 'utf8'), /^title: Cost \$& more$/m);
  const out = execFileSync('node', [CLI, 'render', '--quiet', 'q'], { cwd, encoding: 'utf8' });
  assert.match(out, /^rev 1/);
  assert.throws(() => execFileSync('node', [CLI, 'new', 'Bad Name'], { cwd, stdio: 'pipe' }));
});
