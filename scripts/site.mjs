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
import '../skill/runtime/digest.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'skill', 'bin', 'cards.mjs');
const BOARDS = ['demo', 'demo-zh', 'design-review', 'roadmap'];

const argv = process.argv.slice(2);
const out = path.resolve(ROOT, argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : '_site');
const cards = (...args) => execFileSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
  const demo = JSON.parse(fs.readFileSync(path.join(dir, 'demo', 'index.html'), 'utf8').match(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/)[1]);
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
    CARDS: Object.keys(demo.cards).length,
    // The page wears the board's own tokens: one source for both.
    TOKENS: css.slice(css.indexOf(':root {'), css.indexOf('* { box-sizing')).trim(),
  };
  const page = path.join(dir, 'index.html');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in fill ? fill[k] : m)));
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
  const list = [
    ['design-review', 'design-review/index.html?level=claim', [1440, 900], async (p) => {
      await p.click('[data-zoom="1"]');
      await p.waitForTimeout(600);
      await p.evaluate(() => { const d = document.querySelector('.shelves'); d.scrollLeft = 0; d.scrollTop = 0; });
    }, { inside: '.shelves' }],
    ['roadmap', 'roadmap/index.html?view=rack&level=gist', [1180, 900], async (p) => { await p.locator('#c-proof').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -70)); }, { clip: [30, 40, 760, 475] }],
    ['demo', 'demo/index.html?view=rack&level=gist', [1180, 900], async (p) => { await p.locator('#c-nats').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -110)); }, { clip: [30, 30, 760, 475] }],
    ['demo-zh', 'demo-zh/index.html?view=rack&level=gist', [1180, 900], async (p) => { await p.locator('#c-nats').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -110)); }, { clip: [30, 30, 760, 475] }],
    // Two things the sample cannot show: a card that changed, and a card that draws what it says.
    // The first is the repo's own working page, not the export: an export drops past versions.
    ['changed', pathToFileURL(path.join(ROOT, '.cards', 'design-review', 'board.html')).href + '?view=rack&level=gist&fresh', [700, 1200],
      async (p) => { await p.click('#c-opt-desk .claim'); await p.click('#c-opt-desk .history summary'); }, { el: '#c-opt-desk' }],
    ['figure', 'design-review/index.html?view=rack&level=gist', [700, 1200], null, { el: '#c-return-channel' }],
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
        take.clip = [box.x + 8, box.y + 8, 760, 475];
      }
      if (take.el) await page.locator(take.el).screenshot({ path: file });
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
