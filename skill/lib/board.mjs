// board.mjs -- parse board.md into a board model.
//
//   ---                         frontmatter: title (required), lang
//   # Section {compare|list}    H1 starts a section
//   ## Claim {#id ask=choose}   H2 starts a card; the heading is the claim
//   First paragraph             the gist
//   Everything after            the depth
//
// Every error carries a line number and a corrected example, because the
// reader of an error is usually an agent that will retry once.

import { parseBlocks, plain, fenceOpen, fenceCloses } from './md.mjs';

export const ASKS = ['choose', 'approve', 'answer'];
export const STATUSES = ['open', 'doing', 'done', 'blocked'];
export const BASES = ['fact', 'inference', 'guess'];
export const LAYOUTS = ['grid', 'compare', 'list'];
export const CARD_KEYS = ['ask', 'status', 'basis', 'from', 'needs', 'progress'];
export const CARD_FLAGS = ['multi'];
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

const HEAD_RE = /^(#{1,2})\s+(.*?)\s*$/;
const ATTR_RE = /\s*\{([^{}]*)\}\s*$/;
const REF_RE = /\[\[([^\]\s|]+)\]\]/g;

export const slug = (s) =>
  plain(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'card';

function parseAttrs(text) {
  const out = { id: null, tags: [], kv: {}, flags: [], bad: [] };
  for (const tok of text.trim().split(/\s+/).filter(Boolean)) {
    if (tok.startsWith('#')) out.id = tok.slice(1);
    else if (tok.startsWith('.')) out.tags.push(tok.slice(1));
    else if (tok.includes('=')) {
      const k = tok.slice(0, tok.indexOf('='));
      out.kv[k] = tok.slice(tok.indexOf('=') + 1);
    } else out.flags.push(tok);
  }
  return out;
}

const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

// boardTitle(src) -> the frontmatter title, or null. One reader for every caller.
export function boardTitle(src) {
  const { meta } = frontmatter(String(src).replace(/\r\n?/g, '\n').split('\n'));
  return meta?.title || null;
}

function frontmatter(lines) {
  if (lines[0]?.trim() !== '---') return { meta: null, body: 0 };
  const meta = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return { meta, body: i + 1 };
    const m = lines[i].match(/^([\w-]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta: null, body: 0 };
}

// parseBoard(src, { id }) -> { title, lang, lede, sections, cards, errors }
export function parseBoard(src, { id = 'board' } = {}) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const errors = [];
  const err = (line, msg, fix) => errors.push({ line: line + 1, msg, fix });

  const { meta, body } = frontmatter(lines);
  if (!meta || !meta.title) {
    err(0, 'board has no title', '---\ntitle: Pick a queue for ingest\n---');
  }
  const board = {
    id,
    title: meta?.title || id,
    lang: meta?.lang || 'en',
    lede: '',
    sections: [],
    cards: [],
    errors,
  };

  // Split into heading-delimited chunks, ignoring headings inside fences.
  const chunks = [];
  let cur = { level: 0, line: body - 1, head: '', lines: [] };
  let fence = null;
  for (let i = body; i < lines.length; i++) {
    const line = lines[i];
    if (fence) { if (fenceCloses(line, fence)) fence = null; cur.lines.push(line); continue; }
    fence = fenceOpen(line);
    const h = !fence && line.match(HEAD_RE);
    if (h) {
      chunks.push(cur);
      cur = { level: h[1].length, line: i, head: h[2], lines: [] };
    } else cur.lines.push(line);
  }
  chunks.push(cur);

  let section = null;
  const ensureSection = (line) => {
    if (!section) {
      section = { id: '', title: '', note: '', layout: 'grid', line, cards: [] };
      board.sections.push(section);
    }
    return section;
  };

  for (const c of chunks) {
    const text = c.lines.join('\n').trim();
    if (c.level === 0) { board.lede = text; continue; }
    const am = c.head.match(ATTR_RE);
    const title = (am ? c.head.slice(0, am.index) : c.head).trim();
    const attrs = parseAttrs(am ? am[1] : '');
    const headLine = lines[c.line];

    if (c.level === 1) {
      const layout = attrs.flags.find((f) => LAYOUTS.includes(f)) || 'grid';
      for (const f of attrs.flags) {
        if (!LAYOUTS.includes(f)) err(c.line, `unknown section flag "${f}"`, `# ${title} {compare}   (flags: ${LAYOUTS.join(', ')})`);
      }
      for (const k of Object.keys(attrs.kv)) err(c.line, `sections take no "${k}="`, `# ${title} {list}`);
      section = { id: attrs.id || slug(title), title, note: text, layout, line: c.line + 1, cards: [] };
      board.sections.push(section);
      continue;
    }

    // ---- a card ----
    const s = ensureSection(c.line + 1);
    if (!title) err(c.line, 'card has an empty claim', '## NATS covers the peak with one binary {#nats}');
    if (!attrs.id) {
      err(c.line, 'card has no id', `${headLine.replace(ATTR_RE, '').trimEnd()} {#${slug(title)}${am ? ' ' + am[1].trim() : ''}}`);
    } else if (!ID_RE.test(attrs.id)) {
      err(c.line, `id "${attrs.id}" must be lowercase letters, digits and dashes`, `## ${title} {#${slug(attrs.id)}}`);
    }
    for (const k of Object.keys(attrs.kv)) {
      if (!CARD_KEYS.includes(k)) err(c.line, `unknown key "${k}="`, `allowed: ${CARD_KEYS.join(', ')}, #id, .tag, multi`);
    }
    for (const f of attrs.flags) {
      if (!CARD_FLAGS.includes(f)) err(c.line, `unknown flag "${f}"`, `allowed flags: ${CARD_FLAGS.join(', ')} (did you mean ask=${f}?)`);
    }
    const kv = attrs.kv;
    const enumCheck = (key, allowed) => {
      if (kv[key] !== undefined && !allowed.includes(kv[key])) {
        err(c.line, `${key}=${kv[key]} is not one of ${allowed.join(', ')}`, `## ${title} {#${attrs.id || slug(title)} ${key}=${allowed[0]}}`);
      }
    };
    enumCheck('ask', ASKS);
    enumCheck('status', STATUSES);
    enumCheck('basis', BASES);
    let progress = null;
    if (kv.progress !== undefined) {
      const pm = kv.progress.match(/^(\d+)\/(\d+)$/);
      if (!pm || +pm[2] === 0 || +pm[1] > +pm[2]) err(c.line, `progress=${kv.progress} must be done/total`, 'progress=3/7');
      else progress = { done: +pm[1], total: +pm[2] };
    }
    const multi = attrs.flags.includes('multi');
    if (multi && kv.ask !== 'choose') err(c.line, 'multi only applies to ask=choose', `## ${title} {#${attrs.id || slug(title)} ask=choose multi}`);
    for (const t of attrs.tags) {
      if (!ID_RE.test(t)) err(c.line, `tag ".${t}" must be lowercase letters, digits and dashes`, '.perf .security');
    }

    const card = {
      id: attrs.id || slug(title),
      title,
      line: c.line + 1,
      section: s.id,
      ask: kv.ask || null,
      status: kv.status || 'open',
      basis: kv.basis || null,
      from: list(kv.from),
      needs: list(kv.needs),
      tags: attrs.tags,
      multi,
      progress,
      body: text,
      src: [headLine, ...c.lines].join('\n').trim(),
    };
    card.anatomy = anatomy(card);
    if (card.ask === 'choose') {
      const opts = card.anatomy.options;
      const ex = `## ${title} {#${card.id} ask=choose}\n- [x] The option you recommend\n- [ ] Another option`;
      if (opts.length < 2) err(c.line, 'ask=choose needs at least two options written as a task list', ex);
      if (!multi && opts.filter((o) => o.default).length > 1) err(c.line, 'single choice has more than one [x]; add multi or keep one', ex);
    }
    board.cards.push(card);
    s.cards.push(card.id);
  }

  // ---- cross-card checks ----
  const ids = new Set();
  for (const card of board.cards) {
    if (ids.has(card.id)) err(card.line - 1, `duplicate id "${card.id}"`, `## ${card.title} {#${card.id}-2}`);
    ids.add(card.id);
  }
  const secIds = new Set();
  for (const s of board.sections) {
    if (s.id && secIds.has(s.id)) err(s.line - 1, `duplicate section "${s.title}"`, `# ${s.title} {#${s.id}-2}`);
    secIds.add(s.id);
  }
  for (const card of board.cards) {
    for (const key of ['from', 'needs']) {
      for (const ref of card[key]) {
        if (!ids.has(ref)) err(card.line - 1, `${key}=${ref} names no card`, `known ids: ${[...ids].slice(0, 12).join(', ')}`);
        if (ref === card.id) err(card.line - 1, `card lists itself in ${key}=`, `remove ${card.id} from ${key}=`);
      }
    }
    for (const ref of card.anatomy.refs) {
      if (!ids.has(ref)) err(card.line - 1, `[[${ref}]] names no card`, `known ids: ${[...ids].slice(0, 12).join(', ')}`);
    }
  }
  for (const ref of refsIn(parseBlocks(board.lede))) {
    if (!ids.has(ref)) err(0, `[[${ref}]] in the lede names no card`, `known ids: ${[...ids].slice(0, 12).join(', ')}`);
  }
  errors.sort((a, b) => a.line - b.line);
  return board;
}

// anatomy(card) -> { gist, facts, options, depth, refs }
//   gist     first block, when it is a paragraph
//   facts    the first ```facts block (shown with the gist; aligned in compare rows)
//   options  task-list items of a choose card
//   depth    every other block, in order
export function anatomy(card) {
  const blocks = parseBlocks(card.body);
  const out = { gist: null, facts: null, options: [], depth: [], refs: [] };
  let rest = blocks;
  if (rest[0]?.type === 'paragraph') { out.gist = rest[0]; rest = rest.slice(1); }
  for (const b of rest) {
    if (!out.facts && b.type === 'code' && b.lang === 'facts') { out.facts = b; continue; }
    if (card.ask === 'choose' && !out.options.length && b.type === 'list' && b.items.length && b.items.every((it) => it.task !== null)) {
      out.options = b.items.map((it) => {
        const text = it.blocks[0]?.type === 'paragraph' ? it.blocks[0].text : '';
        const rm = text.match(/^\[\[([^\]\s|]+)\]\]\s*(.*)$/);
        return { value: rm ? rm[1] : plain(text), ref: rm ? rm[1] : null, text: rm ? rm[2] : text, default: it.task };
      });
      continue;
    }
    out.depth.push(b);
  }
  out.refs = [...new Set(refsIn(blocks))];
  return out;
}

function refsIn(blocks) {
  const found = [];
  // Code spans are inert: `[[id]]` inside backticks is text, as it is when rendered.
  const scan = (s) => { for (const m of String(s).replace(/(`+)[\s\S]*?\1/g, '').matchAll(REF_RE)) found.push(m[1]); };
  const walk = (bs) => {
    for (const b of bs) {
      if (b.type === 'paragraph' || b.type === 'heading') scan(b.text);
      else if (b.type === 'list') b.items.forEach((it) => walk(it.blocks));
      else if (b.type === 'quote') walk(b.blocks);
      else if (b.type === 'table') [...b.head, ...b.rows.flat()].forEach(scan);
      else if (b.type === 'code' && (b.lang === 'facts' || b.lang === 'tradeoffs')) scan(b.text);
    }
  };
  walk(blocks);
  return found;
}

export function formatErrors(errors, file = 'board.md') {
  return errors.map((e) => `${file}:${e.line}  ${e.msg}\n  fix: ${String(e.fix).split('\n').join('\n       ')}`).join('\n');
}
