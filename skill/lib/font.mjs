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

export const FAMILY = 'Cards CJK';
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

// How to run fonttools here: on the PATH, through uv, or as a Python module.
let SUBSETTER;
function subsetter() {
  if (SUBSETTER !== undefined) return SUBSETTER;
  const ok = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore', timeout: 120000 }).status === 0;
  if (ok('pyftsubset', ['--help'])) SUBSETTER = ['pyftsubset'];
  else if (ok('uvx', ['--quiet', '--from', 'fonttools[woff]', 'pyftsubset', '--help'])) SUBSETTER = ['uvx', '--quiet', '--from', 'fonttools[woff]', 'pyftsubset'];
  else if (ok('python3', ['-c', 'import fontTools.subset'])) SUBSETTER = ['python3', '-m', 'fontTools.subset'];
  else SUBSETTER = null;
  return SUBSETTER;
}

// One subset: this font, these characters. Kept in the temp directory under a
// name made from both, so the same board renders at once the second time.
function subset(font, script, chars, tool) {
  const st = fs.statSync(font);
  // Name records 0, 13 and 14 are the font's copyright and its license: the Open
  // Font License asks that they travel with the font, and here they do, inside it.
  const options = ['--no-hinting', '--desubroutinize', '--layout-features=locl,kern,liga', '--name-IDs=0,1,2,13,14', '--notdef-outline', '--drop-tables+=DSIG'];
  const key = crypto.createHash('sha256').update([font, st.size, st.mtimeMs, script, chars.join(''), options.join(' ')].join('|')).digest('hex').slice(0, 24);
  const dir = path.join(os.tmpdir(), 'cards-fonts');
  fs.mkdirSync(dir, { recursive: true });
  for (const flavor of ['woff2', 'woff']) {
    const out = path.join(dir, `${key}.${flavor}`);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return { file: out, flavor };
  }
  const list = path.join(dir, `${key}.txt`);
  fs.writeFileSync(list, chars.join(''));
  const base = [font, `--text-file=${list}`, ...options];
  if (/\.ttc$/i.test(font)) base.push(`--font-number=${SCRIPTS[script]}`);
  // woff2 needs brotli; without it, woff (zlib) still works and is a third larger.
  for (const flavor of ['woff2', 'woff']) {
    const out = path.join(dir, `${key}.${flavor}`);
    try {
      execFileSync(tool[0], [...tool.slice(1), ...base, `--flavor=${flavor}`, `--output-file=${out}`], { stdio: 'ignore', timeout: 180000 });
      if (fs.existsSync(out) && fs.statSync(out).size > 0) return { file: out, flavor };
    } catch { /* try the next flavor */ }
  }
  return null;
}

export function boardFont(lang, text, { env = process.env } = {}) {
  const script = scriptOf(lang);
  if (!script) return { css: '', state: 'none', why: '' };
  if (env.CARDS_CJK_FONT === 'none') return { css: '', state: 'system', why: 'CARDS_CJK_FONT=none' };
  const chars = cjkChars(text);
  if (!chars.length) return { css: '', state: 'none', why: '' };
  const regular = findFont(script, 'Regular', env);
  if (!regular) return { css: '', state: 'system', why: 'no open CJK font on this machine (Noto Sans CJK or Source Han Sans)' };
  const tool = subsetter();
  if (!tool) return { css: '', state: 'system', why: 'fonttools is not installed (pyftsubset)' };
  const faces = [[regular, '400']];
  const bold = findFont(script, 'Bold', env);
  if (bold) faces.push([bold, '600 700']);
  const rules = [];
  let bytes = 0;
  for (const [file, weight] of faces) {
    const s = subset(file, script, chars, tool);
    if (!s) return { css: '', state: 'system', why: `fonttools could not subset ${path.basename(file)}` };
    const data = fs.readFileSync(s.file);
    bytes += data.length;
    rules.push(`@font-face{font-family:"${FAMILY}";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/${s.flavor};base64,${data.toString('base64')}) format("${s.flavor}");unicode-range:${RANGE}}`);
  }
  return { css: rules.join('\n'), state: 'embedded', why: `${chars.length} characters of ${path.basename(regular).replace(/-Regular.*$/, '')}, ${Math.round(bytes / 1024)} KB`, bytes, chars: chars.length };
}
