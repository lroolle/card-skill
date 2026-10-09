// assets.mjs -- the files a card shows: images, excerpts of text files, and
// any other file as a labelled chip.
//
//   [[file:../../shots/desk.png]]                       an image figure
//   #+include: "../../src/x.js" src js :lines "10-40"   an excerpt, lines 10 to 39
//   [[file:../../out/report.pdf]]                       a chip: name, type, size
//
// Paths are relative to board.org, as in Org. The compiler reads each file
// once per render and puts it into the page, so board.html stays one file
// that works offline and can be sent on. Two fences keep that page safe to
// share: a file must be inside the project (the directory that holds
// .cards), and a file that may hold secrets is refused.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { esc } from './md.mjs';
import { IMAGE_EXT, extOf, isImage, frame, WIDE } from './figure.mjs';
import { syntaxOf } from './board.mjs';
import { en } from './i18n.mjs';

export const ASSET_LIMITS = { imageBytes: 1 << 20, boardBytes: 8 << 20, includeBytes: 2 << 20, excerptLines: 120, shownLines: 12 };

// Hidden files and directories hold config and secrets (.env, .envrc, .git,
// .ssh, .aws, .config): a path through one is refused, except the two that
// hold project material. Some secrets have plain names; those are named here.
const OPEN_DOT = new Set(['.cards', '.github']);
const SECRET_NAME = /^(id_(rsa|dsa|ecdsa|ed25519)|credentials(\..*)?|secrets?\..*|.*\.(pem|key|p12|pfx|jks|keystore|tfvars|tfstate))$/i;
export function secretLike(rel) {
  const parts = rel.split('/');
  const dirs = parts.slice(0, -1);
  const name = parts[parts.length - 1];
  return name.startsWith('.') || dirs.some((d) => d.startsWith('.') && !OPEN_DOT.has(d.toLowerCase())) || SECRET_NAME.test(name);
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
const posix = (p) => p.split(path.sep).join('/');

// The project of a board: the parent of the nearest ".cards" directory above
// it. A board outside any .cards directory is its own project.
export function projectRoot(boardDir) {
  let d = path.resolve(boardDir);
  while (true) {
    if (path.basename(d) === '.cards') return path.dirname(d);
    const up = path.dirname(d);
    if (up === d) return path.resolve(boardDir);
    d = up;
  }
}

// Every file block in a list of blocks, lists and quotes included. A block
// inside a list or a quote counts lines from its item, so it reports the
// line of the list or quote that holds it.
export function fileBlocks(blocks, out = [], at = null) {
  for (const b of blocks) {
    const line = at ?? b.line;
    if (b.type === 'file' || b.type === 'include') out.push({ b, line });
    else if (b.type === 'list') b.items.forEach((it) => fileBlocks(it.blocks, out, line));
    else if (b.type === 'quote') fileBlocks(b.blocks, out, line);
  }
  return out;
}

export const assetKey = (b) => (b.type === 'include' ? `include:${b.path}:${b.from ?? ''}-${b.to ?? ''}` : `file:${b.path}`);

// Pixel size from the file header, so the page reserves the space before the
// image decodes (the desk measures cards to route its lines).
export function imageSize(buf, ext) {
  try {
    if (ext === 'png' && buf.readUInt32BE(12) === 0x49484452) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    if (ext === 'gif') return [buf.readUInt16LE(6), buf.readUInt16LE(8)];
    if (ext === 'jpg' || ext === 'jpeg') {
      let o = 2;
      while (o + 9 < buf.length) {
        if (buf[o] !== 0xff) { o++; continue; }
        const m = buf[o + 1];
        if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [buf.readUInt16BE(o + 7), buf.readUInt16BE(o + 5)];
        o += 2 + buf.readUInt16BE(o + 2);
      }
    }
    if (ext === 'webp' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
      if (chunk === 'VP8L') return [1 + (((buf[22] & 0x3f) << 8) | buf[21]), 1 + (((buf[24] & 0xf) << 10) | (buf[23] << 2) | ((buf[22] & 0xc0) >> 6))];
      if (chunk === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
    }
    if (ext === 'avif') {
      // An AVIF may hold more than one image (a thumbnail, an alpha plane), each with
      // its own size box. The picture is the largest of them.
      let best = null;
      for (let k = buf.indexOf('ispe'); k > 0 && k + 16 <= buf.length; k = buf.indexOf('ispe', k + 4)) {
        const [w, h] = [buf.readUInt32BE(k + 8), buf.readUInt32BE(k + 12)];
        if (w > 0 && h > 0 && w < 65536 && h < 65536 && (!best || w * h > best[0] * best[1])) best = [w, h];
      }
      if (best) return best;
    }
    if (ext === 'svg') {
      const root = (buf.toString('utf8', 0, 4096).match(/<svg\b[^>]*>/i) || [''])[0];
      // A length in CSS pixels. A percentage or a font-relative unit has no size of its own: the viewBox decides.
      const PX = { '': 1, px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };
      const num = (name) => {
        const m = root.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*([a-z%]*)\\s*["']`, 'i'));
        return m && m[2].toLowerCase() in PX ? +m[1] * PX[m[2].toLowerCase()] : null;
      };
      const vb = root.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
      let w = num('width');
      let h = num('height');
      // One side given: the other follows the viewBox's proportion.
      if (vb && w && !h) h = w * +vb[2] / +vb[1];
      if (vb && h && !w) w = h * +vb[1] / +vb[2];
      if (vb && !w && !h) [w, h] = [+vb[1], +vb[2]];
      if (w && h) return [Math.round(w), Math.round(h)];
    }
  } catch { /* a short or odd header: no size */ }
  return null;
}

// resolveAssets(board, boardDir) -> { map, errors, warnings, files(cardId) }
// errors stop the render: a file the board names must exist and be safe to embed.
export function resolveAssets(board, boardDir, { home = os.homedir() } = {}) {
  const root = projectRoot(boardDir);
  const rootReal = fs.realpathSync(root);
  // A board under ~/.cards would make the home directory the project, and
  // every config file in it a candidate for the page.
  home = fs.realpathSync(home);
  const tooWide = rootReal === home || home.startsWith(rootReal + path.sep);
  const map = new Map();
  const errors = [];
  const warnings = [];
  const perCard = new Map();
  let total = 0;
  const sx = syntaxOf(board.fmt);
  const where = [
    ...board.cards.map((c) => ({ id: c.id, blocks: sx.blocks(c.body), line: (n) => (c.bodyLine && Number.isFinite(n) ? c.bodyLine + n : c.line) })),
    { id: null, blocks: sx.blocks(board.lede), line: () => 1 },
    ...board.sections.map((s) => ({ id: null, blocks: sx.blocks(s.note || ''), line: () => s.line })),
  ];
  for (const w of where) {
    for (const { b, line: at } of fileBlocks(w.blocks)) {
      const line = w.line(at);
      const key = assetKey(b);
      const fail = (msg, fix) => errors.push({ line, msg, fix });
      if (tooWide) {
        fail(`${b.path}: the board's project is ${rootReal === home ? 'your home directory' : 'above your home directory'}, so it shows no files`, 'keep the board in a project: <project>/.cards/<board>/board.org');
        continue;
      }
      if (!map.has(key)) {
        const a = resolveOne(b, { boardDir, root, rootReal, fail, warn: (msg) => warnings.push({ line, msg }) });
        if (!a) continue;
        map.set(key, a);
      }
      // The page carries a file once per place it shows, an image as base64.
      const a = map.get(key);
      total += a.kind === 'image' ? Math.ceil(a.size / 3) * 4 : a.kind === 'text' ? a.text.length : 0;
      if (w.id) {
        const files = perCard.get(w.id) || {};
        files[key] = map.get(key).sha;
        perCard.set(w.id, files);
      }
    }
  }
  if (total > ASSET_LIMITS.boardBytes) {
    warnings.push({ line: 1, msg: `the files on this board add ${mb(total)} to board.html; keep the page under ${mb(ASSET_LIMITS.boardBytes)}` });
  }
  return { map, errors, warnings, files: (id) => perCard.get(id) || null };
}

const mb = (n) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const sizeLabel = mb;

function resolveOne(b, { boardDir, root, rootReal, fail, warn }) {
  const written = b.path;
  const what = b.type === 'include' ? `#+include: "${written}"` : `[[file:${written}]]`;
  if (!written) return fail(`${what} names no file`, '#+include: "../../src/app.js" src js :lines "10-40"');
  if (path.isAbsolute(written) || written.startsWith('~')) {
    return fail(`${what}: use a path relative to board.org, not an absolute path`, `copy the file into the project, then name it from ${posix(path.relative(root, boardDir)) || '.'}/`);
  }
  const abs = path.resolve(boardDir, written);
  if (!fs.existsSync(abs)) {
    const fromRoot = path.resolve(root, written);
    const fix = fs.existsSync(fromRoot) && fromRoot.startsWith(root)
      ? `paths are relative to board.org: ${b.type === 'include' ? `#+include: "${posix(path.relative(boardDir, fromRoot))}"` : `[[file:${posix(path.relative(boardDir, fromRoot))}]]`}`
      : 'paths are relative to board.org; check the name';
    return fail(`${what}: no such file`, fix);
  }
  const real = fs.realpathSync(abs);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    return fail(`${what} is outside the project`, "board.html carries its files: copy the file into the project first");
  }
  const rel = posix(path.relative(rootReal, real));
  if (secretLike(rel)) {
    return fail(`${what}: refusing to put a hidden file, or one that may hold secrets, into the page`, 'quote the part you need as text, with the secrets removed');
  }
  const st = fs.statSync(real);
  const base = { path: written, rel, abs: real, name: path.basename(real), size: st.size, ext: extOf(real) };
  if (st.isDirectory() && b.type === 'file') return { ...base, kind: 'dir', size: 0, sha: 'dir' };
  if (!st.isFile()) return fail(`${what} is not a file`, 'name one file');

  if (b.type === 'include') {
    if (st.size > ASSET_LIMITS.includeBytes) return fail(`${what} is ${mb(st.size)}; an excerpt reads from a text file under ${mb(ASSET_LIMITS.includeBytes)}`, 'quote the lines that matter');
    const buf = fs.readFileSync(real);
    if (buf.includes(0)) return fail(`${what} is not a text file`, 'show an image with [[file:...]], or link the file');
    const all = buf.toString('utf8').replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
    // Org: :lines "10-40" is 10 to 39; an open end runs to the last line.
    const from = Math.max(1, b.from || 1);
    const to = b.to ? Math.min(b.to - 1, all.length) : all.length;
    if (from > all.length) {
      return fail(`${what} :lines "${b.from ?? ''}-${b.to ?? ''}" is outside the file (${all.length} lines)`, `:lines "1-${Math.min(all.length, 40) + 1}" shows lines 1 to ${Math.min(all.length, 40)}`);
    }
    if (to < from) {
      return fail(`${what} :lines "${b.from ?? ''}-${b.to ?? ''}" is empty: as in Org, the upper end is not included`, `:lines "${from}-${from + 1}" shows line ${from}`);
    }
    const text = all.slice(from - 1, to).join('\n');
    if (to - from + 1 > ASSET_LIMITS.excerptLines) warn(`${what} shows ${to - from + 1} lines; quote the part that matters with :lines (<= ${ASSET_LIMITS.excerptLines})`);
    return { ...base, kind: 'text', text, from, to, total: all.length, sha: sha(text) };
  }

  const buf = fs.readFileSync(real);
  if (isImage(real)) {
    if (st.size > ASSET_LIMITS.imageBytes) warn(`${what} is ${mb(st.size)}; save it smaller (under ${mb(ASSET_LIMITS.imageBytes)}): every image travels inside board.html`);
    const dim = imageSize(buf, base.ext);
    return { ...base, kind: 'image', mime: IMAGE_EXT[base.ext], data: buf.toString('base64'), w: dim?.[0] || null, h: dim?.[1] || null, sha: sha(buf) };
  }
  return { ...base, kind: 'file', sha: sha(buf) };
}

// ---- rendering ----

// Chrome words come from the board's table, or English when there is none.
const T = (ctx, key, vars) => (ctx.t || en)(key, vars);

// An image figure: shown at the card's width, opened full size in the page.
// The width is in CSS pixels; a screenshot at 2x shows at half its pixels
// when its name ends in @2x, as on the web.
export function imageFigure(a, caption, label, ctx = {}) {
  const scale = /@2x\.[a-z]+$/i.test(a.name) ? 2 : 1;
  const w = a.w ? Math.round(a.w / scale) : null;
  const h = a.h ? Math.round(a.h / scale) : null;
  // A screen reader says the caption's words, not its Org marks.
  const alt = (caption && (ctx.plain ? ctx.plain(caption) : caption)) || a.name;
  const size = w && h ? ` width="${w}" height="${h}"` : '';
  const img = `<img src="data:${a.mime};base64,${a.data}"${size} alt="${esc(alt)}" decoding="async">`;
  const open = esc(T(ctx, 'img_open'));
  const named = esc(T(ctx, 'img_open_named', { alt }));
  const body = `<button type="button" class="fig-zoom" aria-label="${named}" title="${open}">${img}</button>`;
  const src = `<span class="fig-file"${ctx.publish ? '' : ` title="${esc(a.rel)}"`}>${esc(a.name)}${a.w ? ` · ${a.w} × ${a.h}` : ''}</span>`;
  const html = frame('image', body, caption, label, ctx).replace('</figcaption>', ` ${src}</figcaption>`);
  return { html, width: w ? Math.min(w, 2 * WIDE) : WIDE };
}

// An excerpt: the file's lines with their numbers, the path and range on top.
// The first lines show; the rest open in place.
export function excerptHtml(a, b, ctx = {}) {
  const range = a.from === a.to ? T(ctx, 'excerpt_line', { a: a.from }) : T(ctx, 'excerpt_lines', { a: a.from, b: a.to });
  const whole = a.from === 1 && a.to === a.total;
  const cap = b.info ? ` <span class="excerpt-cap">${(ctx.inline || esc)(b.info, ctx)}</span>` : '';
  // A published page names the file, not where it lies in the project.
  const where = ctx.publish ? a.name : a.rel;
  const head = `<figcaption><span class="excerpt-src" title="${esc(where)}">${esc(where)}</span>${whole ? '' : ` <span class="excerpt-range">${esc(range)}</span>`}${cap}</figcaption>`;
  const rows = a.text.split('\n').map((l, k) => `<span class="ln">${a.from + k}</span>${esc(l)}`);
  const lang = b.lang ? ` data-lang="${esc(b.lang)}"` : '';
  const digits = String(a.to).length;
  const pre = (r) => `<pre${lang} style="--ln:${digits}ch"><code>${r.join('\n')}</code></pre>`;
  const shown = ASSET_LIMITS.shownLines;
  const body = rows.length > shown + 3
    ? pre(rows.slice(0, shown)) + `<details class="excerpt-more"><summary>${esc(T(ctx, 'excerpt_more', { n: rows.length - shown }))}</summary>${pre(rows.slice(shown))}</details>`
    : pre(rows);
  return `<figure class="excerpt">${head}${body}</figure>`;
}

// Any other file: what it is, how big, and a link that opens it from disk.
export function chipHtml(a, ctx = {}) {
  const kind = a.kind === 'dir' ? T(ctx, 'file_dir') : a.ext ? a.ext.toUpperCase() : T(ctx, 'file_kind');
  // A relative URL, each part encoded: a file named "javascript:..." stays a file.
  const href = a.path.split('/').map((p) => (p === '.' || p === '..' ? p : encodeURIComponent(p))).join('/');
  const size = a.kind === 'dir' ? '' : `<span class="file-size">${esc(mb(a.size))}</span>`;
  const inner = `<span class="file-ext">${esc(kind)}</span><span class="file-name">${esc(a.name)}</span>${size}`;
  // A published page is away from the project: `cards export` copies the file
  // beside the page and names the copy here; a folder stays a name with no link.
  if (ctx.chipHref) {
    const to = ctx.chipHref(a);
    return to ? `<p class="file"><a class="file-chip" href="${esc(to)}" target="_blank" rel="noopener noreferrer">${inner}</a></p>` : `<p class="file"><span class="file-chip">${inner}</span></p>`;
  }
  return `<p class="file"><a class="file-chip" href="${/^\.{0,2}\//.test(href) ? '' : './'}${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(a.rel)}">${inner}</a></p>`;
}

// The HTML for a file block, or a plain chip naming the path when the file
// was not resolved (a past version, a board checked without its files).
export function assetHtml(b, assets, ctx = {}) {
  const a = assets && assets.map.get(assetKey(b));
  if (!a) return `<p class="file"><span class="file-chip missing"><span class="file-name">${esc(b.path)}</span></span></p>`;
  if (b.type === 'include') return excerptHtml(a, b, ctx);
  return a.kind === 'image' ? imageFigure(a, b.info, '', ctx).html : chipHtml(a, ctx);
}
