// Files in cards: images, excerpts and chips; the fences; versions that follow files.
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseBoard } from '../skill/lib/board.mjs';
import { resolveAssets, imageSize, projectRoot } from '../skill/lib/assets.mjs';
import { buildBoard } from '../skill/lib/compile.mjs';
import { parseInclude } from '../skill/lib/org.mjs';
import { png } from './png.mjs';

function project(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-assets-'));
  const dir = path.join(root, '.cards', 'demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, 'shots'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'shots', 'desk.png'), png(40, 20));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), Array.from({ length: 60 }, (_, k) => `const line${k + 1} = ${k + 1};`).join('\n') + '\n');
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=x\n');
  fs.writeFileSync(path.join(root, 'report.pdf'), '%PDF-1.4\n');
  const file = path.join(dir, 'board.org');
  fs.writeFileSync(file, `#+title: Files\n\n* Evidence\n\n${body}`);
  return { root, dir, file, ref: { id: 'demo', dir, file } };
}

const CARDS = `** The desk shows every card at once
:PROPERTIES:
:CUSTOM_ID: shot
:END:
The screenshot is the desk at Fit.

#+caption: The desk at Fit
[[file:../../shots/desk.png]]

** The parser reads lines 10 to 39 of app.js
:PROPERTIES:
:CUSTOM_ID: code
:END:
The excerpt comes from the file.

#+include: "../../src/app.js" src js :lines "10-40"

[[file:../../report.pdf]]
`;

test('org: a bare file link is a file block; #+include is an excerpt with Org line semantics', () => {
  const b = parseBoard(`#+title: T\n\n${CARDS}`, { fmt: 'org' });
  assert.deepEqual(b.errors, []);
  const [shot, code] = b.cards;
  assert.deepEqual([shot.anatomy.figure.type, shot.anatomy.figure.path, shot.anatomy.figure.info], ['file', '../../shots/desk.png', 'The desk at Fit']);
  assert.deepEqual(code.anatomy.depth.map((x) => x.type), ['include', 'file']);
  assert.deepEqual(parseInclude('"a b.js" src JS :lines "10-40"'), { path: 'a b.js', kind: 'src', lang: 'js', from: 10, to: 40 });
  assert.deepEqual(parseInclude('notes.txt example :lines "5-"'), { path: 'notes.txt', kind: 'example', lang: '', from: 5, to: null });
});

test('assets: images carry their size, excerpts their lines, other files a chip', () => {
  const p = project(CARDS);
  const r = buildBoard(p.ref, { cwd: p.root });
  assert.deepEqual(r.errors, []);
  const shot = r.data.cards.shot;
  assert.match(shot.figure_html, /data-kind="image".*<img src="data:image\/png;base64,[^"]+" width="40" height="20" alt="The desk at Fit"/s);
  assert.match(shot.figure_html, /<b>Fig\. 1\.1<\/b> The desk at Fit/);
  const code = r.data.cards.code.depth_html;
  assert.match(code, /excerpt-src[^>]*>src\/app\.js</);
  assert.match(code, /<span class="ln">10<\/span>const line10 = 10;/);
  assert.match(code, /<span class="ln">39<\/span>const line39 = 39;/);
  assert.ok(!/const line40 /.test(code), 'the upper end of :lines is not included');
  assert.match(code, /<details class="excerpt-more"><summary>[^<]*18[^<]*<\/summary>/);
  assert.match(code, /class="file-chip" href="..\/..\/report.pdf"[^>]*><span class="file-ext">PDF<\/span>/);
  assert.equal(projectRoot(p.dir), p.root);
});

test('assets: the fences -- outside the project, absolute, secrets, missing (with the fix), lines out of range', () => {
  const p = project(`** Bad files
:PROPERTIES:
:CUSTOM_ID: bad
:END:
Each line is an error.

[[file:../../.env]]

[[file:/etc/hostname]]

[[file:shots/desk.png]]

[[file:../../../outside.txt]]

#+include: "../../src/app.js" :lines "100-120"
`);
  fs.writeFileSync(path.join(p.root, '..', 'outside.txt'), 'hi\n');
  const board = parseBoard(fs.readFileSync(p.file, 'utf8'), { fmt: 'org' });
  const { errors } = resolveAssets(board, p.dir);
  const by = errors.map((e) => [e.line, e.msg.replace(/^.*?(: |\] )/, '')]);
  assert.deepEqual(by.map((x) => x[0]), [11, 13, 15, 17, 19]);
  assert.match(errors[0].msg, /may hold secrets/);
  assert.match(errors[1].msg, /relative to board.org/);
  assert.match(errors[2].msg, /no such file/);
  assert.equal(errors[2].fix, 'paths are relative to board.org: [[file:../../shots/desk.png]]');
  assert.match(errors[3].msg, /outside the project/);
  assert.match(errors[4].msg, /outside the file \(60 lines\)/);
  const r = buildBoard(p.ref, { cwd: p.root });
  assert.equal(r.errors.length, 5, 'render stops on the same errors');
  assert.ok(!fs.existsSync(path.join(p.dir, 'board.html')));
});

test('assets: hidden paths in any case, secret names, a home-wide project; folders and odd names stay files', () => {
  const p = project(`** More files
:PROPERTIES:
:CUSTOM_ID: more
:END:
Each of the first five is an error.

[[file:../../.GIT/HEAD]]

[[file:../../.envrc]]

[[file:../../conf/credentials]]

- in a list

  [[file:../../.config/gh/hosts.yml]]

#+include: "../../src/app.js" :lines "5-5"

[[file:../../src/]]

[[file:../../odd/javascript:alert(1)]]
`);
  fs.mkdirSync(path.join(p.root, '.GIT'));
  fs.writeFileSync(path.join(p.root, '.GIT', 'HEAD'), 'ref: x\n');
  fs.writeFileSync(path.join(p.root, '.envrc'), 'SECRET=1\n');
  fs.mkdirSync(path.join(p.root, 'conf'));
  fs.writeFileSync(path.join(p.root, 'conf', 'credentials'), 'k=v\n');
  fs.mkdirSync(path.join(p.root, '.config', 'gh'), { recursive: true });
  fs.writeFileSync(path.join(p.root, '.config', 'gh', 'hosts.yml'), 'token: x\n');
  fs.mkdirSync(path.join(p.root, 'odd'));
  fs.writeFileSync(path.join(p.root, 'odd', 'javascript:alert(1)'), 'x\n');
  const board = parseBoard(fs.readFileSync(p.file, 'utf8'), { fmt: 'org' });
  const r = resolveAssets(board, p.dir);
  assert.deepEqual(r.errors.map((e) => e.line), [11, 13, 15, 17, 21], 'a file in a list reports the line of its list');
  for (const e of r.errors.slice(0, 4)) assert.match(e.msg, /hidden file, or one that may hold secrets/);
  assert.match(r.errors[4].msg, /is empty: as in Org, the upper end is not included/);
  const html = buildBoard(p.ref, { cwd: p.root });
  assert.equal(html.errors.length, 5);
  assert.ok(!fs.existsSync(path.join(p.dir, 'board.html')));

  // Without the errors: a folder is a chip, and a file named like a URL keeps a relative href.
  fs.writeFileSync(p.file, fs.readFileSync(p.file, 'utf8').replace(/\[\[file:\.\.\/\.\.\/(\.GIT|\.envrc|conf|\.config)[^\n]*\n/g, '').replace(/#\+include[^\n]*\n/, ''));
  const ok = buildBoard(p.ref, { cwd: p.root });
  assert.deepEqual(ok.errors, []);
  const depth = ok.data.cards.more.depth_html;
  assert.match(depth, /<span class="file-ext">Folder<\/span><span class="file-name">src<\/span><\/a>/);
  assert.match(depth, /href="\.\.\/\.\.\/odd\/javascript%3Aalert\(1\)"/);

  // A board whose project would be the home directory shows no files at all.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-home-'));
  const dir = path.join(home, '.cards', 'x');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(home, 'notes.txt'), 'hi\n');
  const hb = parseBoard('#+title: T\n\n** A card\n:PROPERTIES:\n:CUSTOM_ID: a\n:END:\nGist.\n\n[[file:../../notes.txt]]\n', { fmt: 'org' });
  const hr = resolveAssets(hb, dir, { home });
  assert.equal(hr.errors.length, 1);
  assert.match(hr.errors[0].msg, /project is your home directory/);
});

test('versions follow the files: a changed image or excerpt is a new version; an edit elsewhere is not', () => {
  const p = project(CARDS);
  const v = () => { const r = buildBoard(p.ref, { cwd: p.root }); return [r.data.cards.shot.v, r.data.cards.code.v, r.data.board.rev]; };
  assert.deepEqual(v(), [1, 1, 1]);
  assert.deepEqual(v(), [1, 1, 1], 'a render with nothing changed is not a revision');
  fs.writeFileSync(path.join(p.root, 'shots', 'desk.png'), png(40, 20, [0x11, 0x22, 0x33]));
  assert.deepEqual(v(), [2, 1, 2]);
  const js = path.join(p.root, 'src', 'app.js');
  fs.writeFileSync(js, fs.readFileSync(js, 'utf8').replace('line50 = 50', 'line50 = 5000'));
  assert.deepEqual(v(), [2, 1, 2], 'line 50 is outside the excerpt');
  fs.writeFileSync(js, fs.readFileSync(js, 'utf8').replace('line20 = 20', 'line20 = 2000'));
  assert.deepEqual(v(), [2, 2, 3]);
});

test('imageSize reads png, gif, jpeg, webp and svg headers', () => {
  assert.deepEqual(imageSize(png(7, 3), 'png'), [7, 3]);
  const gif = Buffer.from('474946383961' + '0a00' + '0500', 'hex');
  assert.deepEqual(imageSize(Buffer.concat([gif, Buffer.alloc(8)]), 'gif'), [10, 5]);
  const jpeg = Buffer.from('ffd8' + 'ffe0' + '0004' + '0000' + 'ffc0' + '0011' + '08' + '0020' + '0040' + '03', 'hex');
  assert.deepEqual(imageSize(Buffer.concat([jpeg, Buffer.alloc(16)]), 'jpg'), [64, 32]);
  const webp = Buffer.alloc(30); webp.write('RIFF', 0); webp.write('WEBP', 8); webp.write('VP8X', 12); webp.writeUIntLE(99, 24, 3); webp.writeUIntLE(49, 27, 3);
  assert.deepEqual(imageSize(webp, 'webp'), [100, 50]);
  assert.deepEqual(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">'), 'svg'), [120, 80]);
  assert.deepEqual(imageSize(Buffer.from('<svg width="30px" height="20" viewBox="0 0 120 80">'), 'svg'), [30, 20]);
  // SVG lengths in real units; a percentage leaves the size to the viewBox; one side follows the other.
  assert.deepEqual(imageSize(Buffer.from('<svg width="1in" height="25.4mm">'), 'svg'), [96, 96]);
  assert.deepEqual(imageSize(Buffer.from('<svg width="100%" height="100%" viewBox="0 0 300 150">'), 'svg'), [300, 150]);
  assert.deepEqual(imageSize(Buffer.from('<svg width="60" viewBox="0 0 120 80">'), 'svg'), [60, 40]);
  assert.equal(imageSize(Buffer.from('<svg width="10em" height="5em">'), 'svg'), null);
  // An AVIF with a thumbnail before the picture: the picture is the larger image.
  const ispe = (w, h) => { const b = Buffer.alloc(20); b.writeUInt32BE(20, 0); b.write('ispe', 4); b.writeUInt32BE(w, 12); b.writeUInt32BE(h, 16); return b; };
  assert.deepEqual(imageSize(Buffer.concat([Buffer.from('....ftypavif'), ispe(160, 90), ispe(1920, 1080), ispe(1920, 1080)]), 'avif'), [1920, 1080]);
});

test('figures are numbered in the order of the source, also inside a list; a picture in a list needs its caption too', async () => {
  const { lint } = await import('../skill/lib/lint.mjs');
  const p = project(`** The page changed in two places
:PROPERTIES:
:CUSTOM_ID: two
:END:
The header and the footer changed.

- The header, before the change:

  [[file:../../shots/desk.png]]

#+caption: The footer
[[file:../../shots/desk.png]]
`);
  const r = buildBoard(p.ref, { cwd: p.root });
  assert.deepEqual(r.errors, []);
  const card = r.data.cards.two;
  // The picture in the list comes first in the source: it is Fig. 1.1, and the one under the gist is Fig. 1.2.
  assert.match(card.depth_html, /<b>Fig\. 1\.1<\/b>/);
  assert.match(card.figure_html, /<b>Fig\. 1\.2<\/b> The footer/);
  const ws = lint(r.board).map((w) => [w.line, w.msg]);
  assert.deepEqual(ws.filter(([, m]) => /has no caption/.test(m)).length, 1, 'the picture in the list has no caption, and that is said');
  assert.equal(ws.find(([, m]) => /has no caption/.test(m))[0], 11, 'at the line of the list');
});
