// font.mjs -- a Chinese, Japanese or Korean board carries its own font.
//
// Han text looks different on every machine: each system falls back to its
// own face, and a machine with none shows boxes. So when a board's language
// is CJK, the page gets a subset of an open font: only the characters this
// board uses, in two weights, inside the one HTML file.
//
// Two things are needed that the skill does not ship, because one is 20 MB
// and the other is not Node: an open CJK font on this machine (Noto Sans
// CJK or Source Han Sans, both under the SIL Open Font License, which allows
// a subset to travel in a page), and fonttools (`pyftsubset`). Without
// either, the page uses the reader's system font and `cards render` says so
// once. A system font such as PingFang or YaHei is never put into a page:
// its license does not allow it.
//
//   boardFont(lang, text) -> { css, state, why }
//     state: 'embedded' | 'system' | 'none' (the board is not CJK)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

// The face keeps its own name in the page ("Noto Sans CJK SC"), so anyone who
// looks can tell what it is. A font named by CARDS_CJK_FONT has no name we
// can read here; it goes by this one.
export const FAMILY = 'Cards CJK';
const SCRIPT_NAME = { JP: 'JP', KR: 'KR', SC: 'SC', TC: 'TC', HK: 'HK' };
export function familyOf(file, script) {
  const base = path.basename(file);
  if (/^NotoSansCJK/i.test(base)) return `Noto Sans CJK ${SCRIPT_NAME[script]}`;
  if (/^NotoSans(SC|TC|HK|JP|KR)/i.test(base)) return `Noto Sans ${SCRIPT_NAME[script]}`;
  if (/^SourceHanSans/i.test(base)) return `Source Han Sans ${SCRIPT_NAME[script]}`;
  return FAMILY;
}
// The face of a pan-CJK collection for each language, and the suffix of the
// single-language files (NotoSansSC-Regular.otf).
const SCRIPTS = { JP: 0, KR: 1, SC: 2, TC: 3, HK: 4 };
export function scriptOf(lang) {
  const t = String(lang || '').toLowerCase();
  if (/^ja\b/.test(t)) return 'JP';
  if (/^ko\b/.test(t)) return 'KR';
  if (/^zh-(hk|mo)\b/.test(t)) return 'HK';
  if (/^zh-(hant|tw)\b/.test(t)) return 'TC';
  if (/^zh\b/.test(t)) return 'SC';
  return null;
}

// What the font is for: Han, kana, hangul, and the punctuation and
// full-width forms that are set with them. Latin stays with the system font.
const CJK_RE = /[⺀-⿟　-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/g;
const RANGE = 'U+2E80-2FDF, U+3000-30FF, U+3400-4DBF, U+4E00-9FFF, U+AC00-D7AF, U+F900-FAFF, U+FF00-FFEF';
export const cjkChars = (text) => [...new Set(String(text).match(CJK_RE) || [])].sort();

// Where an open CJK font usually lies. CARDS_CJK_FONT names one directly
// (and CARDS_CJK_FONT_BOLD its bold); CARDS_CJK_FONT=none turns this off.
const DIRS = () => [
  '/usr/share/fonts/opentype/noto', '/usr/share/fonts/noto-cjk', '/usr/share/fonts/google-noto-cjk', '/usr/share/fonts/truetype/noto',
  '/usr/share/fonts/opentype/source-han-sans', '/usr/share/fonts/adobe-source-han-sans',
  path.join(os.homedir(), 'Library', 'Fonts'), '/Library/Fonts',
  path.join(os.homedir(), '.local', 'share', 'fonts'), path.join(os.homedir(), '.fonts'),
];
const names = (script, weight) => [
  `NotoSansCJK-${weight}.ttc`, `NotoSansCJK${script.toLowerCase()}-${weight}.otf`, `NotoSans${script}-${weight}.otf`, `NotoSans${script}-${weight}.ttf`,
  `SourceHanSans-${weight}.ttc`, `SourceHanSans${script}-${weight}.otf`, `SourceHanSans${script === 'JP' ? '' : script}-${weight}.otf`,
];
function findFont(script, weight, env) {
  const named = weight === 'Bold' ? env.CARDS_CJK_FONT_BOLD : env.CARDS_CJK_FONT;
  if (named) return fs.existsSync(named) ? named : null;
  for (const dir of DIRS()) for (const n of names(script, weight)) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// The cache: one directory per user under the temp directory, closed to everyone
// else. If it is not that (another owner, a link, a file), there is no cache
// and no font: boardFont() says why and the page keeps the system font.
function cacheDir() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const dir = path.join(os.tmpdir(), `cards-fonts-${uid ?? 'u'}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || (uid !== null && (st.uid !== uid || (st.mode & 0o022)))) throw new Error(`${dir} is not a directory of this user alone`);
  fs.accessSync(dir, fs.constants.W_OK);
  return dir;
}

// How to run fonttools here: on the PATH, as a Python module, or through uv.
// uv is asked without the network first. It may fetch fonttools once; where
// that fails, a mark in the cache keeps the next renders from waiting for the
// network again, for a day.
const DAY = 24 * 60 * 60 * 1000;
let SUBSETTER;
function subsetter(dir) {
  if (SUBSETTER !== undefined) return SUBSETTER;
  const ok = (cmd, args, timeout = 20000) => spawnSync(cmd, args, { stdio: 'ignore', timeout }).status === 0;
  const uvx = ['uvx', '--quiet', '--from', 'fonttools[woff]', 'pyftsubset'];
  const offline = ['uvx', '--offline', ...uvx.slice(1)];
  const mark = path.join(dir, 'no-fonttools');
  const tried = () => { try { return Date.now() - fs.statSync(mark).mtimeMs < DAY; } catch { return false; } };
  if (ok('pyftsubset', ['--help'])) SUBSETTER = ['pyftsubset'];
  else if (ok('python3', ['-c', 'import fontTools.subset'])) SUBSETTER = ['python3', '-m', 'fontTools.subset'];
  else if (ok(offline[0], [...offline.slice(1), '--help'])) SUBSETTER = offline;
  else if (tried()) SUBSETTER = null; // the mark is left as it is, so that it runs out a day after the attempt
  else if (ok(uvx[0], [...uvx.slice(1), '--help'], 120000)) SUBSETTER = offline;
  else {
    SUBSETTER = null;
    try { fs.writeFileSync(mark, ''); } catch { /* no mark: the next render asks again */ }
  }
  return SUBSETTER;
}

// A file of the cache is used only when it is the font it is named as.
const MAGIC = { woff2: 'wOF2', woff: 'wOFF' };
function isFont(file, flavor) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(4);
      return fs.readSync(fd, head, 0, 4, 0) === 4 && head.toString('latin1') === MAGIC[flavor] && fs.fstatSync(fd).size > 64;
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

// One subset: this font, these characters. Kept in the cache under a name made
// from both, so the same board renders at once the second time. A subset is
// written under another name and renamed when it is whole.
function subset(font, script, chars, tool, dir) {
  const st = fs.statSync(font);
  // Name records 0, 13 and 14 are the font's copyright and its license: the Open
  // Font License asks that they travel with the font, and here they do, inside it.
  const options = ['--no-hinting', '--desubroutinize', '--layout-features=locl,kern,liga', '--name-IDs=0,1,2,13,14', '--notdef-outline', '--drop-tables+=DSIG'];
  const key = crypto.createHash('sha256').update([font, st.size, st.mtimeMs, script, chars.join(''), options.join(' ')].join('|')).digest('hex').slice(0, 24);
  for (const flavor of ['woff2', 'woff']) {
    const out = path.join(dir, `${key}.${flavor}`);
    if (isFont(out, flavor)) return { file: out, flavor };
  }
  const list = path.join(dir, `${key}.${process.pid}.txt`);
  fs.writeFileSync(list, chars.join(''));
  const base = [font, `--text-file=${list}`, ...options];
  if (/\.ttc$/i.test(font)) base.push(`--font-number=${SCRIPTS[script]}`);
  try {
    // woff2 needs brotli; without it, woff (zlib) still works and is a third larger.
    for (const flavor of ['woff2', 'woff']) {
      const out = path.join(dir, `${key}.${flavor}`);
      const part = path.join(dir, `${key}.${process.pid}.${flavor}.part`);
      try {
        execFileSync(tool[0], [...tool.slice(1), ...base, `--flavor=${flavor}`, `--output-file=${part}`], { stdio: 'ignore', timeout: 180000 });
        if (isFont(part, flavor)) { fs.renameSync(part, out); return { file: out, flavor }; }
      } catch { /* try the next flavor */ } finally { fs.rmSync(part, { force: true }); }
    }
    return null;
  } finally { fs.rmSync(list, { force: true }); }
}

export function boardFont(lang, text, { env = process.env } = {}) {
  const script = scriptOf(lang);
  if (!script) return { css: '', state: 'none', why: '' };
  if (env.CARDS_CJK_FONT === 'none') return { css: '', state: 'system', why: 'CARDS_CJK_FONT=none' };
  const chars = cjkChars(text);
  if (!chars.length) return { css: '', state: 'none', why: '' };
  const regular = findFont(script, 'Regular', env);
  if (!regular) return { css: '', state: 'system', why: 'no open CJK font on this machine (Noto Sans CJK or Source Han Sans)' };
  // From here on nothing may stop a render: a cache that cannot be used, or a
  // tool that fails, leaves the page with the system font and a reason.
  try {
    const dir = cacheDir();
    const tool = subsetter(dir);
    if (!tool) return { css: '', state: 'system', why: 'fonttools is not installed (pyftsubset)' };
    const faces = [[regular, '400']];
    const bold = findFont(script, 'Bold', env);
    if (bold) faces.push([bold, '600 700']);
    const family = familyOf(regular, script);
    // board.css puts var(--cjk) first in its font stacks; here it gets its face.
    const rules = [`:root{--cjk:"${family}"}`];
    let bytes = 0;
    for (const [file, weight] of faces) {
      const s = subset(file, script, chars, tool, dir);
      if (!s) return { css: '', state: 'system', why: `fonttools could not subset ${path.basename(file)}` };
      const data = fs.readFileSync(s.file);
      bytes += data.length;
      rules.push(`@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/${s.flavor};base64,${data.toString('base64')}) format("${s.flavor}");unicode-range:${RANGE}}`);
    }
    return { css: rules.join('\n'), state: 'embedded', family, why: `${chars.length} characters of ${family}, ${Math.round(bytes / 1024)} KB`, bytes, chars: chars.length };
  } catch (e) {
    return { css: '', state: 'system', why: `the font cache cannot be used (${e.message})` };
  }
}
