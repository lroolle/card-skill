// org.mjs -- the Org subset a board speaks.
//
// Same contract as md.mjs: every character of agent text is escaped, and
// only the constructs below make markup. Blocks come out in the shapes
// md.mjs uses (paragraph, heading, list, quote, code, table, hr), so card
// anatomy, figures and widgets work the same on either format.
//
//   #+caption: The loop          names the next block (a figure caption)
//   #+begin_src flow ... #+end_src     code; `sketch` and `flow` are figures
//   #+begin_src tradeoffs | diff       widgets
//   #+begin_example / #+begin_quote    code / quote
//   - key :: value               a description list; at top level, the facts
//   - [X] option / - [ ] option  checkboxes: the options of an ask
//   | a | b |  |---+---|         a table; the rule ends the head
//   *bold* /em/ _underline_ +strike+ =verbatim= ~code~
//   [[#id]] [[#id][text]]        a card reference; [[https://...][text]] a link
//   [[file:shot.png]]            alone in a paragraph: a file the card shows
//   #+include: "f.js" src js :lines "10-40"   an excerpt of a project file

import { esc, link } from './md.mjs';

const HEADING_RE = /^(\*+)\s+(.*?)\s*$/;
const LIST_RE = /^(\s*)([-+]|\s\*|\d{1,9}[.)])\s+(.*)$/;
const BEGIN_RE = /^\s*#\+begin_(\w+)(?:\s+(.*?))?\s*$/i;
const KEYWORD_RE = /^\s*#\+(\w+):\s*(.*?)\s*$/;
const DRAWER_RE = /^\s*:([\w-]+):\s*$/;
const HR_RE = /^\s*-{5,}\s*$/;

const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, '    ').length;

// A src block body as the reader means it: org escapes a leading "*" or "#+"
// with a comma, and the editor indents block content; both are undone here.
function blockText(lines) {
  const body = lines.map((l) => l.replace(/^(\s*),(\*|#\+)/, '$1$2'));
  const ind = Math.min(...body.filter((l) => l.trim()).map(indentOf), Infinity);
  return body.map((l) => (Number.isFinite(ind) ? l.replace(/\t/g, '    ').slice(ind) : l)).join('\n').replace(/\s+$/, '');
}

function startsBlock(line, next) {
  return BEGIN_RE.test(line) || KEYWORD_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) ||
    LIST_RE.test(line) || /^\s*\|/.test(line) || DRAWER_RE.test(line) || /^\s*#(\s|$)/.test(line);
}

// parseOrgBlocks(src) -> [{ type, line, ... }]. `line` is 0-based within src.
export function parseOrgBlocks(src, { top = true } = {}) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let caption = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const start = i;

    let m = line.match(BEGIN_RE);
    if (m) {
      const kind = m[1].toLowerCase();
      const end = new RegExp(`^\\s*#\\+end_${m[1]}\\s*$`, 'i');
      const body = [];
      i++;
      while (i < lines.length && !end.test(lines[i])) body.push(lines[i++]);
      i++;
      if (kind === 'src' || kind === 'example') {
        const lang = kind === 'src' ? (m[2] || '').split(/\s+/)[0].toLowerCase() : '';
        blocks.push({ type: 'code', lang, info: caption, text: blockText(body), line: start });
      } else if (kind === 'quote') {
        blocks.push({ type: 'quote', blocks: parseOrgBlocks(body.join('\n'), { top: false }), line: start });
      } else {
        // Any other special block (center, verse, ...) shows its content as ordinary blocks.
        blocks.push(...parseOrgBlocks(body.join('\n'), { top: false }).map((b) => ({ ...b, line: start })));
      }
      caption = '';
      continue;
    }
    m = line.match(KEYWORD_RE);
    if (m) {
      const key = m[1].toLowerCase();
      if (key === 'caption') caption = m[2];
      if (key === 'include') {
        blocks.push({ type: 'include', ...parseInclude(m[2]), info: caption, line: start });
        caption = '';
      }
      i++;
      continue;
    }
    if (/^\s*#(\s|$)/.test(line)) { i++; continue; } // a comment line
    if (DRAWER_RE.test(line) && line.trim().toLowerCase() !== ':end:') {
      i++;
      while (i < lines.length && lines[i].trim().toLowerCase() !== ':end:') i++;
      i++;
      continue;
    }
    m = line.match(HEADING_RE);
    if (m) { blocks.push({ type: 'heading', level: m[1].length, text: m[2], line: start }); i++; continue; }
    if (HR_RE.test(line)) { blocks.push({ type: 'hr', line: start }); i++; continue; }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++].trim());
      const cells = (r) => r.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const isRule = (r) => /^\|[-+|\s]*$/.test(r) && r.includes('-');
      const isCookie = (r) => !isRule(r) && cells(r).every((c) => !c || /^<[lrc]?\d*>$/.test(c));
      const kept = rows.filter((r) => !isCookie(r));
      const rule = kept.findIndex(isRule);
      // Rows above the first rule are the head (Org allows several; the first is used).
      const head = rule > 0 ? cells(kept[0]) : [];
      const body = kept.slice(rule > 0 ? rule : 0).filter((r) => !isRule(r)).map(cells);
      blocks.push({ type: 'table', head, align: head.map(() => ''), rows: body, line: start });
      caption = '';
      continue;
    }
    if (LIST_RE.test(line)) {
      const [block, next] = parseList(lines, i);
      // A description list at the top of a card body is key-value data: the facts widget.
      if (top && !block.ordered && block.items.length && block.items.every((it) => it.term !== undefined)) {
        const text = block.items.map((it) => `${it.term}: ${it.blocks.map((b) => b.text || '').join(' ').trim()}`).join('\n');
        blocks.push({ type: 'code', lang: 'facts', info: '', text, line: start });
      } else blocks.push(block);
      i = next;
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++].trim());
    const file = fileTarget(para.join(' '));
    blocks.push(file ? { type: 'file', path: file, info: caption, line: start } : { type: 'paragraph', text: para.join(' '), line: start });
    caption = '';
  }
  return blocks;
}

// A paragraph that is one bare link to a file is the file itself, as Org shows
// an image link with no description inline. A card reference or a web link
// stays text. The path keeps Org's meaning: relative to board.org.
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
function fileTarget(text) {
  const m = text.match(/^\[\[([^\]]+)\]\]$/);
  if (!m) return null;
  const target = m[1].trim();
  if (ORG_REF.test(target) && (target.startsWith('#') || !/[./:]/.test(target))) return null;
  if (SCHEME_RE.test(target) && !/^file:/i.test(target)) return null;
  return target.replace(/^file:/i, '').replace(/::.*$/, '') || null;
}

// #+include: "path" [src lang | example | quote] [:lines "a-b"]. As in Org,
// :lines "10-40" is lines 10 to 39: the upper end is not included.
export function parseInclude(arg) {
  const m = String(arg).match(/^"([^"]*)"|^(\S+)/);
  const file = m ? (m[1] ?? m[2]) : '';
  let rest = m ? arg.slice(m[0].length) : '';
  const lines = rest.match(/:lines\s+"(\d*)-(\d*)"/i);
  rest = rest.replace(/:[\w-]+\s+("[^"]*"|\S+)/g, ' ');
  const [kind = '', lang = ''] = rest.trim().split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
  return {
    path: file.replace(/^file:/i, ''),
    kind,
    lang: kind === 'src' ? lang : '',
    from: lines && lines[1] ? +lines[1] : null,
    to: lines && lines[2] ? +lines[2] : null,
  };
}

// "- key :: value" is a description item; "- :: value" continues the row above with no key.
const kindOf = (text) => (/^\[[ xX-]\]\s/.test(text) ? 'task' : /^(.*?\S\s+)?::(\s|$)/.test(text) ? 'term' : 'plain');

function parseList(lines, i) {
  const start = i;
  const first = lines[i].match(LIST_RE);
  const base = indentOf(lines[i]);
  const ordered = /\d/.test(first[2]);
  const items = [];
  let cur = null;
  let blanks = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // Two blank lines end a list in Org; one ends it only if nothing indented follows.
      blanks++;
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const nxt = lines[j];
      const nm = nxt && nxt.match(LIST_RE);
      const continues = blanks < 2 && nxt !== undefined && (indentOf(nxt) > base || (nm && indentOf(nxt) === base && /\d/.test(nm[2]) === ordered));
      if (!continues) break;
      if (cur) cur.lines.push('');
      i++;
      continue;
    }
    blanks = 0;
    const m = line.match(LIST_RE);
    const ind = indentOf(line);
    if (m && ind === base) {
      if (/\d/.test(m[2]) !== ordered) break;
      // A change of item kind starts a new list: facts, then options, read as two lists.
      if (items.length && kindOf(m[3]) !== kindOf(items[0].lines[0])) break;
      cur = { lines: [m[3]], col: ind + m[2].trim().length + 1 };
      items.push(cur);
      i++;
      continue;
    }
    if (ind > base && cur) {
      cur.lines.push(line.replace(/\t/g, '    ').slice(Math.min(ind, cur.col)));
      i++;
      continue;
    }
    break;
  }
  const out = items.map((it) => {
    let text = it.lines[0];
    let task = null;
    const t = text.match(/^\[([ xX-])\]\s+(.*)$/);
    if (t) { task = t[1] === 'x' || t[1] === 'X'; text = t[2]; }
    let term;
    const d = text.match(/^(?:(.*?)\s+)?::(?:\s+(.*))?$/);
    if (d) { term = (d[1] || '').trim(); text = d[2] || ''; }
    const item = { task, blocks: parseOrgBlocks([text, ...it.lines.slice(1)].join('\n'), { top: false }) };
    if (term !== undefined) item.term = term;
    return item;
  });
  return [{ type: 'list', ordered, items: out, line: start }, i];
}

// ---------- inline ----------

// Org emphasis: a marker opens after a space, a dash or an opening bracket or
// quote, and closes before a space or punctuation; the text inside does not
// start or end with a space.
const PRE = `(^|[\\s\\-('"{])`;
const POST = `(?=$|[\\s\\-.,;:!?'")}\\[])`;
const mark = (ch) => new RegExp(`${PRE}${ch}([^\\s${ch === '\\*' ? '*' : ch}]|[^\\s][\\s\\S]*?[^\\s])${ch}${POST}`, 'g');
const CODE_RE = new RegExp(`${PRE}([=~])([^\\s]|[^\\s][\\s\\S]*?[^\\s])\\2${POST}`, 'g');
const EMPH = [[mark('\\*'), 'strong'], [mark('/'), 'em'], [mark('_'), 'u'], [mark('\\+'), 'del']];
const LINK_RE = /\[\[([^\]]+)\](?:\[([^\]]*)\])?\]/g;
export const ORG_REF = /^#?([a-z0-9][a-z0-9-]{0,47})$/;

// orgInline(text, { ref(id, labelHtml?) -> html }) -> html
export function orgInline(src, ctx = {}) {
  src = String(src).replace(/\u0000/g, '�');
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  const run = (s) => {
    s = s.replace(CODE_RE, (_, pre, _m, c) => pre + keep(`<code>${esc(c)}</code>`));
    s = s.replace(LINK_RE, (all, target, desc) => {
      const label = desc !== undefined ? run(desc) : null;
      const ref = target.match(ORG_REF);
      if (ref && (target.startsWith('#') || !/[./:]/.test(target))) {
        return keep(ctx.ref ? ctx.ref(ref[1], label) : `<span class="ref">${label || esc(ref[1])}</span>`);
      }
      // file:x.js::42 names a line; the browser can only open the file.
      const url = /^file:/i.test(target) || !SCHEME_RE.test(target) ? target.replace(/^file:/i, '').replace(/::.*$/, '') : target;
      return keep(link(url, label || esc(target.replace(/^file:/i, ''))));
    });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"])/g, (_, pre, u) => pre + keep(link(u, esc(u))));
    for (const [re, tag] of EMPH) s = s.replace(re, (_, pre, c) => pre + keep(`<${tag}>${run(c)}</${tag}>`));
    return esc(s);
  };
  let out = run(src);
  while (/\u0000\d+\u0000/.test(out)) out = out.replace(/\u0000(\d+)\u0000/g, (_, k) => slots[+k]);
  return out;
}

// orgPlain(text) -> the visible words, for search, lint and the digest.
export function orgPlain(src) {
  let s = String(src).replace(LINK_RE, (_, target, desc) => desc ?? target.replace(/^#/, ''));
  s = s.replace(CODE_RE, (_, pre, _m, c) => pre + c);
  for (const [re] of EMPH) s = s.replace(re, (_, pre, c) => pre + c);
  return s.replace(/\s+/g, ' ').trim();
}

// Card references in a line of text; code is inert.
export function orgRefs(text) {
  const out = [];
  const s = String(text).replace(CODE_RE, (_, pre) => pre);
  for (const m of s.matchAll(LINK_RE)) {
    const r = m[1].match(ORG_REF);
    if (r && (m[1].startsWith('#') || !/[./:]/.test(m[1]))) out.push(r[1]);
  }
  return out;
}
