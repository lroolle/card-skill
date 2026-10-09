// i18n.mjs -- the words of the page chrome, in the language of the board.
//
// One board is written in one language for one human (`#+language:`), so the
// buttons, labels and help follow the board, not the browser. The agent's
// text is never translated. Each language is one flat JSON file in
// runtime/lang/; en.json holds every key. A key that a language does not
// have falls back to English, so a partial translation still works.
//
//   strings('zh-CN') -> { lang: 'zh-Hans', strings: { send: '发送', ... } }
//   t(strings, 'round', { n: 3 }) -> 'Round 3'

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LANG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime', 'lang');

// Tags that name the same written language as a file we ship.
const ALIAS = { zh: 'zh-Hans', 'zh-cn': 'zh-Hans', 'zh-sg': 'zh-Hans', 'zh-my': 'zh-Hans' };

export function languages() {
  return fs.readdirSync(LANG_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

const read = (tag) => JSON.parse(fs.readFileSync(path.join(LANG_DIR, `${tag}.json`), 'utf8'));

// The file for a BCP 47 tag: an exact match, a known alias, then the tag with
// its last subtag removed, until nothing is left. zh-Hans-CN -> zh-Hans.
export function resolveLang(tag) {
  const have = new Map(languages().map((l) => [l.toLowerCase(), l]));
  let t = String(tag || 'en').toLowerCase();
  // Traditional Chinese is its own written language: until a zh-Hant file
  // ships, it gets English, not Simplified.
  const traditional = /^zh-(hant|tw|hk|mo)(-|$)/.test(t);
  while (t) {
    if (have.has(t)) return have.get(t);
    if (t === 'zh' && traditional) return 'en';
    if (ALIAS[t] && have.has(ALIAS[t].toLowerCase())) return ALIAS[t];
    t = t.includes('-') ? t.slice(0, t.lastIndexOf('-')) : '';
  }
  return 'en';
}

export function strings(tag) {
  const lang = resolveLang(tag);
  const en = read('en');
  return { lang, strings: lang === 'en' ? en : merge(en, read(lang)) };
}

// English fills the keys a language lacks, but English singulars must not
// leak in: if the language has "key" and no "key_one", its "key" serves n = 1.
export function merge(en, own) {
  const out = { ...en, ...own };
  for (const k of Object.keys(en)) {
    if (k.endsWith('_one') && !(k in own) && k.slice(0, -4) in own) delete out[k];
  }
  return out;
}

// en(key, vars) -> the English string, for code that renders with no board
// (tests, a figure on its own). The table is read once.
let EN = null;
export function en(key, vars) {
  EN = EN || read('en');
  return t(EN, key, vars);
}

// t(table, key, vars) -> the string with {name} filled. A key with an _one
// form uses it when vars.n is 1. A missing key shows as the key, so a gap is
// visible in the page and in the tests.
export function t(table, key, vars = {}) {
  const k = vars.n === 1 && table[`${key}_one`] !== undefined ? `${key}_one` : key;
  const s = table[k] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}
