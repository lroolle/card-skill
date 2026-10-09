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

const DESK = `---
title: Desk test
---

# One

## Card a starts the chain {#a}
Gist a.

## Card b stands alone here {#b}
Gist b.

# Two

## Card c follows from a {#c from=a}
Gist c.

## Card d follows from c {#d from=c}
Gist d.

## Card e mentions another card {#e}
Gist e, after [[a]].

# Three

## Card f needs c first {#f needs=c}
Gist f.

## Pick a or f {#g ask=choose}
Why.

- [x] [[a]]
- [ ] [[f]]
`;

test('desk: one column per section, a line per link, focus lights its lines, no line behind a card', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  fs.writeFileSync(ref.file, DESK);
  buildBoard(ref, { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href);
    assert.equal(await page.locator('.wire').count(), 0, 'the rack draws no lines');
    await page.click('[data-act="desk"]');
    assert.ok((await page.getAttribute('.board', 'class')).includes('view-desk'));
    assert.equal(await page.getAttribute('[data-act="desk"]', 'aria-pressed'), 'true');
    // option a->g, option f->g, needs c->f, from a->c, from c->d. The mention e->a draws only in focus.
    await page.waitForFunction(() => document.querySelectorAll('.wire').length === 5);
    const lefts = await page.$$eval('.shelf', (els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    assert.ok(lefts[0] < lefts[1] && lefts[1] < lefts[2], 'sections are columns, left to right');

    await page.click('#c-a .claim');
    await page.waitForFunction(() => document.querySelectorAll('.wire').length === 6);
    assert.equal(await page.locator('.wire.on').count(), 3, 'a: option of g, source of c, mentioned by e');
    assert.equal(await page.textContent('#c-g .rel'), 'Decides 1');
    // On the desk no marks bar floats over a card: the lit card under the pointer keeps its link label.
    await page.hover('#c-g .claim');
    assert.equal(await page.isVisible('#c-g .acts'), false);
    assert.equal(await page.isVisible('#c-a .acts'), true, 'the focused card shows its marks as a footer');
    const covered = await page.evaluate(() => {
      const r = document.querySelector('#c-g .rel').getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !hit.closest('.rel');
    });
    assert.equal(covered, false);

    // The line from a (column 1) to g (column 3) crosses column 2 in a gap, not behind c, d or e.
    const behind = await page.evaluate(() => {
      const paths = [...document.querySelectorAll('path.wire[data-a="a"][data-b="g"]')];
      const box = document.querySelector('.shelves').getBoundingClientRect();
      const rects = [...document.querySelectorAll('.card')].filter((c) => !['a', 'g'].includes(c.dataset.id))
        .map((c) => ({ id: c.dataset.id, r: c.getBoundingClientRect() }));
      const hits = new Set();
      for (const path of paths) {
        const len = path.getTotalLength();
        for (let s = 0; s <= len; s += 4) {
          const p = path.getPointAtLength(s);
          const x = p.x + box.left;
          const y = p.y + box.top;
          for (const { id, r } of rects) if (x > r.left + 1 && x < r.right - 1 && y > r.top + 1 && y < r.bottom - 1) hits.add(id);
        }
      }
      return paths.length ? [...hits] : ['no path'];
    });
    assert.deepEqual(behind, []);

    // Lines follow the cards when the level of detail changes.
    // The desk keeps its own level of detail: it opened at Claim; the rack stays at Gist.
    assert.ok((await page.getAttribute('.board', 'class')).includes('alt-claim'));
    const before = await page.getAttribute('path.wire[data-a="c"][data-b="d"]', 'd');
    await page.keyboard.press('Escape');
    await page.keyboard.press('3');
    await page.waitForFunction((b) => document.querySelector('path.wire[data-a="c"][data-b="d"]').getAttribute('d') !== b, before);

    // Back to Claim: the line layer shrinks with the cards; no empty table, no inner vertical scroll.
    await page.keyboard.press('1');
    await page.waitForTimeout(100);
    const fit = await page.evaluate(() => {
      const box = document.querySelector('.shelves');
      const shelves = [...box.querySelectorAll('.shelf')];
      const right = Math.max(...shelves.map((x) => x.getBoundingClientRect().right)) - box.getBoundingClientRect().left + box.scrollLeft;
      return { scrollW: box.scrollWidth, need: Math.max(box.clientWidth, right + parseFloat(getComputedStyle(box).paddingRight)), scrollH: box.scrollHeight, clientH: box.clientHeight };
    });
    assert.ok(fit.scrollW <= Math.ceil(fit.need) + 1, `desk ${fit.scrollW}px wide for ${fit.need}px of columns`);
    assert.ok(fit.scrollH <= fit.clientH + 1, 'no vertical scroll inside the desk');

    await page.keyboard.press('d');
    assert.ok((await page.getAttribute('.board', 'class')).includes('view-rack'));
    assert.ok((await page.getAttribute('.board', 'class')).includes('alt-gist'), 'the rack keeps its own level');
    assert.equal(await page.locator('.wire').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('figures: a flow box darkens its own arrows under the pointer', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  fs.writeFileSync(ref.file, '---\ntitle: F\n---\n\n## A loop drawn as a flow {#a}\nGist.\n\n```flow The loop\nx -> y: go\ny -> z\n```\n');
  buildBoard(ref, { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href);
    assert.match(await page.textContent('#c-a figcaption'), /Fig\. 1\.1\s+The loop/);
    await page.hover('#c-a .fn[data-n="1"]');
    assert.equal(await page.locator('#c-a .fe.hot').count(), 2, 'y has two arrows');
    await page.hover('#c-a .fn[data-n="0"]');
    assert.equal(await page.locator('#c-a .fe.hot').count(), 1);
  } finally {
    await browser.close();
  }
});

test('desk on a phone: the page stays as wide as the screen, and Send stays on screen', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  fs.writeFileSync(ref.file, DESK);
  buildBoard(ref, { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href);
    await page.tap('[data-act="desk"]');
    assert.ok((await page.getAttribute('.board', 'class')).includes('view-desk'));
    const m = await page.evaluate(() => {
      const r = document.querySelector('.send').getBoundingClientRect();
      return { doc: document.documentElement.scrollWidth, vw: window.innerWidth, send: [r.left, r.right, r.top, r.bottom] };
    });
    assert.deepEqual([m.doc, m.vw], [390, 390], 'the desk scrolls inside itself; the page and the viewport stay 390 wide');
    assert.ok(m.send[0] >= 0 && m.send[1] <= m.vw && m.send[3] <= 844, `Send at ${m.send}`);
  } finally {
    await browser.close();
  }
});

test('reading: a drag that selects text does not open or close the card', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  buildBoard(ref, { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href);
    const drag = async () => {
      const r = await page.locator('#c-nats .gist p').boundingBox();
      await page.mouse.move(r.x + 4, r.y + 6);
      await page.mouse.down();
      await page.mouse.move(r.x + r.width / 2, r.y + 6, { steps: 5 });
      await page.mouse.up();
      return page.evaluate(() => String(window.getSelection()).length);
    };
    assert.ok(await drag() > 0, 'text is selected');
    assert.ok(!(await page.getAttribute('#c-nats', 'class')).includes('open'), 'a closed card stays closed');
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await page.click('#c-nats .claim');
    assert.ok((await page.getAttribute('#c-nats', 'class')).includes('open'));
    assert.ok(await drag() > 0);
    assert.ok((await page.getAttribute('#c-nats', 'class')).includes('open'), 'an open card stays open');
  } finally {
    await browser.close();
  }
});
