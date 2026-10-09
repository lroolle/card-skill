// The loop around the board: asks that depend on asks, a pasted reply read back
// into the log, a copy to publish, translations, and what an update says.
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseBoard } from '../skill/lib/board.mjs';
import { lint } from '../skill/lib/lint.mjs';
import { buildBoard } from '../skill/lib/compile.mjs';
import { fold, readLog, addSend, resolveBoard } from '../skill/lib/store.mjs';
import { parseReply, replyItems } from '../skill/lib/ingest.mjs';
import { validItems } from '../skill/lib/serve.mjs';
import { VERSION } from '../skill/lib/version.mjs';
import '../skill/runtime/digest.js';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const CLI = path.join(ROOT, 'skill', 'bin', 'cards.mjs');
const cards = (cwd, args, input) => execFileSync('node', [CLI, ...args], { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const fails = (cwd, args, input) => { try { cards(cwd, args, input); } catch (e) { return String(e.stdout) + String(e.stderr); } return ''; };

const WATCH = `#+title: Pick the band
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

** What should the engraving say?
:PROPERTIES:
:CUSTOM_ID: engraving
:ASK: answer
:END:
One line, 20 characters at most.
`;

function project(src = WATCH, id = 'watch') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-loop-'));
  const ref = resolveBoard(id, cwd);
  fs.mkdirSync(ref.dir, { recursive: true });
  fs.writeFileSync(ref.file, src);
  return { cwd, ref };
}

test('format: do asks, :SUGGEST: none, option keys, and what Emacs writes into a card', () => {
  const b = parseBoard(WATCH, { fmt: 'org' });
  assert.deepEqual(b.errors, []);
  assert.deepEqual(lint(b), [], 'a choose with :SUGGEST: none needs no [X]');
  const [band, size, , verify] = b.cards;
  assert.deepEqual(band.anatomy.options.map((o) => [o.value, o.key, o.default]), [['sport', 'sport', true], ['link', 'link', false]]);
  assert.equal(band.anatomy.options[0].text, 'Sport band, 140 to 190 mm');
  assert.equal(size.suggest, 'none');
  assert.equal(verify.ask, 'do');

  // A planning line and Org's own properties are not card text and not errors.
  const emacs = parseBoard(`#+title: T\n#+startup: overview\n\n** DONE The claim stands\nCLOSED: [2026-10-09 Fri 10:00]\n:PROPERTIES:\n:CUSTOM_ID: a\n:VISIBILITY: folded\n:ARCHIVE_TIME: 2026-10-09 Fri\n:END:\n:LOGBOOK:\n- State "DONE"       from "TODO"       [2026-10-09 Fri 10:00]\n:END:\nThe gist.\n`, { fmt: 'org' });
  assert.deepEqual(emacs.errors, []);
  assert.equal(emacs.cards[0].id, 'a');
  assert.equal(emacs.cards[0].anatomy.gist.text, 'The gist.');
  assert.deepEqual(lint(emacs), []);

  const bad = parseBoard('#+title: T\n\n** Pick one\n:PROPERTIES:\n:CUSTOM_ID: p\n:ASK: choose\n:SUGGEST: none\n:END:\n- [X] a :: A\n- [ ] a :: B\n', { fmt: 'org' });
  assert.match(bad.errors.map((e) => e.msg).join('|'), /:SUGGEST: none with an option marked \[X\].*two options answer "a"/);
});

test('lint: syntax that does nothing here is said, not swallowed', () => {
  const b = parseBoard(`#+title: T\n#+icon: x.png\n#+startup: overview\n\n** DOING The page shows the photo\n\n:PROPERTIES:\n:CUSTOM_ID: a\n:END:\nGist.\n\n#+begin_src image\nshots/a.png\n#+end_src\n\n#+begin_note\nKeep this.\n#+end_note\n\n#+begin_comment\nnot shown\n#+end_comment\n\n** Pick one\n:PROPERTIES:\n:CUSTOM_ID: p\n:ASK: choose\n:END:\n- [X] S/M :: small\n- [ ] large :: big\n`, { fmt: 'org' });
  assert.deepEqual(b.errors, []);
  const ws = lint(b).map((w) => w.msg);
  const has = (re) => assert.ok(ws.some((m) => re.test(m)), `${re} in:\n${ws.join('\n')}`);
  has(/^#\+icon: does nothing in this build/);
  assert.ok(!ws.some((m) => /startup/.test(m)), 'an Org setting for Emacs passes without a word');
  has(/^DOING is not a TODO keyword to Emacs or GitHub.*#\+todo: TODO DOING BLOCKED \| DONE/);
  has(/a blank line before :PROPERTIES:/);
  has(/#\+begin_src image is shown as code, not drawn.*\[\[file:shot\.png\]\]/);
  has(/#\+begin_note has no look of its own here/);
  has(/option key "S\/M" must be lowercase.*s-m :: S\/M/);
  assert.ok(!b.cards[0].anatomy.depth.some((x) => /not shown/.test(JSON.stringify(x))), 'a comment block is not shown');
});

test('digest: an option comes back as its key; text is exact; chosen, do and held read as what they are', () => {
  const text = globalThis.cardsDigest({
    board: { id: 'watch', title: 'Pick the "band"', path: '.cards/watch/board.org' }, rev: 2, at: '2026-10-09T04:00:00.000Z', key: '3fa9c1d2', pasted: true,
    items: [
      { card: 'pick-band', v: 1, kind: 'choose', value: ['link'], default: ['sport'], state: 'changed' },
      { card: 'pick-size', v: 1, kind: 'choose', state: 'held', needs: ['pick-band'], why: 'changed' },
      { card: 'bag', v: 1, kind: 'approve', state: 'held', needs: ['pick-size'], why: 'open' },
      { card: 'verify', v: 1, kind: 'do', value: 'done' },
      { card: 'engraving', v: 1, kind: 'answer', text: 'For "E"\nline two', after: ['pick-band'] },
    ],
  }, { 'pick-band': { n: 1, v: 1 }, 'pick-size': { n: 2, v: 1 }, bag: { n: 3, v: 1 }, verify: { n: 4, v: 1 }, engraving: { n: 5, v: 1 } });
  assert.match(text, /^cards: reply from the board "Pick the \\"band\\"" \(watch\)\n\.cards\/watch\/board\.org · rev 2 · 2026-10-09 04:00 · reply 3fa9c1d2/);
  assert.match(text, /#1 pick-band\s+choose\s+changed: link {2}\(you suggested sport\)/);
  assert.match(text, /#2 pick-size\s+choose\s+held: #1 changed from your suggestion; this ask was written for the suggestion\. Ask again\./);
  assert.match(text, /#3 bag\s+approve\s+held: waits for #2/);
  assert.match(text, /#4 verify\s+do\s+done/);
  assert.match(text, /#5 engraving\s+answer\s+"For \\"E\\"\\nline two" {2}\[answered after #1 changed\]/);
  assert.match(text, /This reply is not on disk yet\. Record it first: cards ingest watch/);
  assert.ok(!globalThis.cardsAnswered([{ items: [{ card: 'bag', v: 1, kind: 'approve', state: 'held' }] }]).has('bag@1'), 'held is not an answer');
});

test('ingest: a pasted reply becomes a round, once; the asks show as answered; settle closes them', () => {
  const { cwd, ref } = project();
  cards(cwd, ['render', 'watch', '--quiet']);
  const cardsNow = Object.fromEntries([...fold(readLog(ref.dir)).cards].map(([id, r]) => [id, { n: r.n, v: r.v }]));
  const batch = {
    board: { id: 'watch', title: 'Pick the band', path: '.cards/watch/board.org' }, rev: 1, at: '2026-10-09T04:00:00.000Z', pasted: true,
    items: [
      { card: 'pick-band', v: 1, kind: 'choose', value: ['link'], default: ['sport'], state: 'changed' },
      { card: 'pick-size', v: 1, kind: 'choose', state: 'held', needs: ['pick-band'], why: 'changed' },
      { card: 'bag', v: 1, kind: 'approve', state: 'held', needs: ['pick-size'], why: 'open' },
      { card: 'verify', v: 1, kind: 'do', value: 'done' },
      { card: 'engraving', v: 1, kind: 'answer', text: 'For "E",\nwith love' },
      { card: 'verify', v: 1, kind: 'mark', value: 'keep' },
      { card: 'bag', v: 1, kind: 'reply', text: 'ask me again after the size' },
      { kind: 'note', text: 'thanks' },
    ],
  };
  batch.key = globalThis.cardsReplyKey(batch);
  assert.ok(validItems(batch.items), 'the page would send these to a server as they are');
  // As a human pastes it: with a line of their own before it, and the indentation gone.
  const pasted = 'here is my reply\n\n' + globalThis.cardsDigest(batch, cardsNow).replace(/^ {2}/gm, '');

  const reply = parseReply(pasted);
  assert.deepEqual([reply.id, reply.rev, reply.key, reply.path], ['watch', 1, batch.key, '.cards/watch/board.org']);
  const { items, problems } = replyItems(reply, parseBoard(fs.readFileSync(ref.file, 'utf8'), { fmt: 'org' }), fold(readLog(ref.dir)));
  assert.deepEqual(problems, []);
  assert.deepEqual(items, batch.items, 'the text round-trips to the same items');

  const out = cards(cwd, ['ingest'], pasted);
  assert.match(out, /recorded round 1 of watch: 8 responses, 3 asks answered, 2 held \(pick-size, bag: ask again\)/);
  assert.match(cards(cwd, ['ingest', 'watch'], pasted), /already recorded as round 1/);
  const st = fold(readLog(ref.dir));
  assert.deepEqual([st.sends.length, st.sends[0].via, st.sends[0].key, st.read], [1, 'paste', batch.key, 1]);
  assert.match(cards(cwd, ['inbox']), /no unread replies/, 'the agent pasted it, so it has read it');

  const r = buildBoard(ref, { cwd });
  assert.equal(r.data.sends[0].key, batch.key, 'the page learns its copied answers arrived');
  assert.match(cards(cwd, ['show', 'watch']), /2 waiting on you/, 'the two held asks still wait; the three answered ones do not');

  // settle: one keyword per answered ask; the ask and its options stay as the record.
  assert.match(cards(cwd, ['settle', 'watch']), /DONE: pick-band, verify, engraving/);
  const src = fs.readFileSync(ref.file, 'utf8');
  assert.match(src, /^\*\* DONE Which band goes with the watch\?$/m);
  assert.match(src, /^\*\* Which size fits your wrist\?$/m);
  const after = parseBoard(src, { fmt: 'org' });
  assert.deepEqual(lint(after), [], 'an ask on a done card is the record, not a mistake');
  assert.match(cards(cwd, ['settle', 'watch']), /no open ask on watch has an answer on disk/);
  assert.match(cards(cwd, ['settle', 'watch', 'bag']), /DONE: bag/);

  // A reply that does not fit says why and records nothing.
  const wrong = fails(cwd, ['ingest', 'watch'], pasted.replace('changed: link', 'changed: leather').replace(/reply [0-9a-f]{8}/, 'reply 00000000'));
  assert.match(wrong, /pick-band: "changed: leather.*names no option of the card \(sport, link\)/);
  assert.equal(fold(readLog(ref.dir)).sends.length, 1);
});

test('ingest: options with no key are found whole, and an older reply with bare quotes is read', () => {
  const { cwd, ref } = project(`#+title: T\n\n** Pick the size\n:PROPERTIES:\n:CUSTOM_ID: size\n:ASK: choose\n:MULTI: t\n:END:\n- [X] S/M, for 140 to 180 mm\n- [ ] M/L, for 160 to 210 mm\n- [ ] One size\n\n** Why?\n:PROPERTIES:\n:CUSTOM_ID: why\n:ASK: answer\n:END:\nSay why.\n`, 'size');
  cards(cwd, ['render', 'size', '--quiet']);
  const old = 'cards: reply from the board "T"\n.cards/size/board.org · rev 1 · 2026-10-09 04:00\n\n  #1 size         choose   changed: S/M, for 140 to 180 mm, One size  (you suggested S/M, for 140 to 180 mm)\n  #2 why          answer   "it says "fits most" on the box"\n';
  assert.match(cards(cwd, ['ingest', 'size'], old), /recorded round 1 of size: 2 responses, 2 asks answered/);
  const items = fold(readLog(ref.dir)).sends[0].items;
  assert.deepEqual(items[0].value, ['S/M, for 140 to 180 mm', 'One size']);
  assert.equal(items[1].text, 'it says "fits most" on the box');
});

test('export: a copy to publish holds the board as it is now, and nothing of the work behind it', () => {
  const { cwd, ref } = project(WATCH.replace('#+todo:', '#+author: Claude\n#+description: Pick the band and the size.\n#+todo:') + '\n[[file:../../order.pdf]]\n');
  fs.writeFileSync(path.join(cwd, 'order.pdf'), '%PDF-1.4\n');
  cards(cwd, ['render', 'watch', '--quiet']);
  fs.writeFileSync(ref.file, fs.readFileSync(ref.file, 'utf8').replace('The sport band is the lighter one.', 'The sport band weighs less.'));
  cards(cwd, ['render', 'watch', '--quiet']);
  addSend(ref.dir, { rev: 2, items: [{ card: 'engraving', v: 1, kind: 'answer', text: 'a private line' }, { kind: 'note', text: 'a private note' }] });
  cards(cwd, ['say', 'watch', 'a private answer']);

  const local = fs.readFileSync(path.join(ref.dir, 'board.html'), 'utf8');
  assert.match(local, /a private line/);
  assert.match(local, /The sport band is the lighter one\./, 'the local page keeps the past version');

  const out = path.join(cwd, 'site', 'watch');
  assert.match(cards(cwd, ['export', 'watch', '--out', out]), /wrote site\/watch\/index\.html and 1 linked file in files\//);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  for (const secret of ['a private line', 'a private note', 'a private answer', 'The sport band is the lighter one.', cwd, '.cards/watch']) {
    assert.ok(!html.includes(secret), `the copy does not hold: ${secret}`);
  }
  const data = JSON.parse(html.match(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual([data.public, data.sends, data.chat, data.board.path, data.cards['pick-band'].history], [true, [], [], '', []]);
  assert.match(html, /<meta name="description" content="Pick the band and the size\.">/);
  assert.match(html, /<meta property="og:title" content="Pick the band">/);
  assert.match(html, /<meta name="author" content="Claude">/);
  assert.match(html, new RegExp(`<meta name="generator" content="cards ${VERSION.replace(/\./g, '\\.')}">`));
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,/);
  assert.match(data.cards.engraving.depth_html, /class="file-chip" href="files\/order\.pdf"/);
  assert.equal(fs.readFileSync(path.join(out, 'files', 'order.pdf'), 'utf8'), '%PDF-1.4\n');
  assert.equal(fold(readLog(ref.dir)).rev, 2, 'an export records nothing');
});

test('translations: sibling boards link to each other, and check says where one fell behind', () => {
  const { cwd, ref } = project();
  const zh = resolveBoard('watch-zh', cwd);
  fs.mkdirSync(zh.dir, { recursive: true });
  const ZH = `#+title: 选表带\n#+language: zh-Hans\n#+translation_of: watch\n\n* 决定\n\n** 手表配哪条表带？\n:PROPERTIES:\n:CUSTOM_ID: pick-band\n:ASK: choose\n:END:\n运动表带更轻。\n\n- [X] sport :: 运动表带，140 到 190 毫米\n- [ ] link :: 磁吸链式表带，140 到 180 毫米\n\n** 哪个尺码合你的手腕？\n:PROPERTIES:\n:CUSTOM_ID: pick-size\n:ASK: choose\n:NEEDS: pick-band\n:END:\n只有你能量。\n\n- [ ] S/M\n- [ ] M/L\n\n** 多出来的一张\n:PROPERTIES:\n:CUSTOM_ID: extra\n:END:\n要点。\n`;
  fs.writeFileSync(zh.file, ZH);
  cards(cwd, ['render', 'watch', '--quiet']);
  const out = cards(cwd, ['render', 'watch-zh', '--quiet']);
  assert.match(out, /pick-size: give each option a key/);
  assert.match(out, /card extra is not on the source board watch/);
  assert.match(out, /card bag of watch has no translation here/);

  const en = buildBoard(ref, { cwd });
  assert.deepEqual(en.data.board.langs, [{ id: 'watch', lang: 'en', self: true, href: '../watch/board.html' }, { id: 'watch-zh', lang: 'zh-Hans', self: false, href: '../watch-zh/board.html' }]);
  const pub = buildBoard(zh, { cwd, publish: true, write: false });
  assert.deepEqual(pub.data.board.langs.map((m) => [m.href, m.self]), [['../watch/', false], ['../watch-zh/', true]]);

  // The source moves on: the translation of that card is stale.
  fs.writeFileSync(ref.file, WATCH.replace('The sport band is the lighter one.', 'The sport band weighs 12 g less.'));
  cards(cwd, ['render', 'watch', '--quiet']);
  assert.match(cards(cwd, ['check', 'watch-zh']), /pick-band: watch changed this card \(v2\) after it was last written here; translate it again/);

  // A reply sent from the translation shows in the source board's inbox.
  addSend(zh.dir, { rev: 1, items: [{ card: 'pick-band', v: 1, kind: 'choose', value: ['link'], default: ['sport'], state: 'changed' }] });
  assert.match(cards(cwd, ['inbox', 'watch', '--peek']), /reply from the board "选表带" \(watch-zh\)[\s\S]*pick-band\s+choose\s+changed: link/);

  fs.writeFileSync(zh.file, ZH.replace('#+translation_of: watch', '#+translation_of: nowhere'));
  assert.match(fails(cwd, ['check', 'watch-zh']), /#\+translation_of: nowhere names no other board next to this one/);
});

test('version: one number everywhere, and a render by another build is said once', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, VERSION);
  assert.match(fs.readFileSync(path.join(ROOT, 'skill', 'CHANGES.md'), 'utf8'), new RegExp(`^## ${VERSION.replace(/\./g, '\\.')}\\b`, 'm'), 'CHANGES.md opens with this version');
  assert.match(fs.readFileSync(path.join(ROOT, 'skill', 'SKILL.md'), 'utf8'), new RegExp(`version: "?${VERSION.replace(/\./g, '\\.')}`));
  const { cwd, ref } = project();
  assert.match(cards(cwd, ['--version']), new RegExp(`^cards ${VERSION.replace(/\./g, '\\.')}\\n`));

  // A board that an older build rendered: a log with no build line.
  fs.writeFileSync(path.join(ref.dir, 'log.jsonl'), JSON.stringify({ t: 'rev', rev: 1, at: '2026-10-01T00:00:00.000Z', hash: 'x' }) + '\n');
  assert.match(cards(cwd, ['check', 'watch']), /note: watch was last rendered by an older build of cards; this is cards .*CHANGES\.md/);
  assert.match(cards(cwd, ['render', 'watch', '--quiet']), /note: watch was last rendered by an older build/);
  assert.equal(fold(readLog(ref.dir)).build, VERSION);
  assert.ok(!/note:/.test(cards(cwd, ['render', 'watch', '--quiet'])), 'said once');
  assert.ok(!/note:/.test(cards(cwd, ['check', 'watch'])));
});

test('outline: a card that carries a picture or a figure says so', () => {
  const { cwd, ref } = project(`#+title: T\n\n** The desk shows every card\n:PROPERTIES:\n:CUSTOM_ID: a\n:END:\nGist.\n\n#+caption: The loop\n#+begin_src flow\n  a -> b\n#+end_src\n`, 'fig');
  assert.match(cards(cwd, ['render', 'fig']), /#1 {3}a\s+The desk shows every card {2}\[figure\]/);
  assert.ok(fs.existsSync(path.join(ref.dir, 'board.html')));
});
