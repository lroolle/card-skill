#!/usr/bin/env node
// site.mjs -- build the public site: the landing page and the boards it shows.
//
//   node scripts/site.mjs [--out _site]    write the site
//   node scripts/site.mjs --shots          also take the pictures in site/shots/ (needs Playwright)
//
// The landing page is site/index.html, written by hand. The boards are
// exported with `cards export`, so each one is the copy a reader may see:
// no replies, no history, no local path.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NAME, VERSION, HOME } from '../skill/lib/version.mjs';
import { MARK } from '../skill/lib/compile.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'skill', 'bin', 'cards.mjs');
const BOARDS = ['demo', 'demo-zh', 'design-review', 'roadmap'];
// The picture of each board on the landing page: the view that shows it best.
const SHOTS = { 'design-review': [], roadmap: [], demo: ['--view', 'rack'], 'demo-zh': ['--view', 'rack'] };

const argv = process.argv.slice(2);
const out = path.resolve(ROOT, argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : '_site');
const cards = (...args) => execFileSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });

if (argv.includes('--shots')) {
  for (const id of BOARDS) {
    process.stdout.write(cards('shot', id, '--out', path.join('site', 'shots', `${id}.png`), '--width', '1280', '--height', '800', ...SHOTS[id]));
  }
}

const repo = HOME.replace(/^https:\/\/github\.com\//, '');
const [owner, name] = repo.split('/');
const css = fs.readFileSync(path.join(ROOT, 'skill', 'runtime', 'board.css'), 'utf8');
const fill = {
  NAME,
  VERSION,
  REPO: repo,
  URL: `https://${owner}.github.io/${name}/`,
  LICENSE: fs.existsSync(path.join(ROOT, 'LICENSE')) ? fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8').split('\n')[0].trim() : '',
  ICON: `data:image/svg+xml,${encodeURIComponent(MARK(true))}`,
  // The page wears the board's own tokens: one source for both.
  TOKENS: css.slice(css.indexOf(':root {'), css.indexOf('* { box-sizing')).trim(),
};

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'site'), out, { recursive: true });
const page = path.join(out, 'index.html');
fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in fill ? fill[k] : m)));
for (const id of BOARDS) cards('export', id, '--out', path.join(out, id));
console.log(`wrote ${path.relative(process.cwd(), out)}/: index.html and ${BOARDS.length} boards (${BOARDS.join(', ')})`);
