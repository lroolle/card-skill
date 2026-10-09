// md.mjs -- the markdown subset a card body speaks.
//
// Raw HTML never passes through: every character of agent-written text is
// escaped, and only the constructs below produce markup. Fenced blocks with
// a known info string become widgets (facts, tradeoffs, diff). Figures
// (sketch, flow) are rendered by the caller through ctx.figure; see figure.mjs.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
const QUOTE_RE = /^\s*>/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

// One fence rule for the whole system (CommonMark): up to three spaces, three
// or more backticks or tildes; a backtick fence's info string has no backtick,
// so "```x``` is the syntax" is a paragraph, not a fence.
export function fenceOpen(line) {
  const m = String(line).match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m || (m[1][0] === '`' && m[2].includes('`'))) return null;
  const info = m[2].trim();
  const sp = info.search(/\s/);
  return { marker: m[1], lang: (sp < 0 ? info : info.slice(0, sp)).toLowerCase(), info: sp < 0 ? '' : info.slice(sp + 1).trim() };
}
export function fenceCloses(line, open) {
  const m = String(line).match(/^ {0,3}(`{3,}|~{3,})\s*$/);
  return !!m && m[1][0] === open.marker[0] && m[1].length >= open.marker.length;
}

const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, '    ').length;
const isOrdered = (marker) => /\d/.test(marker);

function startsBlock(line, next) {
  return !!fenceOpen(line) || HEADING_RE.test(line) || HR_RE.test(line) ||
    LIST_RE.test(line) || QUOTE_RE.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_SEP_RE.test(next));
}

// parseBlocks(src) -> [{ type, line, ... }]. `line` is 0-based within src.
export function parseBlocks(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const start = i;

    const fence = fenceOpen(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !fenceCloses(lines[i], fence)) body.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', lang: fence.lang, info: fence.info, text: body.join('\n'), line: start });
      continue;
    }
    let m = line.match(HEADING_RE);
    if (m) {
      blocks.push({ type: 'heading', level: m[1].length, text: m[2], line: start });
      i++;
      continue;
    }
    if (HR_RE.test(line)) { blocks.push({ type: 'hr', line: start }); i++; continue; }
    if (QUOTE_RE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', blocks: parseBlocks(body.join('\n')), line: start });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const rows = [];
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '');
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      blocks.push({ type: 'table', head, align, rows, line: start });
      continue;
    }
    if (LIST_RE.test(line)) {
      const [block, next] = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++].trim());
    blocks.push({ type: 'paragraph', text: para.join(' '), line: start });
  }
  return blocks;
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function parseList(lines, i) {
  const start = i;
  const first = lines[i].match(LIST_RE);
  const base = indentOf(lines[i]);
  const ordered = isOrdered(first[2]);
  const items = [];
  let cur = null;
  let col = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const nxt = lines[j];
      const nm = nxt && nxt.match(LIST_RE);
      const continues = nxt !== undefined && (indentOf(nxt) > base ||
        (nm && indentOf(nxt) === base && isOrdered(nm[2]) === ordered));
      if (!continues) break;
      if (cur) cur.lines.push('');
      i++;
      continue;
    }
    const m = line.match(LIST_RE);
    const ind = indentOf(line);
    if (m && ind === base) {
      if (isOrdered(m[2]) !== ordered) break;
      col = ind + m[2].length + m[3].length;
      cur = { lines: [m[4]] };
      items.push(cur);
      i++;
      continue;
    }
    if (ind > base && cur) {
      cur.lines.push(line.replace(/\t/g, '    ').slice(Math.min(ind, col)));
      i++;
      continue;
    }
    if (cur && !m && !startsBlock(line, lines[i + 1]) && cur.lines[cur.lines.length - 1] !== '') {
      cur.lines[cur.lines.length - 1] += ' ' + line.trim(); // lazy paragraph continuation
      i++;
      continue;
    }
    break;
  }
  const out = items.map((it) => {
    let text = it.lines[0];
    let task = null;
    const t = text.match(/^\[([ xX])\]\s+(.*)$/);
    if (t) { task = t[1] !== ' '; text = t[2]; }
    return { task, blocks: parseBlocks([text, ...it.lines.slice(1)].join('\n')) };
  });
  return [{ type: 'list', ordered, items: out, line: start }, i];
}

// ---- inline ----

const SAFE_URL = /^(https?:\/\/|mailto:|#|\.{0,2}\/|[^:/?#]+(?:[/?#]|$))/i;

export function link(url, html) {
  if (!SAFE_URL.test(url) || /^\s*(javascript|data|vbscript):/i.test(url)) return html;
  // "//host/x" and anything with a backslash name another machine, not a page of this work.
  if (/^\s*\/\/|\\/.test(url)) return html;
  // A link to another site opens beside the board. A relative link is another
  // page of the same work (a sibling board): it opens in place, like any page.
  if (!/^(https?:)?\/\/|^mailto:/i.test(url)) return `<a href="${esc(url)}">${html}</a>`;
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
}

function emphasis(s) {
  return s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=[^\s_])([^_]*?[^\s_])_(?![_\w])/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
}

// inline(text, { ref(id) -> html }) -> html
export function inline(src, ctx = {}) {
  // NUL marks a placeholder below; author text must never be able to name one.
  src = String(src).replace(/\u0000/g, '\uFFFD');
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  const run = (s) => {
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _f, c) => keep(`<code>${esc(c.trim())}</code>`));
    s = s.replace(/\[\[([^\]\s|]+)\]\]/g, (_, id) =>
      keep(ctx.ref ? ctx.ref(id) : `<span class="ref">${esc(id)}</span>`));
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, url) => keep(link(url, run(t))));
    s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, u) => keep(link(u, esc(u))));
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"])/g, (_, pre, u) => pre + keep(link(u, esc(u))));
    return emphasis(esc(s));
  };
  let out = run(String(src));
  while (/\u0000\d+\u0000/.test(out)) out = out.replace(/\u0000(\d+)\u0000/g, (_, k) => slots[+k]);
  return out;
}

// plain(text) -> the visible words, for search and for the digest.
export function plain(src) {
  return String(src)
    .replace(/\[\[([^\]\s|]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- widgets ----

export function parseFacts(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const k = l.indexOf(':');
    // "key: value"; ": value" (or a line with no colon) continues the row above with no key.
    return k > 0 ? [l.slice(0, k).trim(), l.slice(k + 1).trim()] : ['', k === 0 ? l.slice(1).trim() : l];
  });
}

// Blocks are shared by both source formats; inline text goes through the
// format's own renderer, ctx.inline (org.mjs), or the markdown one here.
const inl = (src, ctx) => (ctx.inline || inline)(src, ctx);

function factsHtml(text, ctx) {
  const rows = parseFacts(text)
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${inl(v, ctx)}</dd>`)
    .join('');
  return `<dl class="facts">${rows}</dl>`;
}

function tradeoffsHtml(text, ctx) {
  const items = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const kind = l[0] === '+' ? 'pro' : l[0] === '-' ? 'con' : 'note';
    const body = kind === 'note' ? l : l.slice(1).trim();
    const sign = kind === 'pro' ? '+' : kind === 'con' ? '−' : '';
    const said = ctx.t ? ctx.t(`tradeoff_${kind}`) : kind;
    return `<li class="${kind}"><span class="sign" aria-label="${esc(said)}">${sign}</span>${inl(body, ctx)}</li>`;
  });
  return `<ul class="tradeoffs">${items.join('')}</ul>`;
}

function diffHtml(text) {
  const rows = text.split('\n').map((l) => {
    const kind = l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : '';
    return `<span class="${kind}">${esc(l) || ' '}</span>`;
  });
  return `<pre class="diff"><code>${rows.join('\n')}</code></pre>`;
}

export const WIDGETS = { facts: factsHtml, tradeoffs: tradeoffsHtml, diff: diffHtml };

// ---- block rendering ----

export function renderBlocks(blocks, ctx = {}) {
  return blocks.map((b) => renderBlock(b, ctx)).join('');
}

function renderBlock(b, ctx) {
  switch (b.type) {
    case 'paragraph': return `<p>${inl(b.text, ctx)}</p>`;
    case 'heading': return `<h4>${inl(b.text, ctx)}</h4>`;
    case 'hr': return '<hr>';
    case 'quote': return `<blockquote>${renderBlocks(b.blocks, ctx)}</blockquote>`;
    case 'code': {
      const fig = ctx.figure && ctx.figure(b);
      if (fig) return fig;
      const w = WIDGETS[b.lang];
      if (w) return w(b.text, ctx);
      const lang = b.lang ? ` data-lang="${esc(b.lang)}"` : '';
      return `<pre${lang}><code>${esc(b.text)}</code></pre>`;
    }
    case 'file':
    case 'include': {
      const fig = b.type === 'file' && ctx.figure && ctx.figure(b);
      if (fig) return fig;
      return ctx.asset ? ctx.asset(b) : `<p class="file"><span class="file-chip missing"><span class="file-name">${esc(b.path)}</span></span></p>`;
    }
    case 'table': {
      const cell = (tag, c, k) => {
        const a = b.align[k] ? ` style="text-align:${b.align[k]}"` : '';
        return `<${tag}${a}>${inl(c, ctx)}</${tag}>`;
      };
      const head = b.head.length ? `<thead><tr>${b.head.map((c, k) => cell('th', c, k)).join('')}</tr></thead>` : '';
      const rows = b.rows.map((r) => `<tr>${r.map((c, k) => cell('td', c, k)).join('')}</tr>`).join('');
      return `<div class="table"><table>${head}<tbody>${rows}</tbody></table></div>`;
    }
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const items = b.items.map((it) => {
        const tight = it.blocks.length === 1 && it.blocks[0].type === 'paragraph';
        let body = tight ? inl(it.blocks[0].text, ctx) : renderBlocks(it.blocks, ctx);
        if (it.term) body = `<b>${inl(it.term, ctx)}</b> ${body}`;
        if (it.task === null) return `<li>${body}</li>`;
        const said = ctx.t ? ctx.t(it.task ? 'task_done' : 'task_open') : it.task ? 'done' : 'not done';
        const box = `<span class="box" aria-label="${esc(said)}">${it.task ? '✓' : ''}</span>`;
        return `<li class="task${it.task ? ' checked' : ''}">${box}<span>${body}</span></li>`;
      });
      return `<${tag}>${items.join('')}</${tag}>`;
    }
    default: return '';
  }
}

export function renderMarkdown(src, ctx = {}) {
  return renderBlocks(parseBlocks(src), ctx);
}
