// End-to-end: the whole loop in a real browser.
// Agent writes board.md -> server -> human chooses, marks, replies, sends ->
// log.jsonl -> agent reads the digest -> agent revises -> page updates live.
// Skips when Playwright is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { serve } from '../skill/lib/serve.mjs';
import { resolveBoard, fold, readLog, unread } from '../skill/lib/store.mjs';
import { buildBoard } from '../skill/lib/compile.mjs';

const require = createRequire(import.meta.url);
let chromium = null;
for (const p of ['playwright', path.join(os.homedir(), '.npm-global/lib/node_modules/playwright')]) {
  try { ({ chromium } = require(p)); break; } catch { /* try next */ }
}
const SKILL = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'skill');

function setup() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-e2e-'));
  const ref = resolveBoard('queue', cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  fs.copyFileSync(path.join(SKILL, 'templates', 'decide.md'), ref.file);
  return { cwd, ref };
}

test('live loop: choose, mark, reply, send, then the agent revises', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  const { server, url } = await serve({ cwd, port: 0, log: () => {} });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}/b/queue`);

    await assert.doesNotReject(page.waitForSelector('.lamp[data-turn="you"]'));
    assert.match(await page.textContent('.lamp'), /1 waiting on you/);
    // The andon rail puts the ask in the first viewport.
    assert.match(await page.textContent('.rail'), /6\s*Choose/);

    // Focus lights up relations: NATS is an option of the decision card.
    await page.click('#c-nats .claim');
    assert.equal(await page.getAttribute('#c-nats', 'class').then((c) => c.includes('focused')), true);
    assert.equal(await page.textContent('#c-pick-queue .rel'), 'Decides 3');
    assert.equal(await page.textContent('#c-nats .context'), 'Decided in 6');
    assert.ok((await page.getAttribute('#c-need-peak', 'class')).includes('lit') === false);

    // Choose against the suggestion, mark, reply.
    await page.click('#c-pick-queue .opt:has(input[value="kafka"])');
    await page.waitForSelector('#c-pick-queue[data-answered]');
    assert.equal(await page.textContent('#c-pick-queue .tab'), 'Chosen');
    await page.hover('#c-nats');
    await page.click('#c-nats [data-mark="more"]');
    assert.equal(await page.textContent('#c-nats .stamp'), 'More asked');
    await page.hover('#c-sqs');
    await page.click('#c-sqs [data-act="reply"]');
    await page.fill('#c-sqs textarea[data-field="reply"]', 'We already run SQS in prod.');
    assert.equal(await page.textContent('[data-act="send"]'), 'Send 3');

    // Undo over confirmation: a held round can be taken back.
    await page.click('[data-act="send"]');
    await page.click('.toast button');
    await page.waitForTimeout(5500);
    assert.equal(fold(readLog(ref.dir)).sends.length, 0, 'undo kept the round home');
    await page.click('[data-act="send"]');
    await page.waitForSelector('.lamp[data-turn="agent"]', { timeout: 10000 });

    const st = fold(readLog(ref.dir));
    const [batch] = unread(st);
    assert.equal(batch.round, 1);
    const kinds = batch.items.map((it) => `${it.card}:${it.kind}:${it.state || it.value || it.text}`);
    assert.deepEqual(kinds.sort(), [
      'nats:mark:more',
      'pick-queue:choose:changed',
      'sqs:reply:We already run SQS in prod.',
    ]);

    // The agent revises: the decision is settled, the SQS card changes.
    const md = fs.readFileSync(ref.file, 'utf8')
      .replace('{#pick-queue ask=choose from=nats,kafka,sqs}', '{#pick-queue status=done from=nats,kafka,sqs}')
      .replace('Pick NATS JetStream unless replay beyond 7 days matters', 'Kafka, as chosen in round 1');
    fs.writeFileSync(ref.file, md);
    await page.waitForFunction(() => document.querySelector('#c-pick-queue .claim')?.textContent.includes('Kafka, as chosen'), null, { timeout: 5000 });
    assert.equal(await page.getAttribute('#c-pick-queue', 'data-status'), 'done');
    assert.match(await page.textContent('#c-pick-queue .addr'), /v2/);
    assert.match(await page.textContent('#c-pick-queue .addr'), /Changed/);
    assert.match(await page.textContent('#c-pick-queue .thread'), /You · r1/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test('send rejects a forged request without the page token', async () => {
  const { cwd } = setup();
  const { server, url } = await serve({ cwd, port: 0, log: () => {} });
  try {
    const bad = await fetch(`${url}/api/queue/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'nope', items: [] }) });
    assert.equal(bad.status, 403);
    const cross = await fetch(`${url}/api/queue/send`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
    assert.equal(cross.status, 403);
    // fetch() drops a custom Host header, so DNS rebinding is tested with a raw request.
    const rebind = await new Promise((resolve, reject) => {
      const u = new URL(`${url}/api/queue/data`);
      http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(rebind, 403);
  } finally {
    server.close();
  }
});

test('file mode: Send opens the copy dialog with the digest', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  buildBoard(ref, { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href);
    await page.click('#c-pick-queue .opt:has(input[value="nats"])');
    assert.match(await page.textContent('#c-pick-queue .opt.on .hint'), /Suggested · chosen/);
    await page.keyboard.press('Control+Enter');
    const text = await page.inputValue('dialog textarea');
    assert.match(text, /#6 pick-queue\s+choose\s+confirmed: nats/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('keyboard: j/k move focus, 1/2/3 set altitude, n finds the waiting card', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  buildBoard(ref, { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href);
    await page.keyboard.press('j');
    assert.ok((await page.getAttribute('#c-need-peak', 'class')).includes('focused'));
    await page.keyboard.press('1');
    assert.ok((await page.getAttribute('.board', 'class')).includes('alt-claim'));
    assert.equal(await page.isVisible('#c-nats .gist'), false);
    await page.keyboard.press('n');
    assert.ok((await page.getAttribute('#c-pick-queue', 'class')).includes('focused'));
    assert.equal(await page.isVisible('#c-pick-queue .ask'), true, 'the waiting card opens');

    // Tab onto a card, then a mark key acts on that card: keys follow the ring.
    await page.keyboard.press('Escape');
    await page.focus('#c-sqs');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('=');
    assert.equal(await page.textContent('#c-sqs .stamp'), 'Kept');
  } finally {
    await browser.close();
  }
});
