// A Chinese, Japanese or Korean board carries a subset of an open font.
// The parts that need a font and fonttools on the machine skip without them;
// CI sets CARDS_FONT=required.
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { boardFont, scriptOf, cjkChars, FAMILY } from '../skill/lib/font.mjs';
import { fold, readLog, resolveBoard } from '../skill/lib/store.mjs';

const CLI = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'skill', 'bin', 'cards.mjs');
// `npm test` turns the font off so that no other test depends on this machine's fonts; here it is on.
const env = { ...process.env };
delete env.CARDS_CJK_FONT;
const can = boardFont('zh-Hans', '看板', { env }).state === 'embedded';
if (!can && process.env.CARDS_FONT === 'required') throw new Error(`CARDS_FONT=required, but: ${boardFont('zh-Hans', '看板', { env }).why}`);
const skip = !can && 'no open CJK font or no fonttools on this machine';

test('font: which face a language takes, and which characters count', () => {
  assert.deepEqual(['zh', 'zh-CN', 'zh-Hans', 'zh-Hant', 'zh-TW', 'zh-HK', 'ja', 'ko-KR', 'en', '', 'fr'].map(scriptOf), ['SC', 'SC', 'SC', 'TC', 'TC', 'HK', 'JP', 'KR', null, null, null]);
  assert.deepEqual(cjkChars('Pick 队列, 队列。ok ＡＢ かな'), ['。', 'か', 'な', '列', '队', 'Ａ', 'Ｂ']);
  assert.deepEqual(boardFont('en', '队列', { env }), { css: '', state: 'none', why: '' }, 'an English board is left alone, Han or not');
  assert.equal(boardFont('zh-Hans', 'no han here', { env }).state, 'none');
});

test('font: without a font or a tool the page keeps the system font, and says why', () => {
  assert.deepEqual(boardFont('zh-Hans', '看板', { env: { CARDS_CJK_FONT: 'none' } }), { css: '', state: 'system', why: 'CARDS_CJK_FONT=none' });
  const missing = boardFont('zh-Hans', '看板', { env: { CARDS_CJK_FONT: '/nowhere/NotoSansSC-Regular.otf' } });
  assert.deepEqual([missing.state, missing.css], ['system', '']);
  assert.match(missing.why, /no open CJK font on this machine/);
});

test('font: a Chinese board carries two weights of only its own characters, with the license inside', { skip }, () => {
  const f = boardFont('zh-Hans', '给接入服务选一个消息队列。发送', { env });
  assert.equal(f.state, 'embedded');
  assert.equal(f.chars, 15);
  // The face keeps its own name, and board.css is told which one it is.
  assert.match(f.family, /^(Noto Sans|Source Han Sans)( CJK)? SC$/);
  assert.ok(f.css.startsWith(`:root{--cjk:"${f.family}"}`));
  const faces = [...f.css.matchAll(/@font-face\{font-family:"[^"]+ SC";font-style:normal;font-weight:([\d ]+);font-display:swap;src:url\(data:font\/(woff2?);base64,([A-Za-z0-9+/=]+)\) format\("woff2?"\);unicode-range:U\+2E80/g)];
  assert.deepEqual(faces.map((m) => m[1]), ['400', '600 700']);
  for (const m of faces) {
    const bin = Buffer.from(m[3], 'base64');
    assert.equal(bin.subarray(0, 4).toString('latin1'), m[2] === 'woff2' ? 'wOF2' : 'wOFF');
    assert.ok(bin.length > 2000 && bin.length < 40000, `15 characters are ${bin.length} bytes`);
  }
  assert.ok(f.bytes < 60000);
  assert.equal(FAMILY, 'Cards CJK');
});

test('font: render puts the font into the page and says so once; an export carries it too', { skip }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-font-'));
  const ref = resolveBoard('zh', cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  fs.writeFileSync(ref.file, '#+title: 选一个队列\n#+language: zh-Hans\n\n** NATS 用一个二进制文件就能扛住峰值\n:PROPERTIES:\n:CUSTOM_ID: nats\n:END:\n三节点集群就够。\n');
  const cards = (args, e = env) => execFileSync('node', [CLI, ...args], { cwd, env: e, encoding: 'utf8' });
  const first = cards(['render', 'zh', '--quiet']);
  assert.match(first, /font: the page carries its own font for this language \(\d+ characters of (Noto Sans|Source Han Sans)/);
  const html = fs.readFileSync(path.join(ref.dir, 'board.html'), 'utf8');
  assert.equal((html.match(/@font-face\{font-family:"[^"]+ SC"/g) || []).length, 2);
  assert.match(html, /--font: var\(--cjk\), system-ui/);
  assert.match(html, /:root\{--cjk:"[^"]+ SC"\}/);
  assert.equal(fold(readLog(ref.dir)).font, 'embedded');
  assert.ok(!/font:/.test(cards(['render', 'zh', '--quiet'])), 'said once');
  // The same machine with the font turned off: the page falls back, and that is said once too.
  const off = cards(['render', 'zh', '--quiet'], { ...env, CARDS_CJK_FONT: 'none' });
  assert.match(off, /font: the page uses the reader's system font for this language: CARDS_CJK_FONT=none\. To carry one in the page, see .*format\.md, "A font in the page"/);
  assert.ok(!fs.readFileSync(path.join(ref.dir, 'board.html'), 'utf8').includes('@font-face{'));
  assert.match(cards(['export', 'zh', '--out', path.join(cwd, 'out')]), /font: the page carries its own font/);
  assert.equal((fs.readFileSync(path.join(cwd, 'out', 'index.html'), 'utf8').match(/@font-face\{font-family:"[^"]+ SC"/g) || []).length, 2);
});
