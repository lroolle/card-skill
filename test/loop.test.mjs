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

  // :NEEDS: a=value names an answer of the ask a; a=* is any answer.
  const when = (needs, extra = '') => parseBoard(`#+title: T\n\n** Which band?\n:PROPERTIES:\n:CUSTOM_ID: band\n:ASK: choose\n:END:\n- [X] sport :: Sport\n- [ ] link :: Link\n\n** Why?\n:PROPERTIES:\n:CUSTOM_ID: why\n:ASK: answer\n:END:\nSay why.\n\n** A plain card\n:PROPERTIES:\n:CUSTOM_ID: plain\n${extra}:END:\nGist.\n\n** Size?\n:PROPERTIES:\n:CUSTOM_ID: size\n:ASK: approve\n:NEEDS: ${needs}\n:END:\nGist.\n`, { fmt: 'org' });
  assert.deepEqual(when('band=link why=*').errors, []);
  assert.deepEqual([when('band=link why=*').cards[3].needs, when('band=link why=*').cards[3].when], [['band', 'why'], { band: 'link', why: '*' }]);
  assert.match(when('band=leather').errors[0].msg, /"leather" is not an answer of band/);
  assert.match(when('band=leather').errors[0].fix, /:NEEDS: band=sport {3}\(band can be: sport, link; \* is any answer\)/);
  assert.match(when('why=yes').errors[0].msg, /why takes free text, so only \* \(any answer\) can be named/);
  assert.match(when('plain=*').errors[0].msg, /an answer can be named only where an ask waits on an ask/);
  assert.match(when('band', ':NEEDS: band=link\n').errors[0].msg, /an answer can be named only where an ask waits on an ask/);
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

  // A board that was never rendered exports as its first render would show it.
  const fresh = project(WATCH, 'fresh');
  cards(fresh.cwd, ['export', 'fresh', '--out', path.join(fresh.cwd, 'out')]);
  const first = JSON.parse(fs.readFileSync(path.join(fresh.cwd, 'out', 'index.html'), 'utf8').match(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual([first.board.rev, first.cards['pick-band'].n, first.cards.engraving.n], [1, 1, 5]);
  assert.ok(!fs.existsSync(path.join(fresh.ref.dir, 'log.jsonl')));
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
  assert.deepEqual(pub.data.board.langs.map((m) => [m.href, m.self]), [['../watch/index.html', false], ['../watch-zh/index.html', true]]);

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

test('review fixes: asks that wait on each other are an error, not a page that never opens', () => {
  const two = (a, b) => `** A?\n:PROPERTIES:\n:CUSTOM_ID: a\n:ASK: approve\n:NEEDS: ${a}\n:END:\nGist.\n\n** B?\n:PROPERTIES:\n:CUSTOM_ID: b\n:ASK: approve\n:NEEDS: ${b}\n:END:\nGist.\n\n** C?\n:PROPERTIES:\n:CUSTOM_ID: c\n:ASK: approve\n:END:\nGist.\n`;
  const loop = parseBoard(`#+title: T\n\n${two('b', 'a')}`, { fmt: 'org' });
  assert.equal(loop.errors.length, 1);
  assert.match(loop.errors[0].msg, /asks wait on each other: a -> b -> a/);
  assert.match(loop.errors[0].fix, /remove one :NEEDS:/);
  assert.deepEqual(parseBoard(`#+title: T\n\n${two('c', 'c')}`, { fmt: 'org' }).errors, [], 'two asks may wait on the same ask');
});

test('review fixes: a reply is never guessed; its state is worked out, not trusted', () => {
  const { cwd, ref } = project();
  cards(cwd, ['render', 'watch', '--quiet']);
  const head = 'cards: reply from the board "Pick the band" (watch)\n.cards/watch/board.org · rev 1 · 2026-10-09 04:00\n\n';
  const items = () => fold(readLog(ref.dir)).sends.at(-1).items;

  // A chat or a mail collapsed the two spaces: the suggestion in brackets is not an answer.
  cards(cwd, ['ingest', 'watch'], `${head}  #1 pick-band   choose   changed: link (you suggested sport)\n`);
  assert.deepEqual([items()[0].value, items()[0].state], [['link'], 'changed']);

  // A sentence that happens to hold a key names no option.
  assert.match(fails(cwd, ['ingest', 'watch'], `${head}  #1 pick-band   choose   confirmed: I will not pick sport, ask me later\n`), /names no option of the card \(sport, link\)/);
  // Two options on a single choice.
  assert.match(fails(cwd, ['ingest', 'watch'], `${head}  #1 pick-band   choose   changed: sport, link\n`), /2 options on a single choice/);
  // The word "confirmed" on a value that is not the suggestion is recorded as what it is.
  cards(cwd, ['ingest', 'watch'], `${head}  #1 pick-band   choose   confirmed: link\n  #2 pick-size   choose   untouched (no answer)\n`);
  assert.deepEqual([items()[0].state, items()[1]], ['changed', { card: 'pick-size', v: 1, kind: 'choose', state: 'untouched', default: [] }]);
  // A reply with no key is still one round, however often it is pasted.
  const n = fold(readLog(ref.dir)).sends.length;
  assert.match(cards(cwd, ['ingest', 'watch'], `${head}  #1 pick-band   choose   confirmed: link\n  #2 pick-size   choose   untouched (no answer)\n`), /already recorded as round/);
  assert.equal(fold(readLog(ref.dir)).sends.length, n);
  // A section named "board" comes back as itself; the untitled section is the bare sign.
  const text = globalThis.cardsDigest({ board: { id: 'x', title: 'X' }, items: [{ section: 'board', kind: 'order', value: ['a', 'b'] }, { section: '', kind: 'order', value: ['c'] }] }, {});
  assert.match(text, /§board\s+order\s+a, b\n\s+§\s+order\s+c/);
  assert.deepEqual(parseReply(text).lines.map((l) => l.who), ['§board', '§']);
});

test('review fixes: ingest leaves an earlier unread round unread; settle closes only what stands at this version', () => {
  const { cwd, ref } = project();
  cards(cwd, ['render', 'watch', '--quiet']);
  addSend(ref.dir, { rev: 1, items: [{ card: 'engraving', v: 1, kind: 'answer', text: 'sent from the served page' }] });
  const out = cards(cwd, ['ingest', 'watch'], 'cards: reply from the board "Pick the band" (watch)\nrev 1 · reply 0000aaaa\n\n  #4 verify   do   done\n');
  assert.match(out, /recorded round 2[\s\S]*1 earlier round is unread\. Read it first: cards inbox watch/);
  assert.match(cards(cwd, ['inbox', 'watch']), /sent from the served page[\s\S]*#4 verify\s+do\s+done/, 'the inbox still shows the round nobody read');

  // The agent revises a card that has an answer: the answer is to the old version, and settle leaves the card open.
  fs.writeFileSync(ref.file, fs.readFileSync(ref.file, 'utf8').replace('One line, 20 characters at most.', 'One line, 12 characters at most.'));
  cards(cwd, ['render', 'watch', '--quiet']);
  assert.match(cards(cwd, ['settle', 'watch']), /DONE: verify\./);
  assert.match(fs.readFileSync(ref.file, 'utf8'), /^\*\* What should the engraving say\?$/m);

  // A stray carriage return above a card does not move the edit to another line, and line endings stay.
  const crlf = project(WATCH.replace('* Decisions\n', '* Decisions\nloading 50%\rloading 100%\n').replace(/\n/g, '\r\n'), 'crlf');
  cards(crlf.cwd, ['render', 'crlf', '--quiet']);
  assert.match(cards(crlf.cwd, ['settle', 'crlf', 'bag']), /DONE: bag/);
  const after = fs.readFileSync(crlf.ref.file, 'utf8');
  assert.match(after, /\r\n\*\* DONE Put the watch in the bag\r\n/);
  assert.equal(after.replace('** DONE Put', '** Put'), fs.readFileSync(crlf.ref.file, 'utf8').replace('** DONE Put', '** Put'));
  assert.equal(after.split('\r\n').length, WATCH.split('\n').length + 1, 'every line ending is as it was');
});

test('review fixes: a published copy names a file, not where it lies; a link never names another machine', async () => {
  const { cwd, ref } = project(WATCH + '\n[[file:../../clients/acme-secret-client/report.pdf]]\n\n#+caption: The desk\n[[file:../../clients/acme-secret-client/desk.png]]\n\n#+include: "../../clients/acme-secret-client/app.js" src js :lines "1-3"\n');
  const dir = path.join(cwd, 'clients', 'acme-secret-client');
  fs.mkdirSync(dir, { recursive: true });
  const { png } = await import('./png.mjs');
  fs.writeFileSync(path.join(dir, 'report.pdf'), '%PDF-1.4\n');
  fs.writeFileSync(path.join(dir, 'desk.png'), png(8, 8));
  fs.writeFileSync(path.join(dir, 'app.js'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
  cards(cwd, ['render', 'watch', '--quiet']);
  assert.match(fs.readFileSync(path.join(ref.dir, 'board.html'), 'utf8'), /clients\/acme-secret-client\/app\.js/, 'the local page says where the file is');
  cards(cwd, ['export', 'watch', '--out', path.join(cwd, 'out')]);
  const html = fs.readFileSync(path.join(cwd, 'out', 'index.html'), 'utf8');
  assert.ok(!html.includes('acme-secret-client'), 'no folder name of the project is in the copy');
  const depth = JSON.parse(html.match(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/)[1]).cards.engraving.depth_html;
  assert.match(depth, /excerpt-src[^>]*>app\.js</);
  assert.match(depth, /href="files\/report\.pdf"/);

  const { link } = await import('../skill/lib/md.mjs');
  const { orgInline } = await import('../skill/lib/org.mjs');
  for (const bad of ['//evil.com/x', '\\\\evil.com\\x', '/\\evil.com', 'a\\b']) assert.equal(link(bad, 'x'), 'x', `${bad} is not a link`);
  assert.ok(!orgInline('[[file://evil.com/x][x]]').includes('href'));
  assert.match(link('../roadmap/board.html', 'x'), /^<a href="\.\.\/roadmap\/board\.html">x<\/a>$/);
  assert.match(link('https://a.b/c', 'x'), /target="_blank" rel="noopener noreferrer"/);
});

test('review fixes: every command that writes the page says a new build once; a broken sibling stops nothing', () => {
  const { cwd, ref } = project();
  fs.writeFileSync(path.join(ref.dir, 'log.jsonl'), JSON.stringify({ t: 'rev', rev: 1, at: '2026-10-01T00:00:00.000Z', hash: 'x' }) + '\n');
  assert.match(cards(cwd, ['say', 'watch', 'hello']), /note: watch was last rendered by an older build of cards/);
  assert.ok(!/note:/.test(cards(cwd, ['render', 'watch', '--quiet'])), 'said once, by the command that recorded it');

  // A folder named board.org next to the board, and a sibling that is not a board at all.
  fs.mkdirSync(path.join(cwd, '.cards', 'odd', 'board.org'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.cards', 'empty'));
  assert.match(cards(cwd, ['render', 'watch', '--quiet']), /^rev \d+/m);
});

test('index: every render writes the list of boards; a board links back to it; a published copy does not, unless told where', () => {
  const { cwd, ref } = project();
  const second = resolveBoard('plan', cwd);
  fs.mkdirSync(second.dir, { recursive: true });
  fs.writeFileSync(second.file, '#+title: A plan with <b>no</b> asks\n\n** DONE The first step is done\n:PROPERTIES:\n:CUSTOM_ID: one\n:END:\nGist.\n');
  cards(cwd, ['render', 'watch', '--quiet']);
  cards(cwd, ['render', 'plan', '--quiet']);
  const index = fs.readFileSync(path.join(cwd, '.cards', 'index.html'), 'utf8');
  // The board with open asks comes first; a title is text, never markup.
  assert.ok(index.indexOf('Pick the band') < index.indexOf('A plan with'), 'what waits comes first');
  assert.match(index, /<a href="watch\/board\.html" lang="en">Pick the band<\/a><span class="wait"><i><\/i>5 open asks<\/span><span class="meta">watch · rev 1 · 5 cards<\/span>/);
  assert.match(index, /A plan with &lt;b&gt;no&lt;\/b&gt; asks<\/a><span class="idle">no open ask<\/span>/);
  assert.match(index, /<title>\(5\) Boards of /);
  // An answer on disk takes its ask off the count.
  cards(cwd, ['ingest', 'watch'], 'cards: reply from the board "Pick the band" (watch)\nrev 1 · reply 0000bbbb\n\n  #4 verify   do   done\n');
  cards(cwd, ['render', 'watch', '--quiet']);
  assert.match(fs.readFileSync(path.join(cwd, '.cards', 'index.html'), 'utf8'), /4 open asks/);

  const data = (html) => JSON.parse(html.match(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data(fs.readFileSync(path.join(ref.dir, 'board.html'), 'utf8')).board.home, '../index.html');
  cards(cwd, ['export', 'watch', '--out', path.join(cwd, 'out', 'a')]);
  assert.equal(data(fs.readFileSync(path.join(cwd, 'out', 'a', 'index.html'), 'utf8')).board.home, '', 'a published copy does not point at a list on your disk');
  cards(cwd, ['export', 'watch', '--out', path.join(cwd, 'out', 'b'), '--home', '../index.html']);
  assert.equal(data(fs.readFileSync(path.join(cwd, 'out', 'b', 'index.html'), 'utf8')).board.home, '../index.html');
  assert.ok(!fs.existsSync(path.join(cwd, 'out', 'index.html')), 'an export writes no list');

  // A board that lives outside a .cards directory gets no list written beside it.
  const loose = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-loose-'));
  fs.mkdirSync(path.join(loose, 'notes', 'b'), { recursive: true });
  fs.writeFileSync(path.join(loose, 'notes', 'b', 'board.org'), '#+title: T\n\n** A claim that stands\n:PROPERTIES:\n:CUSTOM_ID: a\n:END:\nGist.\n');
  cards(loose, ['render', 'notes/b', '--quiet']);
  assert.ok(!fs.existsSync(path.join(loose, 'notes', 'index.html')));
});

test('hook: cards hook prints the settings lines that hand the agent unread replies', () => {
  const { cwd, ref } = project();
  const out = cards(cwd, ['hook']);
  const snippet = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  const command = snippet.hooks.UserPromptSubmit[0].hooks[0].command;
  assert.match(command, /^node ".*bin\/cards\.mjs" inbox --quiet$/);
  assert.match(out, /Ask the human before you change their settings\./);
  // The command itself: silent with nothing to read, then the reply once.
  cards(cwd, ['render', 'watch', '--quiet']);
  const run = () => execFileSync('sh', ['-c', command], { cwd, encoding: 'utf8' });
  assert.equal(run(), '');
  addSend(ref.dir, { rev: 1, items: [{ card: 'verify', v: 1, kind: 'do', value: 'done' }] });
  assert.match(run(), /reply from the board "Pick the band" \(watch\)[\s\S]*#4 verify\s+do\s+done/);
  assert.equal(run(), '', 'read once');
});
