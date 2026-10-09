// The page chrome in the board's language.
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { languages, resolveLang, strings, t, merge, LANG_DIR } from '../skill/lib/i18n.mjs';
import { buildBoard } from '../skill/lib/compile.mjs';
import { parseBoard } from '../skill/lib/board.mjs';

const read = (l) => JSON.parse(fs.readFileSync(path.join(LANG_DIR, `${l}.json`), 'utf8'));
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('i18n: every language has every English key, with the same {placeholders}', () => {
  const en = read('en');
  assert.ok(Object.keys(en).length > 50, 'en.json holds the chrome');
  for (const l of languages().filter((x) => x !== 'en')) {
    const tr = read(l);
    for (const k of Object.keys(en)) {
      if (k.endsWith('_one') && !(k in tr)) continue; // a language with no singular form may leave it out
      assert.ok(k in tr, `${l}.json has no "${k}"`);
      assert.equal(holes(tr[k]), holes(en[k]), `${l}.json "${k}" keeps the placeholders of en`);
    }
    for (const k of Object.keys(tr)) assert.ok(k in en, `${l}.json has "${k}", which en.json does not`);
  }
});

test('i18n: a tag finds its file; anything else is English', () => {
  assert.deepEqual(['zh', 'zh-CN', 'zh-Hans', 'zh-hans-cn', 'ZH-SG'].map(resolveLang), Array(5).fill('zh-Hans'));
  assert.deepEqual(['en', 'en-GB', 'fr', '', undefined, 'x-klingon'].map(resolveLang), Array(6).fill('en'));
  const zh = strings('zh-CN');
  assert.equal(zh.lang, 'zh-Hans');
  assert.equal(zh.strings.fig, '图');
});

test('i18n: t fills placeholders, picks the _one form, and shows a missing key as itself', () => {
  const table = { round: 'Round {n}', card: '{n} cards', card_one: '{n} card' };
  assert.equal(t(table, 'round', { n: 3 }), 'Round 3');
  assert.equal(t(table, 'card', { n: 1 }), '1 card');
  assert.equal(t(table, 'card', { n: 2 }), '2 cards');
  assert.equal(t(table, 'nope'), 'nope');
});

test('i18n: a language with no singular form never shows the English one', () => {
  const en = { ready: '{n} responses', ready_one: '{n} response', send: 'Send', only_en: 'Only' };
  const zh = merge(en, { ready: '{n} 条回应', send: '发送' });
  assert.equal(t(zh, 'ready', { n: 1 }), '1 条回应');
  assert.equal(zh.only_en, 'Only', 'a missing word still falls back to English');
});

test('i18n: sections titled in Chinese get distinct ids that stay put when sections move', () => {
  const b = parseBoard('#+title: 选\n\n* 选项  :compare:\n\n* 决定\n\n* Options 2\n', { fmt: 'org' });
  assert.deepEqual(b.errors, []);
  const [a, d, o] = b.sections.map((x) => x.id);
  assert.match(a, /^section-[0-9a-f]{6}$/);
  assert.notEqual(a, d);
  assert.equal(o, 'options-2');
  const moved = parseBoard('#+title: 选\n\n* 新的一组\n\n* 决定\n\n* 选项\n', { fmt: 'org' });
  assert.deepEqual(moved.sections.slice(1).map((x) => x.id), [d, a]);
});

test('i18n: Traditional Chinese gets English chrome until a zh-Hant file ships', () => {
  assert.deepEqual(['zh-TW', 'zh-HK', 'zh-Hant', 'zh-Hant-TW', 'zh-MO'].map(resolveLang), Array(5).fill('en'));
  assert.equal(resolveLang('zh-Hans-TW'), 'zh-Hans');
});

test('i18n: a zh-Hans board carries the Chinese table, and figures are numbered in Chinese', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-i18n-'));
  const file = path.join(dir, 'board.org');
  fs.writeFileSync(file, `#+title: 选一个队列\n#+language: zh-Hans\n\n** NATS 用一个二进制文件就能扛住峰值\n:PROPERTIES:\n:CUSTOM_ID: nats\n:END:\n要点。\n\n#+caption: 数据流\n#+begin_src flow\n  a -> b\n#+end_src\n`);
  const r = buildBoard({ id: 'q', dir, file }, { cwd: dir });
  assert.deepEqual(r.errors, []);
  assert.equal(r.data.strings.fig, '图');
  assert.match(r.data.cards.nats.figure_html, /<b>图 1\.1<\/b> 数据流/);
  assert.match(r.html, /<html lang="zh-Hans">/);
  assert.match(r.html, /<noscript><p class="noscript">这个看板需要开启 JavaScript/);
});
