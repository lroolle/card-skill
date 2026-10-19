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
      // The card stands in the middle of the window, clear of the toolbar (the template's chart pushes it down).
      await page.evaluate(() => document.querySelector('#c-nats').scrollIntoView({ block: 'center' }));
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

// ---- tables in narrow cards, and the width of a card on the desk ----

const TABLES = `#+title: Names for the tool
#+todo: TODO DOING BLOCKED | DONE

* Names

** Three names are free, and each has one weak point
:PROPERTIES:
:CUSTOM_ID: names
:BASIS: fact
:END:
Each name was checked on the registry.

- files of the skill changed after the tag :: 17, in 8 commits
- what =cards ids= did :: nothing, as it should

| Name | Weak point | Top hit, stars |
|------+------------+----------------|
| faceup | "face" reads as a human face | Lindydancer/faceup, 33 |
| aboveboard | ten letters, a moral tone | a security token repo, 6 |
| deskcheck | sounds like a linter | a tool since September |

| Engine | Tests |
|--------+-------|
| Chromium | 1,204 |
| WebKit | 98 |

* Beside

** A second card stands beside the first
:PROPERTIES:
:CUSTOM_ID: second
:BASIS: fact
:FROM: names
:END:
It has no table.

- =skill/reference/templates/review.org= :: the template that a review starts from

** DONE A closed card keeps a wide table to itself
:PROPERTIES:
:CUSTOM_ID: closed
:BASIS: fact
:END:
Nobody sees this table until the card is opened.

| Name | Weak point of the name | Top hit on the registry, with its stars |
|------+------------------------+------------------------------------------|
| faceup | "face" reads as a human face | Lindydancer/faceup, 33 |

* Last

** The last column holds one card
:PROPERTIES:
:CUSTOM_ID: last
:BASIS: fact
:END:
It stands at the right end of the desk.
`;

test('tables and widths: words stay whole, rows stack where a table cannot fit, and a card on the desk takes the width you give it', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  fs.writeFileSync(ref.file, TABLES);
  buildBoard(ref, { cwd });
  const url = pathToFileURL(path.join(ref.dir, 'board.html')).href;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url + '?view=desk&level=full');
    await page.waitForSelector('#c-names table');
    const width = () => page.$eval('#c-names', (el) => el.offsetWidth);
    const stacked = () => page.$$eval('#c-names .table', (els) => els.map((e) => e.classList.contains('stacked')));
    // One line of text in a field means no word was broken to make its column narrow.
    const oneLine = (sel) => page.$$eval(sel, (els) => els.every((e) => e.getClientRects().length === 0 || e.offsetHeight < 2.2 * parseFloat(getComputedStyle(e).lineHeight)));

    // At Full the column of a section is as wide as its widest table wants.
    const own = await width();
    assert.ok(own > 400, `the card is wider than a plain column: ${own}`);
    assert.deepEqual(await stacked(), [false, false]);
    assert.ok(await oneLine('#c-names tbody td:first-child'), 'faceup, aboveboard and deskcheck stand on one line each');
    // A column of numbers is set to the right, as in Org.
    assert.equal(await page.$eval('#c-names .table:nth-of-type(2) tbody td:last-child', (e) => getComputedStyle(e).textAlign), 'right');
    // The key of a fact shows its markup as any text does.
    assert.equal(await page.$eval('#c-names dl.facts dt code', (e) => e.textContent), 'cards ids');
    // A fact's value keeps a readable width beside a long key.
    assert.ok(await page.$eval('#c-names dl.facts dd', (e) => e.offsetWidth) > 120);

    // The right edge of a card sets its width. Drag it left: the card gets narrow, on the grid.
    const drag = async (dx) => {
      const b = await page.locator('#c-names .widen').boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + 40);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + 44, { steps: 4 });
      await page.mouse.move(b.x + b.width / 2 + dx, b.y + 48, { steps: 4 });
      await page.mouse.up();
    };
    const scale = await page.evaluate(() => { const p = document.querySelector('.plane'); return p.getBoundingClientRect().width / p.offsetWidth; });
    await drag(-260 * scale);
    await page.waitForFunction((w) => document.querySelector('#c-names').offsetWidth < w - 200, own);
    const narrow = await width();
    assert.equal(narrow % 24, 0, `the width is on the grid: ${narrow}`);
    assert.ok(narrow >= 240 && narrow < own - 200);
    // The three-column table cannot fit now: each row is a block, the first field its name, the others under the names of their columns.
    await page.waitForFunction(() => document.querySelector('#c-names .table').classList.contains('stacked'));
    assert.deepEqual(await stacked(), [true, false], 'the table of two short columns still fits');
    assert.deepEqual(await page.$eval('#c-names .table.stacked td:nth-child(2)', (e) => [e.dataset.label, getComputedStyle(e, '::before').content !== 'none', getComputedStyle(e, '::before').display]), ['Weak point', true, 'block']);
    assert.ok(await oneLine('#c-names .table.stacked td:first-child'));
    assert.equal(await page.$eval('#c-names .table.stacked', (e) => e.scrollWidth <= e.clientWidth + 1), true, 'nothing sticks out of the card');
    // The lines to other cards follow the new edge, and the click that ends a drag does not open or focus anything else.
    assert.ok(await page.$$eval('.wires .wire', (w) => w.length) >= 1);

    // The width is yours: it is there after a reload.
    await page.reload();
    await page.waitForSelector('#c-names table');
    assert.equal(await width(), narrow);
    await page.waitForFunction(() => document.querySelector('#c-names .table').classList.contains('stacked'));

    // Keys on the card in focus: ] wider, [ narrower, two grid steps each.
    await page.click('#c-names .claim');
    await page.keyboard.press(']');
    await page.keyboard.press(']');
    assert.equal(await width(), narrow + 96);
    await page.keyboard.press('[');
    assert.equal(await width(), narrow + 48);
    // It stops at the least and the most a card may be.
    for (let k = 0; k < 30; k++) await page.keyboard.press('[');
    assert.equal(await width(), 240);

    // A double-click on the edge gives the card the width of its column again, and the table is a table again.
    await page.dblclick('#c-names .widen', { position: { x: 6, y: 40 } });
    await page.waitForFunction((w) => document.querySelector('#c-names').offsetWidth === w, own);
    await page.waitForFunction(() => !document.querySelector('#c-names .table').classList.contains('stacked'));

    // Arrange puts every card back, widths too.
    await drag(120 * scale);
    await page.waitForFunction((w) => document.querySelector('#c-names').offsetWidth > w + 90, own);
    await page.click('[data-act="arrange"]');
    await page.waitForFunction((w) => document.querySelector('#c-names').offsetWidth === w, own);

    // The reading view has no such edge. On a phone the wide table stacks too, and the short one stays.
    const phone = await browser.newPage({ viewport: { width: 390, height: 800 } });
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(url + '?view=rack&level=full');
    await phone.waitForSelector('#c-names table');
    assert.equal(await phone.$eval('#c-names .widen', (e) => getComputedStyle(e).display), 'none');
    await phone.waitForFunction(() => document.querySelector('#c-names .table').classList.contains('stacked'));
    assert.deepEqual(await phone.$$eval('#c-names .table', (els) => els.map((e) => e.classList.contains('stacked'))), [true, false]);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the page does not scroll sideways');
    await phone.close();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('resize, as a reviewer broke it: the edge follows the pointer at any zoom, a sized card lies on top, the handle is no card click, a tap after a touch drag counts', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  fs.writeFileSync(ref.file, TABLES);
  buildBoard(ref, { cwd });
  const url = pathToFileURL(path.join(ref.dir, 'board.html')).href;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Fit, on a window in which the desk is scaled down: the hard case for a drag.
    await page.goto(url + '?view=desk&level=gist');
    await page.waitForSelector('#c-last');
    const scale = () => page.evaluate(() => { const p = document.querySelector('.plane'); return p.getBoundingClientRect().width / p.offsetWidth; });
    const edge = (id) => page.$eval('#c-' + id, (el) => el.getBoundingClientRect().right);
    const grab = async (id, dx, check) => {
      const b = await page.locator(`#c-${id} .widen`).boundingBox();
      const x0 = b.x + b.width / 2;
      const off = x0 - await edge(id);
      await page.mouse.move(x0, b.y + 30);
      await page.mouse.down();
      await page.mouse.move(x0 + dx / 2, b.y + 32, { steps: 5 });
      await page.mouse.move(x0 + dx, b.y + 34, { steps: 5 });
      await page.waitForTimeout(80);
      const during = { edge: await edge(id), want: x0 + dx - off, scale: await scale() };
      if (check) await check();
      await page.mouse.up();
      return during;
    };
    const s0 = await scale();
    // The rightmost card: its growth makes the plane wider, which once shrank a fitted desk under the pointer.
    const d = await grab('last', 60); // 60px: the pointer stays inside the window
    assert.ok(Math.abs(d.edge - d.want) < 3, `the edge is under the pointer: ${d.edge} for ${d.want}`);
    assert.ok(Math.abs(d.scale - s0) < 0.002, `the desk keeps its scale while you drag: ${d.scale} for ${s0}`);
    // A card that is made wider than the gap to its neighbour lies on top of it, edge and all.
    const before = await page.$eval('#c-names', (el) => el.offsetWidth);
    await grab('names', 200 * (await scale()));
    await page.waitForFunction((w) => document.querySelector('#c-names').offsetWidth > w + 150, before);
    const top = await page.evaluate(() => { const r = document.querySelector('#c-names .widen').getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + 20).className; });
    assert.equal(top, 'widen', 'its edge is still in reach');

    // A click on the edge is not a click on the card: nothing gets the focus, nothing opens.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400); // the click that ends a drag is past
    await page.click('#c-second .widen', { position: { x: 6, y: 20 } });
    assert.equal(await page.$('.card.focused'), null);
    // Double-click on the edge of a card that is in focus and open: the width goes back, the card stays open.
    await page.click('#c-names .claim'); // a click on a card gives it the focus and opens it
    assert.equal(await page.$eval('#c-names', (el) => el.classList.contains('open')), true);
    await page.dblclick('#c-names .widen', { position: { x: 6, y: 20 } });
    await page.waitForFunction((w) => document.querySelector('#c-names').offsetWidth === w, before);
    assert.equal(await page.$eval('#c-names', (el) => el.classList.contains('open')), true);
    // 0 does the same from the keyboard; on places the layout made it does nothing, and Arrange stays off.
    await page.keyboard.press(']');
    await page.keyboard.press('0');
    assert.equal(await page.$eval('#c-names', (el) => el.offsetWidth), before);
    await page.click('[data-act="arrange"]');
    await page.waitForFunction(() => document.querySelector('[data-act="arrange"]').disabled);
    await page.dblclick('#c-second .widen', { position: { x: 6, y: 20 } });
    assert.equal(await page.$eval('[data-act="arrange"]', (b) => b.disabled), true, 'a double-click on a layout nobody touched changes nothing');

    // A fact whose key is one long word (a path in code) leaves its value three fifths of the row.
    const [kw, vw] = await page.$eval('#c-second dl.facts', (dl) => [dl.querySelector('dt').offsetWidth, dl.querySelector('dd').offsetWidth]);
    assert.ok(vw >= 1.4 * kw && vw > 120, `key ${kw}, value ${vw}`);
    // A DONE card is closed: its table asks for no room on the desk, and for no second column in the reading view.
    await page.goto(url + '?view=desk&level=full&fresh');
    await page.waitForSelector('#c-closed');
    assert.equal(await page.$eval('#c-closed', (el) => el.offsetWidth), 288);
    await page.goto(url + '?view=rack&level=full&fresh');
    await page.waitForSelector('#c-closed');
    assert.equal(await page.$eval('#c-closed', (el) => el.classList.contains('wide-t')), false);
    // The ledger of claims is one column, also when you open the card with the wide table.
    await page.goto(url + '?view=rack&level=claim&fresh');
    await page.waitForSelector('#c-names');
    await page.click('#c-names .claim');
    const lefts = await page.$$eval('.card', (els) => [...new Set(els.filter((e) => e.getClientRects().length && !e.classList.contains('open')).map((e) => Math.round(e.getBoundingClientRect().left)))]);
    assert.equal(lefts.length, 1, 'every row starts at the same left edge');
    assert.equal(await page.$eval('#c-second', (el) => getComputedStyle(el).boxShadow), 'none', 'a row of the ledger is no card: no shadow');
    assert.deepEqual(errors, []);

    // Touch (not in Firefox, where Playwright has no touch screen): after a drag of the edge, the next tap counts.
    if (ENGINE !== 'firefox') {
      const touch = await browser.newContext({ viewport: { width: 1000, height: 700 }, hasTouch: true });
      const tp = await touch.newPage();
      await tp.goto(url + '?view=desk&level=gist&fresh');
      await tp.waitForSelector('#c-last');
      const b = await tp.locator('#c-last .widen').boundingBox();
      const w0 = await tp.$eval('#c-last', (el) => el.offsetWidth);
      await tp.evaluate(([x, y]) => {
        const h = document.querySelector('#c-last .widen');
        const ev = (type, dx) => h.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: x + dx, clientY: y }));
        ev('pointerdown', 0);
        for (const dx of [10, 40, 80]) window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: x + dx, clientY: y }));
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x + 80, clientY: y }));
      }, [b.x + b.width / 2, b.y + 30]);
      await tp.waitForFunction((w) => document.querySelector('#c-last').offsetWidth > w + 40, w0);
      await tp.waitForTimeout(450); // a touch drag is followed by no click; the mark for one runs out
      await tp.tap('#c-second .claim');
      assert.equal(await tp.$eval('#c-second', (el) => el.classList.contains('focused')), true, 'the first tap after the drag is not eaten');
      await touch.close();
    }
  } finally { await browser.close(); }
});

test('full screen: Shift + F and the button give the board the screen; the header folds to one line; Esc and the browser bring it back', { skip: !chromium && 'playwright not installed' }, async () => {
  const { cwd, ref } = setup();
  buildBoard(ref, { cwd });
  const url = pathToFileURL(path.join(ref.dir, 'board.html')).href;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector('.board.view-desk');
    const measure = () => page.evaluate(() => ({
      header: document.querySelector('.board > header').getBoundingClientRect().height,
      table: document.querySelector('.shelves').getBoundingClientRect().height,
      win: window.innerHeight,
      lede: !!document.querySelector('.lede') && getComputedStyle(document.querySelector('.lede')).display !== 'none',
      api: !!document.fullscreenElement,
      enabled: !!document.fullscreenEnabled,
    }));
    const before = await measure();
    await page.keyboard.press('Shift+F');
    await page.waitForSelector('.board.screen');
    await page.waitForTimeout(200);
    const on = await measure();
    assert.ok(on.header < 60, `the header is one line: ${on.header}px`);
    // (A browser's own full screen may be smaller than the window was: headless Firefox's is 1366 x 768.)
    assert.ok(on.table / on.win > before.table / before.win + 0.08, `the table gets the height: ${before.table} of ${before.win} -> ${on.table} of ${on.win}`);
    assert.equal(on.lede, false);
    // The asks stay in sight, and so does whose turn it is.
    assert.ok(await page.isVisible('.rail-tab'));
    assert.ok(await page.isVisible('.lamp'));
    assert.equal(await page.getAttribute('[data-act="screen"]', 'aria-pressed'), 'true');
    // A board is answered, not presented: Send and the desk stay on screen.
    assert.ok(await page.isVisible('[data-act="send"]'), 'Send stays on screen');
    assert.ok(await page.isVisible('.board.view-desk .shelves'), 'the desk stays');
    // Shift + F leaves as it came, and f still steps the filter.
    await page.keyboard.press('Shift+F');
    await page.waitForSelector('.board:not(.screen)');
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.keyboard.press('f');
    assert.equal(await page.evaluate(() => document.querySelector('.board').classList.contains('screen')), false, 'f is the filter key');
    assert.equal(await page.getAttribute('[data-filter="yours"]', 'aria-pressed'), 'true');
    await page.keyboard.press('f');
    await page.keyboard.press('f');
    // The help names the key.
    await page.keyboard.press('?');
    assert.match(await page.textContent('dialog[open] .keys'), /Shift \+ FFull screen, or back/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+F');
    await page.waitForSelector('.board.screen');
    await page.waitForTimeout(200);
    if (on.enabled) {
      assert.equal(on.api, true, 'the browser went to full screen');
      // Leaving the browser's full screen (Esc there, a gesture) leaves the mode too.
      await page.evaluate(() => document.exitFullscreen());
      await page.waitForSelector('.board:not(.screen)');
    } else {
      await page.keyboard.press('Escape');
      await page.waitForSelector('.board:not(.screen)');
    }

    // The button does the same, on the rack too: there the width limit goes, so more columns fit.
    await page.keyboard.press('d');
    await page.waitForSelector('.board.view-rack');
    const cols = () => page.evaluate(() => getComputedStyle(document.querySelector('.slots[data-layout="grid"], .slots')).gridTemplateColumns.split(' ').length);
    const page1 = await page.evaluate(() => document.querySelector('.board').getBoundingClientRect().width);
    await page.click('[data-act="screen"]');
    await page.waitForSelector('.board.screen.view-rack');
    const [page2, win2] = await page.evaluate(() => [document.querySelector('.board').getBoundingClientRect().width, window.innerWidth]);
    assert.ok(page1 < 1300 && page2 >= win2 - 1, `the rack takes the width of the window: ${page1} -> ${page2} of ${win2}`);
    assert.ok(await cols() >= 1);
    // Esc first clears a focused card, then leaves a full window. In the browser's own full screen
    // Esc belongs to the browser (WebKit leaves at once): the board then leaves with it.
    await page.click('#c-nats .claim');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const esc = await page.evaluate(() => ({ screen: document.querySelector('.board').classList.contains('screen'), api: !!document.fullscreenElement }));
    if (!on.enabled) assert.equal(esc.screen, true, 'the first Esc only clears the focus');
    assert.ok(esc.screen || !esc.api, 'the board and the browser agree');
    if (esc.screen) {
      await page.click('[data-act="screen"]');
      await page.waitForSelector('.board:not(.screen)');
    }
    await page.waitForFunction(() => !document.fullscreenElement); // leaving the browser's full screen takes a moment
    assert.deepEqual(errors, []);

    // In a frame the page around it owns the screen: no switch, and Shift + F does nothing.
    const framed = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    await framed.goto(url + '?embed');
    await framed.waitForSelector('.board');
    assert.equal(await framed.$('[data-act="screen"]'), null);
    await framed.keyboard.press('Shift+F');
    assert.equal(await framed.evaluate(() => document.querySelector('.board').classList.contains('screen')), false);
    await framed.close();

    // On a phone the switch is not in the tools.
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await phone.goto(url);
    await phone.waitForSelector('.board.view-rack');
    assert.equal(await phone.isVisible('[data-act="screen"]'), false);
    await phone.close();
  } finally {
    await browser.close();
  }
});

test('rack placement: cards pack into columns in board order; no hole beside a wide card, no overlap, nothing under the next section', { skip: !chromium && 'playwright not installed' }, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-e2e-'));
  const ref = resolveBoard('pack', cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  const words = (n) => 'The queue keeps each message until a reader takes it. '.repeat(n).trim();
  const card = (id, claim, body) => `** ${claim}\n:PROPERTIES:\n:CUSTOM_ID: ${id}\n:END:\n${body}\n`;
  const wideFlow = '#+caption: The path of one message\n#+begin_src flow\ndirection: right\nproducer -> broker -> partition -> consumer -> store -> report\n#+end_src';
  fs.writeFileSync(ref.file, `#+title: Packing\n\n* Findings\n\n${[
    card('wide', 'A wide figure takes two columns here', words(1) + '\n\n' + wideFlow),
    card('wide2', 'A second wide figure takes two columns too', words(1) + '\n\n' + wideFlow),
    card('short', 'A short card sits beside the wide one', words(1)),
    card('tall', 'A tall card holds many facts at every level', words(2) + '\n\n' + Array.from({ length: 14 }, (_, k) => `- fact ${k + 1} :: a value that takes a line`).join('\n')),
    card('s2', 'Another short card fills a gap', words(1)),
    card('s3', 'A third short card fills the next gap', words(1)),
    card('s4', 'A fourth short card ends the section', words(1)),
  ].join('\n')}\n* After\n\n${card('next', 'The next section starts below every short card', words(1))}`);
  const r = buildBoard(ref, { cwd });
  assert.deepEqual(r.errors, []);
  const url = pathToFileURL(path.join(ref.dir, 'board.html')).href;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url + '?view=rack&level=gist');
    await page.waitForSelector('.slots.packed');
    await page.waitForTimeout(150);
    const rects = () => page.evaluate(() => {
      const box = (el) => { const q = el.getBoundingClientRect(); return { id: el.dataset.id, l: q.left, t: q.top, r: q.right, b: q.bottom }; };
      return {
        cards: [...document.querySelectorAll('.shelf:first-of-type .card:not([hidden])')].map(box),
        head: document.querySelectorAll('.shelf')[1].querySelector('.shelf-head').getBoundingClientRect().top,
      };
    });
    const sound = (got, when) => {
      for (const a of got.cards) {
        for (const b of got.cards) {
          if (a.id < b.id && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) assert.fail(`${when}: ${a.id} overlaps ${b.id}`);
        }
        assert.ok(a.b < got.head, `${when}: ${a.id} reaches under the next section`);
      }
    };
    let got = await rects();
    sound(got, 'gist');
    const at = Object.fromEntries(got.cards.map((c) => [c.id, c]));
    // The wide cards take two of three columns. In rows, the second one would leave a hole
    // beside the first; packed, the short card after them stands there.
    assert.ok(at.wide.r - at.wide.l > 1.8 * (at.short.r - at.short.l), 'the wide card spans two columns');
    assert.ok(Math.abs(at.short.t - at.wide.t) < 2, 'the short card stands beside the first wide one');
    // Each card goes to the column that is free highest: not below the tall card's row.
    assert.ok(at.s2.t < at.tall.b, 'a short card fills the gap beside the tall one');
    // Cards of like height read in rows, left to right.
    assert.ok(Math.abs(at.s2.t - at.s3.t) < 2 && at.s2.l < at.s3.l, 'level cards read left to right');

    // Opening a card packs again; so do a filter and another level.
    await page.click('#c-tall .claim');
    await page.waitForSelector('#c-tall.open');
    await page.waitForTimeout(150);
    sound(await rects(), 'open');
    await page.fill('[data-search]', 'short');
    await page.waitForTimeout(150);
    got = await rects();
    sound(got, 'search');
    assert.ok(got.cards.length < 7);
    await page.fill('[data-search]', '');
    await page.keyboard.press('Escape');
    await page.keyboard.press('3');
    await page.waitForTimeout(150);
    sound(await rects(), 'full');
    // Claim is a ledger: one row per card, no packing.
    await page.keyboard.press('1');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.slots.packed').length), 0);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.card')].some((el) => el.style.gridRow)), false);
    assert.deepEqual(errors, []);

    // A click or a keystroke packs again, and the page does not move. A reviewer saw it jump to the
    // top on a board that is one tall section: the section had collapsed for a moment while it was measured.
    const tall = resolveBoard('tall', cwd);
    fs.mkdirSync(tall.dir, { recursive: true });
    fs.writeFileSync(tall.file, '#+title: Tall\n\n* Findings\n\n' + [1, 3, 2, 5, 1, 4, 2, 6, 1, 3, 2, 4].map((n, i) =>
      card(`t${i}`, `Card ${i} holds a claim of its own here`, words(n) + '\n\n' + Array.from({ length: i % 5 }, (_, k) => `- fact ${k} :: a value that takes a line`).join('\n'))).join('\n'));
    buildBoard(tall, { cwd });
    const short = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await short.goto(pathToFileURL(path.join(tall.dir, 'board.html')).href + '?view=rack&level=gist');
    await short.waitForSelector('.slots.packed');
    await short.evaluate(() => window.scrollTo(0, 899));
    await short.waitForTimeout(150);
    const seen = await short.evaluate(() => {
      const el = [...document.querySelectorAll('.card')].find((c) => { const q = c.getBoundingClientRect(); return q.top > 0 && q.top < 600; });
      return el && { id: el.dataset.id, top: el.getBoundingClientRect().top, y: window.scrollY };
    });
    assert.ok(seen && seen.y > 300, 'the page is scrolled down to a card');
    await short.click(`#c-${seen.id} .claim`);
    await short.waitForTimeout(150);
    const after = await short.evaluate((id) => ({ top: document.getElementById('c-' + id).getBoundingClientRect().top, y: window.scrollY }), seen.id);
    assert.ok(Math.abs(after.y - seen.y) < 2 && Math.abs(after.top - seen.top) < 2, `a click moved the page: ${JSON.stringify([seen, after])}`);
    // Opening a reply box may bring it into view; typing in it moves nothing.
    await short.keyboard.press('r');
    await short.waitForTimeout(200);
    const open = await short.evaluate(() => window.scrollY);
    await short.keyboard.type('a reply');
    await short.waitForTimeout(150);
    const typed = await short.evaluate(() => window.scrollY);
    assert.ok(Math.abs(typed - open) < 2, `typing moved the page from ${open} to ${typed}`);
    await short.close();

    // A phone has one column: nothing to pack.
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await phone.goto(url + '?view=rack&level=gist');
    await phone.waitForSelector('.board.view-rack');
    assert.equal(await phone.evaluate(() => document.querySelectorAll('.slots.packed').length), 0);
    await phone.close();
  } finally {
    await browser.close();
  }
});

test('a sheet lies on the board: no card stock, edge or shadow until the pointer or focus is on it; a class diagram draws its parts', { skip: !chromium && 'playwright not installed' }, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-e2e-'));
  const ref = resolveBoard('canvas', cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  const card = (id, claim, props, body) => `** ${claim}\n:PROPERTIES:\n:CUSTOM_ID: ${id}\n${props}:END:\n${body}\n`;
  fs.writeFileSync(ref.file, `#+title: Canvas\n\n* The model\n\n${[
    card('model', 'An order owns its lines  :sheet:', '', 'Read from the schema.\n\n#+begin_src class\n  class Order {\n    +id: str\n    +total() int\n  }\n  Order "1" *-- "1..*" Line : has\n  Order --> Customer\n  Base <|-- Order\n#+end_src'),
    card('tax', 'A line has no tax rate', ':ON: model/line\n', 'The total is wrong abroad.'),
    card('other', 'The export runs nightly', '', 'Nothing to do with the model.'),
    card('later', 'The export could run hourly', ':FROM: other\n', 'Linked to the export, not to the model.'),
  ].join('\n')}`);
  const r = buildBoard(ref, { cwd });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings.map((w) => w.msg), []);
  const url = pathToFileURL(path.join(ref.dir, 'board.html')).href;
  const browser = await chromium.launch();
  try {
    for (const scheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(url + '?view=desk&level=gist');
      await page.waitForSelector('.board.view-desk');
      // The board's color, as this engine writes it.
      const bg = await page.evaluate(() => { const p = document.createElement('i'); p.style.cssText = 'background:var(--bg);color:var(--bg)'; document.body.append(p); const c = getComputedStyle(p); const v = [c.backgroundColor, c.color]; p.remove(); return v; });
      const look = (sel) => page.evaluate((s) => { const c = getComputedStyle(document.querySelector(s)); return { bg: c.backgroundColor, shadow: c.boxShadow, edge: c.borderTopColor }; }, sel);
      const sheet = await look('#c-model');
      assert.equal(sheet.bg, bg[0], `${scheme}: the sheet is the board's color`);
      assert.equal(sheet.shadow, 'none', `${scheme}: no shadow`);
      assert.match(sheet.edge, /rgba\(0, 0, 0, 0\)|transparent/, `${scheme}: no edge`);
      assert.notEqual((await look('#c-tax')).shadow, 'none', `${scheme}: a card keeps its shadow`);
      // A label's halo and a hollow mark take the board's color; a box stays card stock.
      assert.equal(await page.$eval('#c-model .fe text', (t) => getComputedStyle(t).stroke), bg[1]);
      assert.notEqual(await page.$eval('#c-model .fn.cls rect', (t) => getComputedStyle(t).fill), bg[1]);
      assert.deepEqual(await page.$$eval('#c-model .mk', (m) => m.map((x) => x.getAttribute('class'))), ['mk dia', 'mk tri']);
      assert.deepEqual(await page.$$eval('#c-model .fn.cls', (g) => g.map((x) => x.dataset.part)), ['order', 'line', 'customer', 'base']);
      // Under the pointer it shows an edge; in focus, as a card on the desk, its marks.
      const at = await page.locator('#c-model .claim').boundingBox();
      await page.mouse.move(at.x + 10, at.y + 5);
      await page.waitForTimeout(200);
      assert.doesNotMatch((await look('#c-model')).edge, /rgba\(0, 0, 0, 0\)|transparent/);
      await page.click('#c-model .claim');
      assert.ok(await page.isVisible('#c-model .acts'));
      // In focus: the ring, and no lift (the shadow moves for 140ms; wait for it to rest).
      await page.waitForFunction(() => /^\S.*\b0px 0px 0px 3px$/.test(getComputedStyle(document.querySelector('#c-model')).boxShadow), null, { timeout: 3000 });
      await page.keyboard.press('Escape');
      // Focus on a card pinned on it lights the sheet and the part; focus elsewhere lays its drawing back.
      await page.click('#c-tax .claim');
      assert.ok(await page.$eval('#c-model', (e) => e.classList.contains('lit')));
      assert.deepEqual(await page.$$eval('#c-model svg .lit', (els) => els.map((e) => e.dataset.part)), ['line']);
      await page.click('#c-other .claim');
      await page.mouse.move(5, 5);
      await page.waitForTimeout(300);
      assert.ok(await page.evaluate(() => document.querySelector('.board').classList.contains('focusing')));
      await page.waitForFunction(() => +getComputedStyle(document.querySelector('#c-model > .fig')).opacity < 0.6, null, { timeout: 3000 });
      assert.equal(await page.$eval('#c-model', (e) => getComputedStyle(e).backgroundColor), bg[0], 'outside the focus it is still the board');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('sheets: a drawing leads its section, side by side on the rack and in a lane on the desk; a numeral in it goes to its card, and focus lights the part', { skip: !chromium && 'playwright not installed' }, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-e2e-'));
  const ref = resolveBoard('sheets', cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  const card = (id, claim, props, body) => `** ${claim}\n:PROPERTIES:\n:CUSTOM_ID: ${id}\n${props}:END:\n${body}\n`;
  const days = Array.from({ length: 7 }, (_, i) => `  | 2026-10-0${i + 2} | ${i < 4 ? 420 + i * 5 : 900 + i} |`).join('\n');
  fs.writeFileSync(ref.file, `#+title: Sheets\n\n* The system\n\n${[
    card('system', 'Every upload passes one queue  :sheet:', '', 'Read from the deploy files.\n\n#+begin_src flow\n  group Cloud: api, queue, resizer\n  app -> api: HTTPS\n  api -> queue: job\n  queue -> resizer\n#+end_src'),
    card('latency', 'The p95 doubled on 6 October  :sheet:', '', `From the gateway logs.\n\n#+begin_src chart\n  | day | p95 ms |\n  |---+---|\n${days}\n#+end_src`),
    card('note', 'The api runs in one region today', ':FROM: system\n', 'A card of the section, beside the sheets on the desk.'),
  ].join('\n')}\n* Findings\n\n${[
    card('dlq', 'The queue has no dead-letter topic', ':ON: system/queue\n', 'A job that fails three times is lost.'),
    card('worker', 'The resizer runs one worker since the deploy', ':ON: system/resizer latency/2026-10-06\n', 'The queue grows at the peak.'),
  ].join('\n')}`);
  const r = buildBoard(ref, { cwd });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings.map((w) => w.msg), []);
  const url = pathToFileURL(path.join(ref.dir, 'board.html')).href;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url + '?view=rack&level=gist');
    await page.waitForSelector('.board.view-rack');
    const box = (sel) => page.evaluate((s) => { const q = document.querySelector(s).getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom, w: q.width }; }, sel);

    // The rack: the sheets lead the section, side by side, each at the width of its drawing.
    const sys = await box('#c-system');
    const lat = await box('#c-latency');
    const note = await box('#c-note');
    assert.ok(Math.abs(sys.t - lat.t) < 2 && sys.r < lat.l, 'two sheets stand side by side');
    assert.ok(note.t > Math.max(sys.b, lat.b), 'the cards of the section come after its sheets');
    assert.equal(await page.textContent('#c-system .addr .n'), 'Fig. 1');
    const drawn = await page.evaluate(() => { const s = document.querySelector('#c-latency svg'); return [s.getBoundingClientRect().width, +s.getAttribute('width')]; });
    assert.ok(Math.abs(drawn[0] - drawn[1]) < 1, `a sheet that fits shows its drawing at full size: ${drawn}`);

    // Focus on a pinned card lights its parts and its numerals, and names it on the sheets.
    await page.click('#c-worker .claim');
    assert.deepEqual(await page.$$eval('.sheet svg .lit', (els) => els.map((e) => e.dataset.part)), ['resizer', '2026-10-06']);
    assert.equal(await page.$$eval('.sheet svg .pin.on', (els) => els.length), 2);
    assert.equal(await page.textContent('#c-system .rel'), '#5 points here');
    // A numeral in a drawing is its card: a click focuses it.
    await page.click('#c-system svg .pin[data-card="dlq"]');
    assert.equal(await page.getAttribute('#c-dlq', 'class').then((c) => c.includes('focused')), true);
    assert.deepEqual(await page.$$eval('.sheet svg .lit', (els) => els.map((e) => e.dataset.part)), ['queue']);
    // Focus on the sheet lights the cards pinned on it.
    await page.click('#c-system .claim');
    assert.equal(await page.textContent('#c-dlq .rel'), 'On #1');
    await page.keyboard.press('Escape');
    // At Claim the sheet still shows its drawing; the ledger of cards does not take it in.
    await page.keyboard.press('1');
    assert.ok(await page.isVisible('#c-system svg'));
    assert.ok(await page.isHidden('#c-dlq .gist'));

    // On a phone the drawing does not widen the page: it scales down, then scrolls in its sheet.
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await phone.goto(url + '?view=rack&level=gist');
    await phone.waitForSelector('.board.view-rack');
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= 390), 'the page stays as wide as the phone');
    const fb = await phone.evaluate(() => { const b = document.querySelector('#c-latency .fig-body'); const s = b.querySelector('svg'); return { scroll: b.scrollWidth > b.clientWidth, k: s.getBoundingClientRect().width / +s.getAttribute('width') }; });
    assert.ok(fb.k >= 0.59, `the chart keeps three fifths of its size: ${fb.k}`);
    assert.ok(fb.scroll, 'the chart scrolls inside its sheet');
    await phone.close();

    // The desk: each sheet a column of its own, the section's cards in the lane beside them.
    await page.goto(url + '?view=desk&level=gist');
    await page.waitForSelector('.board.view-desk');
    await page.waitForTimeout(200);
    const plane = (sel) => page.evaluate((s) => { const el = document.querySelector(s); let x = 0, y = 0; for (let n = el; n && !n.classList.contains('plane'); n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return { l: x, t: y, r: x + el.offsetWidth, b: y + el.offsetHeight, w: el.offsetWidth }; }, sel);
    const ds = await plane('#c-system');
    const dl = await plane('#c-latency');
    const dn = await plane('#c-note');
    const df = await plane('#c-dlq');
    assert.ok(Math.abs(ds.t - dl.t) < 2 && ds.r < dl.l && dl.r < dn.l && dn.r < df.l, `sheets, then the section's cards, then the next section: ${JSON.stringify([ds, dl, dn, df])}`);
    const sheetW = ds.w;
    // The line from the sheet to the card beside it runs in the gap, not over a drawing.
    assert.equal(await page.$$eval('.wires .wire', (w) => w.length), 1);
    // A card you move freezes the table; a sheet keeps the width of its drawing.
    const handle = await page.locator('#c-dlq .addr').boundingBox();
    await page.mouse.move(handle.x + 30, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle.x + 90, handle.y + 60, { steps: 6 });
    await page.mouse.up();
    await page.waitForSelector('.board.free');
    assert.equal((await plane('#c-system')).w, sheetW);
    assert.deepEqual(errors, []);

    // A done sheet lies back as one line, as narrow as a card, on both views.
    fs.writeFileSync(ref.file, fs.readFileSync(ref.file, 'utf8').replace('** The p95 doubled', '** DONE The p95 doubled'));
    buildBoard(ref, { cwd });
    const done = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await done.goto(url + '?view=rack&level=gist');
    await done.waitForSelector('.board.view-rack');
    assert.ok(await done.evaluate(() => document.querySelector('#c-latency').offsetWidth) <= 302);
    await done.goto(url + '?view=desk&level=gist');
    await done.waitForSelector('.board.view-desk');
    assert.equal(await done.evaluate(() => document.querySelector('#c-latency').offsetWidth), 288);
    await done.close();
  } finally {
    await browser.close();
  }
});

// ---- the map of a project's boards (D45) ----

test('map: the boards of a project on one table; drag a board into a group, a group with its boards, a new group; Enter opens a board', { skip: !chromium && 'playwright not installed' }, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-e2e-'));
  const card = (id, claim, props, body) => `** ${claim}\n:PROPERTIES:\n:CUSTOM_ID: ${id}\n${props}:END:\n${body}\n`;
  const boards = {
    plan: `#+title: Plan the rewrite\n#+category: Ingest\n\n* Steps\n${card('pick', 'The queue is NATS, unless you pick Kafka', ':ASK: choose\n', 'NATS needs no cluster; a wrong pick costs a migration.\n\n- [X] nats :: NATS\n- [ ] kafka :: Kafka')}`,
    review: `#+title: Review of the plan\n#+category: Ingest\n#+from: plan\n\n* Findings\n${card('roll', 'The plan has no way back', '', 'It rests on [[file:../plan/board.org::#pick][the pick]].')}`,
    'release-1': `#+title: Release 1\n#+category: Releases\n#+from: plan\n\n* Facts\n${card('shipped', 'Release 1 shipped on time', '', 'Yes.')}`,
    'release-2': `#+title: Release 2\n#+category: Releases\n#+from: release-1\n#+needs: review\n\n* Facts\n${card('waits', 'Release 2 waits on the review', '', 'Yes.')}`,
    notes: `#+title: Notes\n\n* Notes\n${card('note', 'The notes hold nothing yet', '', 'Nothing.')}`,
  };
  for (const [id, src] of Object.entries(boards)) {
    const ref = resolveBoard(id, cwd);
    fs.mkdirSync(ref.dir, { recursive: true });
    fs.writeFileSync(ref.file, src);
    assert.deepEqual(buildBoard(ref, { cwd }).errors, []);
  }
  const url = pathToFileURL(path.join(cwd, '.cards', 'index.html')).href;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector('.board.map.view-desk .frame');
    const groups = () => page.$$eval('.frame', (fs) => fs.map((f) => `${(f.querySelector('.frame-name') || {}).textContent}:${f.querySelector('.count').textContent}`).join(' '));
    assert.equal(await groups(), 'Ingest:2 Releases:2');
    // A board with no group lies outside every frame. The map has no Send and no chat: it asks nothing.
    assert.equal(await page.locator('.send, .chat').count(), 0);
    assert.equal(await page.locator('.lamp').textContent(), 'Your turn · 1 waiting on you');
    // The rail: a tab for each board with asks; the tile lists them, each a link to its card.
    assert.deepEqual(await page.$$eval('.rail .rail-tab', (as) => as.map((a) => [a.dataset.goto, a.textContent])), [['plan', 'plan1 ask']]);
    assert.deepEqual(await page.$$eval('#c-plan .tile-asks a', (as) => as.map((a) => a.getAttribute('href'))), ['plan/board.html#c-pick']);
    // Lines from what the boards say: three "comes from", one "waits on"; a link to a card shows on focus.
    await page.waitForFunction(() => document.querySelectorAll('.wires .wire.w-from').length === 3 && document.querySelectorAll('.wires .wire.w-needs').length === 1);
    assert.equal(await page.locator('.wires .wire.w-mentions').count(), 0);
    await page.locator('#c-review .addr .n').click();
    await page.waitForSelector('#c-plan.lit');
    assert.equal(await page.locator('#c-plan .rel').textContent(), 'Source of review');
    assert.equal(await page.locator('#c-release-2 .rel').textContent(), 'Needs review');
    // Focus zoomed to the board; Esc zooms back. Wait for the table to stand still.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const box = (sel) => page.locator(sel).boundingBox();
    // Drag a board by its top strip into another group: what lies in a frame is in that group.
    async function dropTile(id, x, y) {
      const r = await box(`#c-${id}`);
      const a = await box(`#c-${id} .addr`);
      const gx = a.x + a.width - 20;
      const gy = a.y + a.height / 2;
      await page.mouse.move(gx, gy);
      await page.mouse.down();
      await page.mouse.move(gx + 10, gy + 10, { steps: 2 });
      await page.mouse.move(x + (gx - r.x) - r.width / 2, y + (gy - r.y) - r.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(400); // a click right after a drag is the end of the drag
    }
    const ingest = await box('.frame[data-frame="g-ingest"]');
    await dropTile('release-2', ingest.x + ingest.width / 2, ingest.y + ingest.height - 40);
    assert.equal(await groups(), 'Ingest:3 Releases:1');
    // Drag a group by its name: its boards go with it.
    const head = await box('.frame[data-frame="g-releases"] .frame-head');
    const before = await box('#c-release-1');
    await page.mouse.move(head.x + 60, head.y + 10);
    await page.mouse.down();
    await page.mouse.move(head.x + 160, head.y + 130, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await box('#c-release-1');
    const head2 = await box('.frame[data-frame="g-releases"] .frame-head');
    assert.ok(Math.abs((after.x - before.x) - (head2.x - head.x)) < 2 && after.y - before.y > 50, 'the board moved with its group');
    // A new group: an empty frame beside the rest, its name ready to type.
    await page.click('[data-act="new-group"]');
    await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('frame-input'));
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Later');
    await page.keyboard.press('Enter');
    assert.equal(await groups(), 'Ingest:3 Releases:1 Later:0');
    assert.equal(await page.locator('.frame[data-frame="u1"] [data-act="frame-remove"]').count(), 1, 'an empty group can be removed');
    await page.click('[data-zoom="fit"]');
    await page.waitForTimeout(500);
    const later = await box('.frame[data-frame="u1"]');
    await dropTile('notes', later.x + later.width / 2, later.y + later.height / 2 + 10);
    assert.equal(await groups(), 'Ingest:3 Releases:1 Later:1');
    // Your table lives in this browser.
    await page.reload();
    await page.waitForSelector('.board.map.free .frame');
    assert.equal(await groups(), 'Ingest:3 Releases:1 Later:1');
    // Arrange puts every board back in the group it names.
    await page.click('[data-act="arrange"]');
    await page.waitForFunction(() => !document.querySelector('.board.free'));
    assert.equal(await groups(), 'Ingest:2 Releases:2');
    // The reading view lists the groups; the frames are a thing of the desk.
    await page.keyboard.press('d');
    await page.waitForSelector('.board.map.view-rack');
    assert.deepEqual(await page.$$eval('.shelf-head h2', (hs) => hs.map((h) => h.textContent)), ['Ingest', 'Releases']);
    assert.equal(await page.locator('.frame').count(), 0);
    // Enter on a board opens it.
    await page.locator('#c-review').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/review\/board\.html$/);
    assert.equal(await page.locator('.related a').first().textContent(), 'plan');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('map, review of 0.6: your table survives a filter, a second project, a new group, a new board, and what the storage holds', { skip: !chromium && 'playwright not installed' }, async () => {
  const card = (id, claim, props, body) => `** ${claim}\n:PROPERTIES:\n:CUSTOM_ID: ${id}\n${props}:END:\n${body}\n`;
  const make = (boards) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-e2e-'));
    const add = (id, src) => {
      const ref = resolveBoard(id, cwd);
      fs.mkdirSync(ref.dir, { recursive: true });
      fs.writeFileSync(ref.file, src);
      assert.deepEqual(buildBoard(ref, { cwd }).errors, []);
    };
    for (const [id, src] of Object.entries(boards)) add(id, src);
    return { cwd, add, url: pathToFileURL(path.join(cwd, '.cards', 'index.html')).href };
  };
  const board = (title, cat, claim) => `#+title: ${title}\n${cat ? `#+category: ${cat}\n` : ''}\n* S\n${card('a', claim, '', 'Yes.')}`;
  const one = make({
    a1: `#+title: A one\n#+category: Alpha\n\n* S\n${card('pick', 'The band is the sport one', ':ASK: choose\n', 'A wrong band means a return.\n\n- [X] sport :: Sport\n- [ ] link :: Link')}`,
    b1: board('B one', 'Beta', 'The first beta board stands'),
    b2: board('B two', 'Beta', 'The second beta board stands'),
    u1: board('U one', '', 'A loose board stands'),
    u2: board('U two', '', 'Another loose board stands'),
  });
  const two = make({ x1: board('X one', 'Other', 'The other project has one board') });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const groups = () => page.$$eval('.frame', (fs) => fs.map((f) => `${(f.querySelector('.frame-name') || {}).textContent}:${f.querySelector('.count').textContent}`).join(' '));
    const box = (sel) => page.locator(sel).boundingBox();
    async function drag(sel, dx, dy) {
      const a = await box(sel);
      await page.mouse.move(a.x + a.width - 20, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width - 10, a.y + a.height / 2 + 10, { steps: 2 });
      await page.mouse.move(a.x + a.width - 20 + dx, a.y + a.height / 2 + dy, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(400);
    }
    await page.goto(one.url);
    await page.waitForSelector('.board.map .frame');
    assert.equal(await groups(), 'Alpha:1 Beta:2');
    // A filter is on when the first drag freezes the table: the groups it hides keep their frames.
    await page.keyboard.press('f');
    await page.waitForFunction(() => document.querySelectorAll('.card:not([hidden])').length === 1);
    await drag('#c-a1 .addr', 24, 0);
    await page.keyboard.press('f');
    await page.keyboard.press('f');
    await page.waitForFunction(() => document.querySelectorAll('.card:not([hidden])').length === 5);
    assert.equal(await groups(), 'Alpha:1 Beta:2');
    // New group while a filter hides boards: the new frame takes in none of them.
    await page.keyboard.press('f');
    await page.click('[data-act="new-group"]');
    await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('frame-input'));
    await page.keyboard.press('Enter');
    await page.keyboard.press('f');
    await page.keyboard.press('f');
    await page.waitForTimeout(300);
    assert.equal(await groups(), 'Alpha:1 Beta:2 Group 1:0');
    // Beta under Alpha; then the agent adds a board to Alpha: Alpha grows, Beta moves down, nothing changes group.
    await page.click('[data-zoom="fit"]');
    await page.waitForTimeout(500);
    const al = await box('.frame[data-frame="g-alpha"]');
    const bh = await box('.frame[data-frame="g-beta"] .frame-head');
    await page.mouse.move(bh.x + 40, bh.y + 8);
    await page.mouse.down();
    await page.mouse.move(bh.x + 60, bh.y + 20, { steps: 2 });
    await page.mouse.move(al.x + 40, al.y + al.height + 30, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    one.add('a2', board('A two', 'Alpha', 'The second alpha board stands'));
    one.add('c1', board('C one', 'Gamma', 'A board of a new group stands'));
    await page.reload();
    await page.waitForSelector('.board.map.free .frame');
    assert.equal(await groups(), 'Alpha:2 Beta:2 Group 1:0 Gamma:1');
    const [fa, fb] = await page.$$eval('.frame[data-frame="g-alpha"], .frame[data-frame="g-beta"]', (fs) => fs.map((f) => [f.offsetTop, f.offsetTop + f.offsetHeight]));
    assert.ok(fa[1] <= fb[0], `Alpha (${fa}) ends above Beta (${fb})`);
    // What the storage holds goes into the page as numbers only.
    const key = await page.evaluate(() => JSON.parse(document.getElementById('board-data').textContent).board.key);
    await page.evaluate((k) => {
      const place = JSON.parse(localStorage.getItem(`cards:${k}:place`));
      place.frames['g-beta'][0] = '0px;"><img src=x onerror="document.title=\'pwned\'">';
      localStorage.setItem(`cards:${k}:place`, JSON.stringify(place));
    }, key);
    await page.reload();
    await page.waitForSelector('.board.map.free .frame');
    await page.waitForTimeout(300);
    assert.notEqual(await page.title(), 'pwned');
    assert.equal(await page.locator('.frame img').count(), 0);
    // Another project's map in the same browser has its own table.
    await page.goto(two.url);
    await page.waitForSelector('.board.map .frame');
    assert.equal(await groups(), 'Other:1');
    assert.equal(await page.locator('.board.free').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
