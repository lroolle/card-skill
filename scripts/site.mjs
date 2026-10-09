#!/usr/bin/env node
// site.mjs -- build the public site: the landing page and the boards it shows.
//
//   node scripts/site.mjs [--out _site]    write the site
//   node scripts/site.mjs --shots          first take the pictures in site/shots/ (needs Playwright
//                                          and a machine whose system-ui is a real sans face)
//
// The landing page is site/index.html, written by hand. The boards are
// exported with `cards export`, so each one is the copy a reader may see:
// no replies, no history, no local path. What the page quotes from the
// product (the reply text, the colors) is taken from the product here, so it
// cannot drift.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NAME, VERSION, HOME } from '../skill/lib/version.mjs';
import { MARK, tokenOf } from '../skill/lib/compile.mjs';
import { boardFont } from '../skill/lib/font.mjs';
import '../skill/runtime/digest.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'skill', 'bin', 'cards.mjs');
const BOARDS = ['demo', 'demo-zh', 'design-review', 'roadmap'];

const argv = process.argv.slice(2);
const out = path.resolve(ROOT, argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : '_site');
const cards = (...args) => execFileSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The source of one card: from its heading to the line before the next heading.
function cardSource(board, id) {
  const lines = fs.readFileSync(path.join(ROOT, '.cards', board, 'board.org'), 'utf8').split('\n');
  const at = lines.findIndex((l) => l.trim() === `:CUSTOM_ID: ${id}`);
  let from = at;
  while (from > 0 && !/^\*\* /.test(lines[from])) from--;
  let to = at;
  while (to + 1 < lines.length && !/^\*{1,2} /.test(lines[to + 1])) to++;
  return lines.slice(from, to + 1).join('\n').trim();
}

function build(dir) {
  const repo = HOME.replace(/^https:\/\/github\.com\//, '');
  const [owner, name] = repo.split('/');
  const css = fs.readFileSync(path.join(ROOT, 'skill', 'runtime', 'board.css'), 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'site'), dir, { recursive: true });
  for (const id of BOARDS) {
    // Say which boards carry their own font: on a machine without one, the Chinese sample would not.
    const font = cards('export', id, '--out', path.join(dir, id)).split('\n').find((l) => l.startsWith('font:'));
    if (font) console.log(`${id}: ${font}`);
  }

  // The reply in "The loop" is the reply the sample gives: the same function, the same cards.
  // Every number the page states about a board is read from that board.
  const dataOf = (id) => JSON.parse(fs.readFileSync(path.join(dir, id, 'index.html'), 'utf8').match(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/)[1]);
  const open = (d) => Object.values(d.cards).filter((c) => c.ask && c.status !== 'done').length;
  const [demo, review, roadmap] = ['demo', 'design-review', 'roadmap'].map(dataOf);
  const index = Object.fromEntries(Object.values(demo.cards).map((c) => [c.id, { n: c.n, v: c.v }]));
  const reply = globalThis.cardsDigest({ items: [
    { card: 'pick-queue', v: 1, kind: 'choose', value: ['kafka'], default: ['nats'], state: 'changed' },
    { card: 'cutover', v: 1, kind: 'approve', state: 'held', needs: ['pick-queue'], why: 'changed' },
    { card: 'nats', v: 1, kind: 'mark', value: 'more' },
  ] }, index).split('\n').filter((l) => /^\s+#\d/.test(l)).map((l) => l.replace(/^ {2}/, '').replace(/ {2,}/g, '  ')).join('\n');

  const fill = {
    NAME,
    VERSION,
    REPO: repo,
    URL: `https://${owner}.github.io/${name}/`,
    LICENSE: fs.existsSync(path.join(ROOT, 'LICENSE')) ? fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8').split('\n')[0].trim() : '',
    ICON: `data:image/svg+xml,${encodeURIComponent(MARK(false))}`,
    BG: tokenOf('--bg'),
    BG_NIGHT: tokenOf('--bg', true),
    REPLY: esc(reply),
    // Card 6 of the sample as the agent wrote it, from board.org itself, in each language.
    CARD_SRC: esc(cardSource('demo', 'pick-queue')),
    CARD_SRC_ZH: esc(cardSource('demo-zh', 'pick-queue')),
    CARDS: Object.keys(demo.cards).length,
    DEMO_ASKS: open(demo),
    DR_CARDS: Object.keys(review.cards).length,
    DR_REV: review.board.rev,
    RM_CARDS: Object.keys(roadmap.cards).length,
    RM_ASKS: open(roadmap),
    // The page wears the board's own tokens: one source for both.
    TOKENS: css.slice(css.indexOf(':root {'), css.indexOf('* { box-sizing')).trim(),
  };
  fill.CSS = fs.readFileSync(path.join(ROOT, 'site', 'landing.css'), 'utf8').trim();
  fs.rmSync(path.join(dir, 'landing.css'));
  for (const rel of ['index.html', path.join('zh', 'index.html')]) {
    const page = path.join(dir, rel);
    const src = fs.readFileSync(page, 'utf8');
    // The Chinese page carries its own font, as a Chinese board does: a subset of an open face.
    const font = /<html lang="zh/.test(src) ? boardFont('zh-Hans', src + fill.REPLY) : { css: '', state: 'none' };
    if (font.state !== 'none') console.log(`${rel}: font ${font.state}${font.why ? ` (${font.why})` : ''}`);
    fs.writeFileSync(page, src.replace(/\{\{(\w+)\}\}/g, (m, k) => (k === 'FONT' ? font.css : k in fill ? fill[k] : m)));
  }
  return dir;
}

// The pictures: each one a part of a real page at reading size, by day and by night.
async function shots() {
  const require = createRequire(import.meta.url);
  let chromium = null;
  for (const p of ['playwright', path.join(os.homedir(), '.npm-global/lib/node_modules/playwright')]) {
    try { ({ chromium } = require(p)); break; } catch { /* next */ }
  }
  if (!chromium) throw new Error('--shots needs Playwright');
  const tmp = build(fs.mkdtempSync(path.join(os.tmpdir(), 'cards-site-')));
  const url = (rel) => { const [file, query = ''] = rel.split('?'); return pathToFileURL(path.join(tmp, file)).href + (query ? `?${query}` : ''); };
  const dir = path.join(ROOT, 'site', 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const hide = '.bar, .chat, .toast { display: none !important; }';
  // [name, page, viewport, what to do before the picture, the element or the region to take]
  const top = (id) => async (p) => { await p.evaluate((sel) => document.querySelector(sel).closest('.shelf').scrollIntoView({ block: 'start' }), id); await p.evaluate(() => window.scrollBy(0, -12)); };
  const local = pathToFileURL(path.join(ROOT, '.cards', 'design-review', 'board.html')).href + '?view=rack&level=gist&fresh';
  const history = async (p) => { await p.click('#c-signal-cards .claim'); await p.click('#c-signal-cards .history summary'); };
  const list = [
    ['design-review', 'design-review/index.html?level=claim', [1440, 900], async (p) => {
      await p.click('[data-zoom="1"]');
      await p.waitForTimeout(600);
      await p.evaluate(() => { const d = document.querySelector('.shelves'); d.scrollLeft = 0; d.scrollTop = 0; });
    }, { inside: '.shelves' }],
    // A tile shows a section from its head: what the caption names is what the picture shows.
    ['roadmap', 'roadmap/index.html?view=rack&level=gist', [1180, 900], top('#c-proof'), { inside: '.shelf:has(#c-proof)' }],
    ['demo', 'demo/index.html?view=rack&level=gist', [1180, 900], top('#c-nats'), { inside: '.shelf:has(#c-nats)' }],
    ['demo-zh', 'demo-zh/index.html?view=rack&level=gist', [1180, 900], top('#c-nats'), { inside: '.shelf:has(#c-nats)' }],
    // Two more things a card does, each on a real card. The first is the repo's own
    // working page, not the export: an export drops past versions. Each is taken twice:
    // at the width of a desktop column, and at the width of a phone.
    ['changed', local, [700, 1400], history, { el: '#c-signal-cards' }],
    ['changed-narrow', local, [400, 1400], history, { el: '#c-signal-cards' }],
    ['figure', 'design-review/index.html?view=rack&level=gist', [700, 1400], null, { el: '#c-return-channel' }],
    ['figure-narrow', 'design-review/index.html?view=rack&level=gist', [400, 1400], null, { el: '#c-return-channel' }],
    // Card 6 of the sample as the page shows it, for "one card, three forms".
    ['card6', 'demo/index.html?view=rack&level=gist&fresh', [420, 1200], null, { el: '#c-pick-queue', pad: 26 }],
    ['card6-zh', 'demo-zh/index.html?view=rack&level=gist&fresh', [420, 1200], null, { el: '#c-pick-queue', pad: 26 }],
  ];
  for (const theme of ['light', 'dark']) {
    for (const [name, rel, [w, h], before, take] of list) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: theme });
      await page.goto(/^file:/.test(rel) ? rel : url(rel));
      await page.waitForSelector('.card');
      await page.addStyleTag({ content: hide });
      if (before) await before(page);
      await page.waitForTimeout(300);
      const file = path.join(dir, `${name}-${theme}.png`);
      if (take.inside) {
        const box = await page.locator(take.inside).boundingBox();
        take.clip = [Math.max(0, box.x - 6), Math.max(0, box.y + (take.inside === '.shelves' ? 8 : -4)), 760, 475];
      }
      if (take.el && take.pad) {
        // With room above the card for its tab, which stands outside the card's own box.
        await page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); window.scrollBy(0, r.top - 80); }, take.el);
        const box = await page.locator(take.el).boundingBox();
        await page.screenshot({ path: file, clip: { x: box.x - 6, y: box.y - take.pad, width: box.width + 12, height: box.height + take.pad + 6 } });
      } else if (take.el) await page.locator(take.el).screenshot({ path: file });
      else await page.screenshot({ path: file, clip: { x: take.clip[0], y: take.clip[1], width: take.clip[2], height: take.clip[3] } });
      await page.close();
      console.log(`shot ${path.relative(ROOT, file)}`);
    }
  }
  // The link preview: the first screen of the page itself, served so that the frame loads.
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    const file = path.join(tmp, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!file.startsWith(tmp) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': { '.html': 'text/html; charset=utf-8', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(dir, 'og.png') });
  console.log('shot site/shots/og.png');
  server.close();
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (argv.includes('--shots')) await shots();
build(out);
console.log(`wrote ${path.relative(process.cwd(), out)}/: index.html and ${BOARDS.length} boards (${BOARDS.join(', ')})`);
