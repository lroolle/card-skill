// A board is an Org file. This checks that claim against Org itself: every
// template and every board the project shows passes `org-lint` in a real
// Emacs, and Emacs reads the same cards from them as our parser does.
// Skips when Emacs is not installed; CI sets CARDS_EMACS=required.
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseBoard } from '../skill/lib/board.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const emacs = spawnSync('emacs', ['--version'], { encoding: 'utf8' }).status === 0;
if (!emacs && process.env.CARDS_EMACS === 'required') throw new Error('CARDS_EMACS=required, but emacs did not run');
const skip = !emacs && 'emacs not installed';
const run = (script, files) => execFileSync('emacs', ['--batch', '-Q', '-l', path.join(ROOT, 'test', 'emacs', script), ...files], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const FILES = [
  ...fs.readdirSync(path.join(ROOT, 'skill', 'templates')).filter((f) => f.endsWith('.org')).map((f) => path.join(ROOT, 'skill', 'templates', f)),
  ...['demo', 'demo-zh', 'roadmap', 'design-review'].map((b) => path.join(ROOT, '.cards', b, 'board.org')),
];

test('emacs: org-lint finds nothing in the templates and the boards the project shows', { skip }, () => {
  const out = run('lint.el', FILES);
  const findings = out.split('\n').filter((l) => l.startsWith('FINDING\t')).map((l) => l.split('\t').slice(1).join('  '));
  assert.deepEqual(findings, []);
  assert.equal(out.split('\n').filter((l) => l.startsWith('FILE\t')).length, FILES.length, 'every file was linted');
});

test('emacs: org-lint is really looking (a broken board has findings)', { skip }, () => {
  const file = path.join(fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'cards-emacs-')), 'board.org');
  fs.writeFileSync(file, '#+title: T\n\n** A card\n\n:PROPERTIES:\n:CUSTOM_ID: a\n:END:\nSee [[#nope]].\n');
  const out = run('lint.el', [file]);
  assert.match(out, /FINDING\t[^\t]*\t\d+\tUnknown custom ID "nope"/);
  assert.match(out, /FINDING\t[^\t]*\t\d+\tIncorrect contents for PROPERTIES drawer/, 'a blank line before the drawer: the fault our own check warns about');
});

test('emacs: Org reads the same cards as our parser: state, id, ask, needs, tags, claim', { skip }, () => {
  const out = run('read.el', FILES);
  const seen = new Map();
  for (const l of out.split('\n').filter((x) => x.startsWith('CARD\t'))) {
    const [, file, todo, id, ask, needs, tags, heading] = l.split('\t');
    if (!seen.has(file)) seen.set(file, []);
    // Org keeps the progress cookie in the heading text; for us it is not part of the claim.
    seen.get(file).push({ todo, id, ask, needs, tags, title: heading.replace(/\s*\[\d+(?:\/\d+|%)\]$/, '') });
  }
  let cards = 0;
  for (const file of FILES) {
    const board = parseBoard(fs.readFileSync(file, 'utf8'), { fmt: 'org' });
    assert.deepEqual(board.errors, [], file);
    const ours = board.cards.map((c) => ({
      todo: c.keyword || '',
      id: c.id,
      ask: c.ask || '',
      needs: [...c.needs.map((n) => (c.when[n] ? `${n}=${c.when[n]}` : n))].join(' '),
      tags: c.tags.join(','),
      title: c.title,
    }));
    const theirs = (seen.get(file) || []).map((c) => ({ ...c, ask: c.ask.toLowerCase(), needs: c.needs.split(/[\s,]+/).filter(Boolean).join(' ') }));
    assert.deepEqual(theirs, ours, path.relative(ROOT, file));
    cards += ours.length;
  }
  assert.ok(cards > 60, `${cards} cards compared`);
});
