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
import { resolveBoard, fold, readLog, unread, addSay } from '../skill/lib/store.mjs';
import { buildBoard } from '../skill/lib/compile.mjs';
import { png } from './png.mjs';

const require = createRequire(import.meta.url);
// The engine under test: chromium (the default), firefox or webkit (CARDS_BROWSER).
// The name `chromium` below is whichever engine was asked for.
const ENGINE = process.env.CARDS_BROWSER || 'chromium';
let chromium = null;
for (const p of ['playwright', path.join(os.homedir(), '.npm-global/lib/node_modules/playwright')]) {
  try { chromium = require(p)[ENGINE] || null; break; } catch { /* try next */ }
}
// CI sets CARDS_E2E=required: there, a missing browser fails the run instead of passing it quietly.
if (!chromium && process.env.CARDS_E2E === 'required') throw new Error('CARDS_E2E=required, but Playwright did not load');
const SKILL = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'skill');

// The board opens on the desk (D15). Tests about reading and answering use the rack.
async function toRack(page) {
  await page.keyboard.press('d');
  await page.waitForSelector('.board.view-rack');
}

function setup() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-e2e-'));
  const ref = resolveBoard('queue', cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  fs.copyFileSync(path.join(SKILL, 'templates', 'decide.org'), ref.file);
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
    await toRack(page);

    await assert.doesNotReject(page.waitForSelector('.lamp[data-turn="you"]'));
    assert.match(await page.textContent('.lamp'), /1 waiting on you/);
    // The andon rail puts the ask in the first viewport.
    assert.match(await page.textContent('.rail'), /6\s*Choose/);

    // Focus lights up relations: NATS is an option of the decision card.
    await page.click('#c-nats .claim');
    assert.equal(await page.getAttribute('#c-nats', 'class').then((c) => c.includes('focused')), true);
    assert.equal(await page.textContent('#c-pick-queue .rel'), 'Decides #3');
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
    const org = fs.readFileSync(ref.file, 'utf8')
      .replace(':ASK: choose\n', '')
      .replace('** Pick NATS JetStream unless replay beyond 7 days matters', '** DONE Kafka, as chosen in round 1');
    fs.writeFileSync(ref.file, org);
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
    await toRack(page);
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
    await toRack(page);
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

const card = (title, props, body) => `** ${title}\n:PROPERTIES:\n${Object.entries(props).map(([k, v]) => `:${k}: ${v}`).join('\n')}\n:END:\n${body}\n`;
const DESK = [
  '#+title: Desk test\n',
  '* One',
  card('Card a starts the chain', { CUSTOM_ID: 'a' }, 'Gist a.'),
  card('Card b stands alone here', { CUSTOM_ID: 'b' }, 'Gist b.'),
  '* Two',
  card('Card c follows from a', { CUSTOM_ID: 'c', FROM: 'a' }, 'Gist c.'),
  card('Card d follows from c', { CUSTOM_ID: 'd', FROM: 'c' }, 'Gist d.'),
  card('Card e mentions another card', { CUSTOM_ID: 'e' }, 'Gist e, after [[#a]].'),
  '* Three',
  card('Card f needs c first', { CUSTOM_ID: 'f', NEEDS: 'c' }, 'Gist f.'),
  card('Pick a or f', { CUSTOM_ID: 'g', ASK: 'choose' }, 'Why.\n\n- [X] [[#a]]\n- [ ] [[#f]]'),
].join('\n');

test('desk: one column per section, a line per link, focus lights its lines, no line behind a card', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  fs.writeFileSync(ref.file, DESK);
  buildBoard(ref, { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href + '?level=claim');
    assert.ok((await page.getAttribute('.board', 'class')).includes('view-desk'), 'the board opens on the desk');
    assert.equal(await page.getAttribute('[data-act="desk"]', 'aria-pressed'), 'true');
    // option a->g, option f->g, needs c->f, from a->c, from c->d. The mention e->a draws only in focus.
    await page.waitForFunction(() => document.querySelectorAll('.wires .wire').length === 5);
    const lefts = await page.$$eval('.shelf', (els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    assert.ok(lefts[0] < lefts[1] && lefts[1] < lefts[2], 'sections are columns, left to right');

    await page.click('#c-a .claim');
    await page.waitForFunction(() => document.querySelectorAll('.wires .wire').length === 6);
    assert.equal(await page.locator('.wires .wire.on').count(), 3, 'a: option of g, source of c, mentioned by e');
    assert.equal(await page.textContent('#c-g .rel'), 'Decides #1');
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
      const paths = [...document.querySelectorAll('.wires .wire[data-a="a"][data-b="g"] .ln')];
      const rects = [...document.querySelectorAll('.card')].filter((c) => !['a', 'g'].includes(c.dataset.id))
        .map((c) => ({ id: c.dataset.id, r: c.getBoundingClientRect() }));
      const hits = new Set();
      for (const path of paths) {
        const len = path.getTotalLength();
        for (let s = 0; s <= len; s += 4) {
          const p = new DOMPoint(path.getPointAtLength(s).x, path.getPointAtLength(s).y).matrixTransform(path.getScreenCTM());
          const x = p.x;
          const y = p.y;
          for (const { id, r } of rects) if (x > r.left + 1 && x < r.right - 1 && y > r.top + 1 && y < r.bottom - 1) hits.add(id);
        }
      }
      return paths.length ? [...hits] : ['no path'];
    });
    assert.deepEqual(behind, []);

    // Lines follow the cards when the level of detail changes.
    // The desk keeps its own level of detail: this page was opened at Claim (?level=claim); the rack stays at Gist.
    assert.ok((await page.getAttribute('.board', 'class')).includes('alt-claim'));
    const before = await page.getAttribute('.wires .wire[data-a="c"][data-b="d"] .ln', 'd');
    await page.keyboard.press('Escape');
    await page.keyboard.press('3');
    await page.waitForFunction((b) => document.querySelector('.wires .wire[data-a="c"][data-b="d"] .ln').getAttribute('d') !== b, before);

    // Back to Claim: the line layer shrinks with the cards, and the zoom frame follows the plane.
    await page.keyboard.press('1');
    await page.waitForTimeout(150);
    const fit = await page.evaluate(() => {
      const plane = document.querySelector('.plane');
      const svg = document.querySelector('.wires');
      const sizer = document.querySelector('.sizer');
      const scale = plane.getBoundingClientRect().width / plane.offsetWidth;
      return { svgW: +svg.getAttribute('width'), planeW: plane.offsetWidth, sizerW: sizer.offsetWidth, scaledW: plane.offsetWidth * scale };
    });
    assert.ok(fit.svgW <= fit.planeW + 1, `line layer ${fit.svgW}px in a ${fit.planeW}px plane`);
    assert.ok(Math.abs(fit.sizerW - fit.scaledW) <= 2, 'the scroll size matches the zoomed plane');

    await page.keyboard.press('d');
    assert.ok((await page.getAttribute('.board', 'class')).includes('view-rack'));
    assert.ok((await page.getAttribute('.board', 'class')).includes('alt-gist'), 'the rack keeps its own level');
    assert.equal(await page.locator('.wires .wire').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('figures: a flow box darkens its own arrows under the pointer', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  fs.writeFileSync(ref.file, '#+title: F\n\n** A loop drawn as a flow\n:PROPERTIES:\n:CUSTOM_ID: a\n:END:\nGist.\n\n#+caption: The loop\n#+begin_src flow\n  x -> y: go\n  y -> z\n#+end_src\n');
  buildBoard(ref, { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href);
    await toRack(page);
    assert.match(await page.textContent('#c-a figcaption'), /Fig\. 1\.1\s+The loop/);
    await page.hover('#c-a .fn[data-n="1"]');
    assert.equal(await page.locator('#c-a .fe.hot').count(), 2, 'y has two arrows');
    await page.hover('#c-a .fn[data-n="0"]');
    assert.equal(await page.locator('#c-a .fe.hot').count(), 1);
  } finally {
    await browser.close();
  }
});

test('files: an image opens full size in the page, an excerpt opens in place, a zoomed-out desk zooms first', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  fs.mkdirSync(path.join(cwd, 'shots'));
  fs.writeFileSync(path.join(cwd, 'shots', 'wide.png'), png(1200, 2400));
  fs.writeFileSync(path.join(cwd, 'notes.txt'), Array.from({ length: 30 }, (_, k) => `note ${k + 1}`).join('\n') + '\n');
  fs.writeFileSync(ref.file, '#+title: F\n\n** A card shows a screenshot\n:PROPERTIES:\n:CUSTOM_ID: a\n:END:\nGist.\n\n#+caption: The wide shot\n[[file:../../shots/wide.png]]\n\n#+include: "../../notes.txt" :lines "2-30"\n');
  assert.deepEqual(buildBoard(ref, { cwd }).errors, []);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href);
    await toRack(page);
    const img = page.locator('#c-a .fig-zoom img');
    assert.deepEqual([await img.getAttribute('width'), await img.getAttribute('height')], ['1200', '2400'], 'the size is known before the image decodes');
    assert.match(await page.textContent('#c-a figcaption'), /Fig\. 1\.1\s+The wide shot\s+wide\.png · 1200 × 2400/);
    assert.ok(await page.evaluate(() => document.querySelector('#c-a').classList.contains('wide')), 'a wide image widens its card');
    await page.keyboard.press('3');
    await page.click('#c-a .fig-zoom');
    const dlg = page.locator('dialog.lightbox[open]');
    await dlg.waitFor();
    const fit = await dlg.locator('img').boundingBox();
    assert.ok(fit.height < 800 && fit.width < 1200, 'a tall image opens fitted to the window');
    await dlg.locator('img').click();
    assert.ok(await dlg.evaluate((d) => d.classList.contains('actual')));
    assert.equal(Math.round((await dlg.locator('img').boundingBox()).width), 1200, 'a second click shows the real pixels');
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog.lightbox', { state: 'detached' });
    assert.ok(await page.evaluate(() => document.activeElement.matches('#c-a .fig-zoom')), 'focus goes back to the image');
    await page.keyboard.press('Enter');
    await page.locator('dialog.lightbox[open]').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog.lightbox', { state: 'detached' });
    // The excerpt: lines 2 to 29; 12 show, the rest open in place.
    assert.match(await page.textContent('#c-a .excerpt figcaption'), /notes\.txt\s+lines 2–29/);
    assert.equal(await page.locator('#c-a .excerpt > pre .ln').count(), 12);
    await page.click('#c-a .excerpt-more summary');
    assert.equal(await page.locator('#c-a .excerpt .ln').count(), 28);
    // The desk at a small zoom: a click on the image zooms to the card, as anywhere on a card.
    const settle = (v) => page.waitForFunction((want) => {
      const p = document.querySelector('.plane');
      return Math.abs(100 * p.getBoundingClientRect().width / p.offsetWidth - want) < 0.05;
    }, v);
    await page.keyboard.press('d');
    await page.waitForSelector('.board.view-desk');
    await page.keyboard.press('3');
    await page.click('[data-zoom="0.5"]');
    await settle(50);
    await page.click('#c-a .fig-zoom');
    await settle(100);
    assert.equal(await page.locator('dialog.lightbox').count(), 0, 'the first click reads the card, it does not open the image');
    await page.click('#c-a .fig-zoom');
    await page.locator('dialog.lightbox[open]').waitFor();
  } finally {
    await browser.close();
  }
});

test('phone: opens on the rack; the desk keeps the page as wide as the screen, and Send on screen', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  fs.writeFileSync(ref.file, DESK);
  buildBoard(ref, { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href);
    assert.ok((await page.getAttribute('.board', 'class')).includes('view-rack'), 'a phone opens on the rack');
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
    await toRack(page);
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

test('desk canvas: zoom presets, zoom to a card and back, drag to place, Arrange, the chat box', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  fs.writeFileSync(ref.file, DESK);
  buildBoard(ref, { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href + '?level=claim');
    const scale = () => page.evaluate(() => { const p = document.querySelector('.plane'); return Math.round(100 * p.getBoundingClientRect().width / p.offsetWidth); });
    const pressed = () => page.$$eval('[data-zoom][aria-pressed="true"]', (b) => b.map((x) => x.dataset.zoom));
    // Zoom animates; wait for the scale itself, not for a fixed time.
    const settle = (v) => page.waitForFunction((want) => {
      const p = document.querySelector('.plane');
      // Exact, not rounded: the animation is over only when the scale is the target.
      return Math.abs(100 * p.getBoundingClientRect().width / p.offsetWidth - want) < 0.05;
    }, v);

    // Fit is the default; z cycles Fit -> 50% -> 100% -> Fit.
    assert.deepEqual(await pressed(), ['fit']);
    await page.keyboard.press('z');
    await settle(50);
    assert.deepEqual(await pressed(), ['0.5']);
    assert.equal(await scale(), 50);

    // At 50%, focusing a card zooms to it; Esc goes back to 50%.
    await page.click('#c-c .claim');
    await settle(100);
    await page.keyboard.press('Escape');
    await settle(50);

    // Ctrl + wheel zooms to a scale between the presets.
    const box = await page.locator('.shelves').boundingBox();
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    const z = await scale();
    assert.ok(z > 50 && z < 100, `wheel zoom gave ${z}%`);
    assert.deepEqual(await pressed(), []);
    await page.click('[data-zoom="1"]');
    await settle(100);

    // Zooming in where the desk can scroll, the point under the pointer stays put.
    await page.setViewportSize({ width: 900, height: 620 });
    await page.waitForTimeout(200);
    const card = await page.locator('#c-c').boundingBox();
    const px = card.x + 40;
    const py = card.y + 30;
    await page.mouse.move(px, py);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    const k = (await scale()) / 100;
    const after = await page.locator('#c-c').boundingBox();
    assert.ok(k > 1.2, `zoomed in to ${k}`);
    assert.ok(Math.abs((px - after.x) - 40 * k) < 3 && Math.abs((py - after.y) - 30 * k) < 3, `anchor drift: ${px - after.x - 40 * k}, ${py - after.y - 30 * k}`);
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.click('[data-zoom="1"]');
    await settle(100);

    // Each link type has its own line class and end shape, and the key names them.
    assert.equal(await page.locator('.wires .wire.w-option').count(), 2);
    assert.equal(await page.locator('.wires .wire.w-needs').count(), 1);
    assert.deepEqual(await page.$$eval('.legend .lg', (l) => l.map((x) => x.textContent)), ['Source', 'Needs', 'Option', 'Mention']);

    // Drag card b by its top strip: the table becomes yours, the card snaps to the grid, and it stays after a reload.
    assert.equal(await page.isDisabled('[data-act="arrange"]'), true);
    const h = await page.locator('#c-b .addr').boundingBox();
    await page.mouse.move(h.x + 60, h.y + 6);
    await page.mouse.down();
    await page.mouse.move(h.x + 260, h.y + 130, { steps: 10 });
    await page.mouse.up();
    assert.ok((await page.getAttribute('.board', 'class')).includes('free'));
    const at = await page.$eval('#c-b', (el) => [parseFloat(el.style.left), parseFloat(el.style.top)]);
    assert.ok(at[0] % 24 === 0 && at[1] % 24 === 0, `snapped to the grid: ${at}`);
    await page.reload();
    await page.waitForSelector('.board.free');
    assert.deepEqual(await page.$eval('#c-b', (el) => [parseFloat(el.style.left), parseFloat(el.style.top)]), at);

    // Arrange puts every card back in its section; Undo brings your layout back.
    await page.click('[data-act="arrange"]');
    assert.ok(!(await page.getAttribute('.board', 'class')).includes('free'));
    await page.click('.toast button');
    assert.ok((await page.getAttribute('.board', 'class')).includes('free'));

    // The chat box sits in the bottom-right corner: c opens it, Esc closes it, the draft stays,
    // and a draft is not a card answer, so it does not count toward Send.
    await page.keyboard.press('c');
    await page.keyboard.type('One more thing.');
    assert.equal(await page.textContent('[data-act="send"]'), 'Send');
    const chat = await page.locator('.chat-panel').boundingBox();
    assert.ok(chat.x + chat.width > 1280 - 40, 'the chat is at the right');
    await page.keyboard.press('Escape');
    await page.keyboard.press('c');
    assert.equal(await page.inputValue('.chat textarea'), 'One more thing.');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('chat: a message goes now as its own round, Undo holds it back, and the agent answers with cards say', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  buildBoard(ref, { cwd });
  const { server, url } = await serve({ cwd, port: 0, log: () => {} });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}/b/queue`);
    const rounds = () => fold(readLog(ref.dir)).sends;

    // Esc in the first seconds takes the message back into the box; nothing is sent.
    await page.keyboard.press('c');
    await page.keyboard.type('First thought');
    await page.keyboard.press('Enter');
    assert.match(await page.textContent('.chat-thread'), /Sending/);
    await page.keyboard.press('Escape');
    assert.equal(await page.inputValue('.chat textarea'), 'First thought');
    await page.waitForTimeout(5500);
    assert.equal(rounds().length, 0);

    // Enter sends it: a round with one note, apart from any card answer.
    await page.fill('.chat textarea', 'Also compare managed Kafka.');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Round 1/.test(document.querySelector('.chat-thread').textContent), null, { timeout: 10000 });
    assert.deepEqual(rounds()[0].items, [{ kind: 'note', text: 'Also compare managed Kafka.' }]);

    // The agent's message appears live; while the box is closed, a dot says something new waits.
    addSay(ref.dir, 'Got it: a managed Kafka card is next.');
    await page.waitForSelector('.chat .msg.agent');
    assert.match(await page.textContent('.chat .msg.agent'), /managed Kafka card is next/);
    await page.keyboard.press('Escape');
    addSay(ref.dir, 'Done: card 7.');
    await page.waitForSelector('.chat-pill .dot');
    await page.keyboard.press('c');
    assert.equal(await page.locator('.chat .msg.agent').count(), 2);
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('.chat-pill .dot'), false, 'opening the box marks the messages seen');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test('chat in file mode: Send copies just the message', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  buildBoard(ref, { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href);
    await page.keyboard.press('c');
    await page.keyboard.type('Can SQS replay at all?');
    await page.click('[data-act="chat-send"]');
    assert.equal(await page.textContent('dialog h2'), 'Copy your message');
    const text = await page.inputValue('dialog textarea');
    assert.match(text, /note\s+"Can SQS replay at all\?"/);
    assert.doesNotMatch(text, /pick-queue/, 'only the message, not the card answers');
  } finally {
    await browser.close();
  }
});

// ---------- the loop around the board ----------

const WATCH = `#+title: Pick the band
#+author: Claude
#+todo: TODO DOING BLOCKED | DONE

* Decisions

** Which band goes with the watch?
:PROPERTIES:
:CUSTOM_ID: pick-band
:ASK: choose
:END:
The sport band is the lighter one.

- [X] sport :: Sport band, 140 to 190 mm
- [ ] link :: Magnetic link, 140 to 180 mm

** Which size fits your wrist?
:PROPERTIES:
:CUSTOM_ID: pick-size
:ASK: choose
:SUGGEST: none
:NEEDS: pick-band
:END:
Only you can measure your wrist.

- [ ] s-m :: S/M
- [ ] m-l :: M/L

** Put the watch in the bag
:PROPERTIES:
:CUSTOM_ID: bag
:ASK: approve
:NEEDS: pick-size
:END:
The order is not placed before you approve.

** Pass the identity check at checkout
:PROPERTIES:
:CUSTOM_ID: verify
:ASK: do
:END:
The store asks for a code that only your phone receives.
`;

function watch() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-e2e-'));
  const ref = resolveBoard('watch', cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  fs.writeFileSync(ref.file, WATCH);
  return { cwd, ref };
}

test('asks that depend on asks: one waits, is held when the first answer changes, and the reply says which', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = watch();
  buildBoard(ref, { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href + '?view=rack');
    await page.waitForSelector('.board.view-rack.alt-gist');
    const tab = (id) => page.textContent(`#c-${id} .tab`);
    const off = (id) => page.$$eval(`#c-${id} .ask :is(input, button.btn)`, (els) => els.every((e) => e.disabled));
    const reply = async () => {
      await page.keyboard.press('Control+Enter');
      const text = await page.inputValue('dialog textarea');
      await page.click('dialog [data-close]');
      return text;
    };

    // At the start two asks can be answered; the other two wait, shown and off.
    assert.match(await page.textContent('.lamp'), /2 waiting on you/);
    assert.equal(await tab('pick-size'), 'Waits for #1');
    assert.ok(await off('pick-size'));
    assert.match(await page.textContent('#c-pick-size .gate-note'), /Answer 1 first\. This one depends on it\./);
    assert.match(await page.textContent('#c-pick-size .ask-note'), /Only you know/);
    assert.equal(await tab('bag'), 'Waits for #2');
    assert.equal(await page.getAttribute('.rail-tab[data-goto="bag"]', 'data-held'), '');

    // The suggested band opens the size; the size opens the bag.
    await page.click('#c-pick-band .opt:has(input[value="sport"])');
    assert.equal(await tab('pick-size'), 'Choose');
    assert.ok(!(await off('pick-size')));
    await page.click('#c-pick-size .opt:has(input[value="s-m"])');
    assert.ok(!(await off('bag')));
    await page.click('#c-bag [data-approve="approve"]');
    await page.click('#c-verify [data-done="done"]');
    assert.equal(await tab('verify'), 'Done');
    let text = await reply();
    assert.match(text, /#1 pick-band\s+choose\s+confirmed: sport/);
    assert.match(text, /#2 pick-size\s+choose\s+chosen: s-m/);
    assert.match(text, /#3 bag\s+approve\s+approved/);
    assert.match(text, /#4 verify\s+do\s+done/);

    // The band changes: the size was written for the suggestion, so it is held, and the bag with it.
    await page.click('#c-pick-band .opt:has(input[value="link"])');
    assert.equal(await tab('pick-size'), 'On hold');
    assert.ok(await off('pick-size'));
    assert.match(await page.textContent('#c-pick-size .gate-note'), /written for the suggestion in 1, and you answered 1 another way\. The agent will ask this again\./);
    assert.equal(await tab('bag'), 'Waits for #2');
    text = await reply();
    assert.match(text, /#1 pick-band\s+choose\s+changed: link {2}\(you suggested sport\)/);
    assert.match(text, /#2 pick-size\s+choose\s+held: #1 changed from your suggestion/);
    assert.match(text, /#3 bag\s+approve\s+held: waits for #2/);
    assert.doesNotMatch(text, /chosen: s-m|approved/, 'a held answer does not go out as an answer');

    // The human may answer anyway; the reply then says what changed under the answer.
    await page.click('#c-pick-size [data-act="anyway"]');
    assert.ok(!(await off('pick-size')));
    assert.equal(await tab('pick-size'), 'Chosen');
    assert.equal(await tab('bag'), 'Approved');
    text = await reply();
    assert.match(text, /#2 pick-size\s+choose\s+chosen: s-m {2}\[answered after #1 changed\]/);
    assert.match(text, /#3 bag\s+approve\s+approved/);
    await page.click('#c-pick-size [data-act="hold"]');
    assert.ok(await off('pick-size'));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('a pasted reply, recorded with cards ingest, shows on the page as answered and clears the copied drafts', { skip: !chromium && 'playwright not installed' }, async () => {
  const { execFileSync } = await import('node:child_process');
  const cli = (args, input) => execFileSync('node', [path.join(SKILL, 'bin', 'cards.mjs'), ...args], { cwd, input, encoding: 'utf8' });
  const { cwd, ref } = watch();
  buildBoard(ref, { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const url = pathToFileURL(path.join(ref.dir, 'board.html')).href + '?view=rack';
    await page.goto(url);
    assert.equal(await page.title(), '(2) Pick the band', 'the browser tab counts the asks that wait');
    const signal = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--signal').trim());
    assert.ok(decodeURIComponent(await page.getAttribute('link[rel="icon"]', 'href')).includes(`<path fill="${signal}"`), 'and the icon lights its tab in the signal color');
    assert.ok(await page.$('.mark.lit'));
    assert.match(await page.getAttribute('.mark', 'title'), /^Made with cards \d+\.\d+\.\d+$/);
    assert.match(await page.textContent('.andon .stat'), /by Claude/);

    await page.click('#c-pick-band .opt:has(input[value="link"])');
    await page.click('#c-verify [data-done="cannot"]');
    await page.keyboard.press('Control+Enter');
    const text = await page.inputValue('dialog textarea');
    assert.match(text, /This reply is not on disk yet\. Record it first: cards ingest watch/);
    await page.click('dialog [data-copy]');
    await page.waitForSelector('dialog', { state: 'detached' });
    assert.match(await page.textContent('.lamp'), /reply copied/);
    assert.equal(await page.title(), 'Pick the band', 'nothing waits: the two asks left are held');

    // The agent records the paste; no card is edited. A reload shows the round.
    assert.match(cli(['ingest'], text), /recorded round 1 of watch: 4 responses, 2 asks answered, 2 held/);
    cli(['render', 'watch', '--quiet']);
    await page.goto(url);
    assert.equal(await page.textContent('#c-pick-band .tab'), 'Chosen');
    assert.equal(await page.textContent('#c-verify .tab'), 'Cannot');
    assert.match(await page.textContent('#c-pick-band .thread'), /Chose Magnetic link, 140 to 180 mm/, 'the thread shows the words of the option, not its key');
    assert.match(await page.textContent('.lamp'), /round 1 read/);
    assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith(':drafts')))).cards).length), 0, 'the copied drafts are on disk now, so the page drops them');

    // DONE closes an ask; the card keeps what was asked and what you said.
    cli(['settle', 'watch']);
    cli(['render', 'watch', '--quiet']);
    await page.goto(url);
    assert.equal(await page.getAttribute('#c-pick-band', 'data-status'), 'done');
    assert.equal(await page.$('#c-pick-band .tab'), null);
    assert.match(await page.textContent('#c-pick-band .thread'), /Chose Magnetic link/);
  } finally {
    await browser.close();
  }
});

test('first view: the most detail that fits and reads; pictures at every level; Fit never unreadable', { skip: !chromium && 'playwright not installed' }, async () => {
  const scaleOf = (page) => page.evaluate(() => { const m = getComputedStyle(document.querySelector('.plane')).transform; return m === 'none' ? 1 : Number(m.match(/matrix\(([\d.]+)/)[1]); });
  const browser = await chromium.launch();
  try {
    // A small board opens with its gists.
    const small = watch();
    buildBoard(small.ref, { cwd: small.cwd });
    // (A tall window: this board of four asks is close to the two-window limit at 900.)
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(pathToFileURL(path.join(small.ref.dir, 'board.html')).href);
    await page.waitForSelector('.board.view-desk.alt-gist');
    assert.ok(await scaleOf(page) >= 0.5);
    // Fit leaves empty table around the cards.
    const wide = setup();
    buildBoard(wide.ref, { cwd: wide.cwd });
    await page.goto(pathToFileURL(path.join(wide.ref.dir, 'board.html')).href + '?level=claim');
    await page.waitForSelector('.board.view-desk.alt-claim');
    const fill = await page.evaluate(() => { const p = document.querySelector('.plane').getBoundingClientRect(); const b = document.querySelector('.shelves').getBoundingClientRect(); return Math.max(p.width / b.width, p.height / b.height); });
    assert.ok(fill <= 0.86, `the cards take ${Math.round(fill * 100)}% of the table`);

    // A board of long cards with pictures: Gist would be a map nobody reads, so it opens at Claim.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-e2e-'));
    const ref = resolveBoard('bands', cwd);
    fs.mkdirSync(ref.dir, { recursive: true });
    fs.writeFileSync(path.join(cwd, 'band.png'), png(600, 400));
    const para = 'This band is light and it dries fast. '.repeat(6);
    const card = (s, k) => `** Band ${s}${k} holds the watch on a wet wrist\n:PROPERTIES:\n:CUSTOM_ID: b${s}${k}\n:END:\n${para}\n\n#+caption: Band ${s}${k}\n[[file:../../band.png]]\n`;
    fs.writeFileSync(ref.file, `#+title: Bands\n\n${[1, 2, 3].map((s) => `* Group ${s}  :compare:\n\n${[1, 2, 3, 4, 5, 6].map((k) => card(s, k)).join('\n')}`).join('\n')}`);
    const r = buildBoard(ref, { cwd });
    assert.deepEqual(r.errors, []);
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href);
    await page.waitForSelector('.board.view-desk.alt-claim');
    const thumb = await page.locator('#c-b11 .fig img').boundingBox();
    assert.ok(thumb && thumb.height > 20, 'a picture shows on the Claim tile');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#c-b11 .gist')).display), 'none');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#c-b11 figcaption')).display), 'none');

    // At Gist, Fit takes the width and the table scrolls down; it does not shrink to a map.
    await page.keyboard.press('2');
    await page.waitForTimeout(400);
    assert.ok(await scaleOf(page) >= 0.5, `Fit at Gist is ${await scaleOf(page)}`);
    const scroll = await page.evaluate(() => { const b = document.querySelector('.shelves'); return [b.scrollWidth <= b.clientWidth + 1, b.scrollHeight > b.clientHeight]; });
    assert.deepEqual(scroll, [true, true], 'the width fits; the height scrolls');

    // On the rack, six options sit 3 + 3, not 4 + 2.
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href + '?view=rack&level=gist');
    await page.waitForSelector('.board.view-rack.alt-gist');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.slots[data-layout="compare"]')).gridTemplateColumns.split(' ').length), 3);
  } finally {
    await browser.close();
  }
});

test('translations and published copies: a language link in the same tab; a copy says where the reply goes', { skip: !chromium && 'playwright not installed' }, async () => {
  const { execFileSync } = await import('node:child_process');
  const { cwd, ref } = watch();
  const zh = resolveBoard('watch-zh', cwd);
  fs.mkdirSync(zh.dir, { recursive: true });
  fs.writeFileSync(zh.file, `#+title: 选表带\n#+language: zh-Hans\n#+translation_of: watch\n\n* 决定\n\n** 通过结账时的身份验证\n:PROPERTIES:\n:CUSTOM_ID: verify\n:ASK: do\n:END:\n商店会发一个只有你的手机能收到的验证码。\n`);
  buildBoard(ref, { cwd });
  buildBoard(zh, { cwd });
  const out = path.join(cwd, 'site');
  for (const id of ['watch', 'watch-zh']) execFileSync('node', [path.join(SKILL, 'bin', 'cards.mjs'), 'export', id, '--out', path.join(out, id)], { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href + '?view=rack');
    assert.equal(await page.textContent('.langs b'), 'English');
    assert.equal(await page.getAttribute('.langs a', 'target'), null);
    await page.click('.langs a');
    await page.waitForSelector('#c-verify');
    assert.match(page.url(), /watch-zh\/board\.html\?view=rack$/, 'the other language opens the way this page was opened');
    assert.equal(await page.getAttribute('html', 'lang'), 'zh-Hans');
    assert.equal(await page.textContent('#c-verify [data-done="done"]'), '办好了');

    // The published copy: no path, no past rounds, and Send explains itself to a reader who has no agent.
    await page.goto(pathToFileURL(path.join(out, 'watch', 'index.html')).href + '?view=rack');
    assert.equal(await page.textContent('.andon .path'), '');
    assert.match(await page.getAttribute('.langs a', 'href'), /^\.\.\/watch-zh\/index\.html\?view=rack$/);
    await page.click('#c-verify [data-done="done"]');
    await page.keyboard.press('Control+Enter');
    assert.match(await page.textContent('dialog p'), /published copy of the board; nothing is sent from this page\. Copy your reply and send it to the board’s author\./);
    assert.doesNotMatch(await page.inputValue('dialog textarea'), /cards ingest/);
  } finally {
    await browser.close();
  }
});

test('asks written for one answer, or for any answer: a branch opens, the other says it is not needed', { skip: !chromium && 'playwright not installed' }, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-e2e-'));
  const ref = resolveBoard('branch', cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  const size = (id, band, a, b) => `** Which size, for the ${band} band?\n:PROPERTIES:\n:CUSTOM_ID: ${id}\n:ASK: choose\n:SUGGEST: none\n:NEEDS: pick-band=${band}\n:END:\nMeasure your wrist.\n\n- [ ] ${a}\n- [ ] ${b}\n`;
  fs.writeFileSync(ref.file, `#+title: Branch\n\n** Which band?\n:PROPERTIES:\n:CUSTOM_ID: pick-band\n:ASK: choose\n:END:\nThe sport band is lighter.\n\n- [X] sport :: Sport band\n- [ ] link :: Magnetic link\n\n${size('size-sport', 'sport', 's-m :: S/M, 140 to 180 mm', 'm-l :: M/L, 160 to 210 mm')}\n${size('size-link', 'link', 's :: S, 140 to 160 mm', 'l :: L, 160 to 180 mm')}\n** Put it in the bag\n:PROPERTIES:\n:CUSTOM_ID: bag\n:ASK: approve\n:NEEDS: pick-band=*\n:END:\nNothing is ordered before you approve.\n`);
  const r = buildBoard(ref, { cwd });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.data.cards['size-link'].when, { 'pick-band': 'link' });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href + '?view=rack');
    const tab = (id) => page.textContent(`#c-${id} .tab`);
    const off = (id) => page.$$eval(`#c-${id} .ask :is(input, button.btn)`, (els) => els.every((e) => e.disabled));
    assert.deepEqual([await tab('size-sport'), await tab('size-link'), await tab('bag')], ['Waits for #1', 'Waits for #1', 'Waits for #1']);
    assert.match(await page.textContent('.lamp'), /1 waiting on you/);

    // Not the suggested band: the ask written for it opens, the other is not needed, and "any answer" opens too.
    await page.click('#c-pick-band .opt:has(input[value="link"])');
    assert.deepEqual([await tab('size-sport'), await tab('size-link'), await tab('bag')], ['Not needed', 'Choose', 'Approve']);
    assert.ok(await off('size-sport'));
    assert.ok(!(await off('size-link')));
    assert.match(await page.textContent('#c-size-sport .gate-note'), /Not needed: this applies only when 1 is answered “Sport band”\./);
    assert.equal(await page.$('#c-size-sport [data-act="anyway"]'), null, 'there is nothing to answer anyway');
    assert.match(await page.textContent('.lamp'), /2 waiting on you/);
    await page.click('#c-size-link .opt:has(input[value="l"])');
    await page.click('#c-bag [data-approve="approve"]');
    await page.keyboard.press('Control+Enter');
    const text = await page.inputValue('dialog textarea');
    assert.match(text, /#1 pick-band\s+choose\s+changed: link/);
    assert.match(text, /#2 size-sport\s+choose\s+held: not needed; it applies to another answer of #1/);
    assert.match(text, /#3 size-link\s+choose\s+chosen: l\n/);
    assert.match(text, /#4 bag\s+approve\s+approved\n/);
    assert.doesNotMatch(text, /answered after/, 'neither answer rests on a changed suggestion');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('review fixes: a text answer opens what waits for it; an answer held in a later round no longer stands', { skip: !chromium && 'playwright not installed' }, async () => {
  const { execFileSync } = await import('node:child_process');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-e2e-'));
  const cli = (args, input) => execFileSync('node', [path.join(SKILL, 'bin', 'cards.mjs'), ...args], { cwd, input, encoding: 'utf8' });
  const ref = resolveBoard('rounds', cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  fs.writeFileSync(ref.file, `#+title: Rounds\n\n** What is the budget?\n:PROPERTIES:\n:CUSTOM_ID: budget\n:ASK: answer\n:END:\nOnly you know it.\n\n** Buy the plan that fits the budget\n:PROPERTIES:\n:CUSTOM_ID: buy\n:ASK: approve\n:NEEDS: budget\n:END:\nI buy nothing before you approve.\n\n** Which band?\n:PROPERTIES:\n:CUSTOM_ID: band\n:ASK: choose\n:END:\nThe sport band is lighter.\n\n- [X] sport :: Sport\n- [ ] link :: Link\n\n** Which size?\n:PROPERTIES:\n:CUSTOM_ID: size\n:ASK: choose\n:SUGGEST: none\n:NEEDS: band\n:END:\nMeasure your wrist.\n\n- [ ] s :: Small\n- [ ] l :: Large\n`);
  buildBoard(ref, { cwd });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const url = pathToFileURL(path.join(ref.dir, 'board.html')).href + '?view=rack';
    await page.goto(url);
    const off = (id) => page.$$eval(`#c-${id} .ask :is(input, button.btn)`, (els) => els.every((e) => e.disabled));
    const copy = async () => {
      await page.keyboard.press('Control+Enter');
      const text = await page.inputValue('dialog textarea');
      await page.click('dialog [data-copy]');
      await page.waitForSelector('dialog', { state: 'detached' });
      return text;
    };

    // The first character typed into a text ask opens the ask that waits for it; the box keeps the caret.
    assert.ok(await off('buy'));
    await page.click('#c-budget textarea');
    await page.keyboard.type('4');
    assert.ok(!(await off('buy')), 'the approval opens while you type');
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA');
    await page.keyboard.type('00 a month');
    assert.equal(await page.inputValue('#c-budget textarea'), '400 a month');
    await page.keyboard.press('Escape');

    // Round 1: the suggested band, and a size.
    await page.click('#c-band .opt:has(input[value="sport"])');
    await page.click('#c-size .opt:has(input[value="s"])');
    cli(['ingest'], await copy());
    cli(['render', 'rounds', '--quiet']);
    await page.goto(url);
    assert.equal(await page.textContent('#c-size .tab'), 'Chosen');

    // Round 2: the band changes. The size was answered for the other band: it comes back held.
    await page.click('#c-band .opt:has(input[value="link"])');
    assert.equal(await page.textContent('#c-size .tab'), 'On hold');
    const second = await copy();
    assert.match(second, /#3 band\s+choose\s+changed: link/);
    assert.match(second, /#4 size\s+choose\s+held: #3 changed from your suggestion/);
    cli(['ingest'], second);
    cli(['render', 'rounds', '--quiet']);
    assert.match(cli(['show', 'rounds']), /2 waiting on you/, 'the size and the approval still wait');
    assert.match(cli(['settle', 'rounds']), /DONE: budget, band\./, 'settle closes what stands, and not the held size');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('a sample in a frame: one row of tools, no chat box, nothing kept between visits; the keyboard stays on the control you used', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = watch();
  buildBoard(ref, { cwd });
  const url = pathToFileURL(path.join(ref.dir, 'board.html')).href;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url + '?embed&fresh&view=rack');
    await page.waitForSelector('.card');
    assert.equal(await page.$('.chat'), null, 'no chat box in a frame');
    const shown = await page.$$eval('.bar :is(.seg-filter, [data-sort], .search, [data-act="help"], .seg-alt, [data-act="send"])', (els) => els.map((e) => [e.className || e.dataset.act || 'sort', getComputedStyle(e).display !== 'none']));
    assert.deepEqual(shown.filter((x) => x[1]).map((x) => x[0]).sort(), ['seg seg-alt', 'send']);
    assert.ok((await page.locator('.bar').boundingBox()).height < 60, 'the tools are one row');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY), 'auto', 'the wheel goes on to the page around the board');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.rail')).position), 'sticky', 'the ask tabs stay in sight');

    // The filter, the order, the search and the help have no control in a frame, and no key either:
    // two presses of f once left no card on the page and no way back.
    const cardsShown = () => page.$$eval('.card', (els) => els.filter((e) => e.getClientRects().length).length);
    const before = await cardsShown();
    await page.focus('body');
    for (const key of ['f', 'f', 's', '/', '?']) await page.keyboard.press(key);
    assert.equal(await cardsShown(), before, 'every card is still there');
    assert.equal(await page.$('dialog[open]'), null, 'no help opened');

    // Choosing with the keyboard: the card is drawn again, and the focus is on the same option.
    await page.focus('#c-pick-band input[value="link"]');
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => document.activeElement.value), 'link');
    assert.equal(await page.evaluate(() => document.activeElement.closest('.card').id), 'c-pick-band');
    await page.focus('#c-verify [data-done="done"]');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.done), 'done');
    assert.equal(await page.getAttribute('#c-verify [data-done="done"]', 'aria-pressed'), 'true');
    assert.match(await page.textContent('.lamp'), /Ready to send/);
    // A sample says what it is when you send.
    await page.keyboard.press('Control+Enter');
    assert.match(await page.textContent('dialog p'), /This is a sample: nothing is sent, and nothing is kept\. This is the reply an agent would read\./);
    await page.click('dialog [data-close]');

    // ?fresh: a reload starts with the board as the agent wrote it.
    await page.reload();
    await page.waitForSelector('.card');
    assert.match(await page.textContent('.lamp'), /2 waiting on you/);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0, 'nothing is kept in this browser');
    // Without it, the same answers would still be there.
    await page.goto(url + '?view=rack');
    await page.click('#c-pick-band .opt:has(input[value="link"])');
    await page.waitForFunction(() => document.querySelector('#c-pick-band .tab').textContent === 'Chosen');
    await page.reload();
    await page.waitForSelector('.card');
    assert.equal(await page.textContent('#c-pick-band .tab'), 'Chosen');
    assert.ok(await page.$('.chat'), 'and the chat box is back');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('touch: on a phone-size touch screen, taps answer an ask, open a picture at full size, and send', { skip: (!chromium && 'playwright not installed') || (ENGINE === 'firefox' && 'Firefox has no touch emulation') }, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-e2e-'));
  const ref = resolveBoard('touch', cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  fs.writeFileSync(path.join(cwd, 'band.png'), png(1200, 2400));
  fs.writeFileSync(ref.file, '#+title: Touch\n\n** The sport band is the lighter one\n:PROPERTIES:\n:CUSTOM_ID: band\n:END:\nIt weighs 12 g less.\n\n#+caption: The sport band\n[[file:../../band.png]]\n\n** Which band?\n:PROPERTIES:\n:CUSTOM_ID: pick\n:ASK: choose\n:END:\nPick one.\n\n- [X] sport :: Sport\n- [ ] link :: Link\n');
  assert.deepEqual(buildBoard(ref, { cwd }).errors, []);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href);
    await page.waitForSelector('.board.view-rack', undefined);
    // An option is a target a finger can hit.
    const opt = await page.locator('#c-pick .opt:has(input[value="link"])').boundingBox();
    assert.ok(opt.height >= 32, `an option is ${opt.height}px tall`);
    await page.tap('#c-pick .opt:has(input[value="link"])');
    await page.waitForFunction(() => document.querySelector('#c-pick .tab').textContent === 'Chosen');
    // A tap on the picture opens it in the page; a tap on it shows its real pixels; Close goes back.
    await page.tap('#c-band .fig-zoom');
    await page.waitForSelector('dialog.lightbox[open]');
    const fit = await page.locator('dialog.lightbox img').boundingBox();
    assert.ok(fit.height <= 844 && fit.width <= 390, 'the picture fits the phone');
    await page.tap('dialog.lightbox img');
    assert.ok(await page.evaluate(() => document.querySelector('dialog.lightbox').classList.contains('actual')));
    await page.tap('dialog.lightbox [data-close]');
    await page.waitForSelector('dialog.lightbox', { state: 'detached' });
    // At Claim a card is one row, and under a finger the claim still has the row's width.
    await page.goto(pathToFileURL(path.join(ref.dir, 'board.html')).href + '?level=claim');
    await page.waitForSelector('.board.view-rack.alt-claim');
    const row = await page.evaluate(() => { const c = document.querySelector('#c-band'); return [c.querySelector('.claim').offsetWidth, c.offsetHeight, document.documentElement.scrollWidth <= innerWidth]; });
    assert.ok(row[0] > 150 && row[1] < 120 && row[2], `a claim row: claim ${row[0]}px wide, row ${row[1]}px tall, no sideways scroll ${row[2]}`);
    // A tap on the row opens it; the answer from before is still there, and another tap changes it.
    await page.tap('#c-pick .claim');
    await page.waitForSelector('#c-pick.open');
    assert.ok(await page.isChecked('#c-pick input[value="link"]'));
    await page.tap('#c-pick .opt:has(input[value="sport"])');
    await page.waitForFunction(() => document.querySelector('#c-pick input[value="sport"]').checked);
    await page.tap('#c-pick .opt:has(input[value="link"])');
    await page.waitForFunction(() => document.querySelector('#c-pick input[value="link"]').checked);
    // Send is on screen and takes a tap.
    const send = await page.locator('[data-act="send"]').boundingBox();
    assert.ok(send.y + send.height <= 844, 'Send is on screen');
    await page.tap('[data-act="send"]');
    assert.match(await page.inputValue('dialog textarea'), /#2 pick\s+choose\s+changed: link/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
