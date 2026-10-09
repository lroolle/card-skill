// ingest.mjs -- a pasted reply, read back into the log.
//
// Where the page cannot reach `cards serve` (a container, a published copy),
// Send copies the reply as text and the human pastes it into the chat. That
// text is the digest of runtime/digest.js. `cards ingest` parses it and
// records the round, so the board, `cards show` and the next render know the
// asks are answered, with no hand edit.
//
//   parseReply(text)            -> { id, title, path, rev, key, at, lines: [{ who, kind, what }] }
//   replyItems(reply, board, st) -> items, as the server would have stored them

import { ASKS } from './board.mjs';

const KINDS = [...ASKS, 'mark', 'reply', 'note', 'order'];
const LINE_RE = new RegExp(`^\\s*(?:#(\\d+)\\s+)?(\\S+)\\s+(${KINDS.join('|')})\\s+(.*?)\\s*$`);
const JSON_STR = /^"(?:[^"\\]|\\.)*"/;

export function parseReply(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => /^\s*cards: reply from the board /.test(l));
  if (at < 0) throw new Error('no reply in the text: it starts with the line `cards: reply from the board "..."`');
  const first = lines[at].trim().match(/^cards: reply from the board ("(?:[^"\\]|\\.)*"|".*")(?:\s+\(([a-z0-9][a-z0-9-]*)\))?$/);
  const reply = { id: first?.[2] || null, title: first ? unquote(first[1]) : '', path: null, rev: 0, key: null, at: null, lines: [] };
  for (const part of (lines[at + 1] || '').split(' · ').map((p) => p.trim())) {
    let m;
    if ((m = part.match(/^rev (\d+)$/))) reply.rev = +m[1];
    else if ((m = part.match(/^reply ([0-9a-f]{8})$/))) reply.key = m[1];
    else if (/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(part)) reply.at = part;
    else if (/board\.(org|md)$/.test(part)) reply.path = part;
  }
  for (const line of lines.slice(at + 2)) {
    if (/^\s*(Quoted text is|Next:|This reply is not on disk)/.test(line)) break;
    const m = line.match(LINE_RE);
    if (m) reply.lines.push({ n: m[1] ? +m[1] : null, who: m[2], kind: m[3], what: m[4] });
  }
  return reply;
}

// The words between the quotes. Our own digests are JSON strings; a reply
// from an older build has bare quotes around the text.
function unquote(s) {
  s = String(s).trim();
  const m = s.match(JSON_STR);
  if (m && m[0].length === s.length) { try { return JSON.parse(s); } catch { /* fall through */ } }
  return s.replace(/^"/, '').replace(/"$/, '');
}

// The option values that `text` names: exactly those, joined by ", ". A key is
// a slug, so a split is exact. An option with no key is its whole sentence,
// which may hold a comma, so the text is read from the left, longest value
// first. Text that is not a list of options names none: a reply is never
// guessed from a word it happens to hold.
function valuesIn(text, options) {
  const known = options.map((o) => o.value);
  const parts = text.split(', ').map((p) => p.trim()).filter(Boolean);
  if (parts.length && parts.every((p) => known.includes(p))) return parts;
  const byLength = [...known].sort((x, y) => y.length - x.length);
  const found = [];
  let rest = text.trim();
  while (rest) {
    const v = byLength.find((k) => rest === k || rest.startsWith(k + ', '));
    if (!v) return [];
    found.push(v);
    rest = rest.slice(v.length).replace(/^,\s+/, '');
  }
  return found;
}

export function replyItems(reply, board, st) {
  const byId = new Map(board.cards.map((c) => [c.id, c]));
  const byN = new Map([...st.cards].map(([id, rec]) => [rec.n, id]));
  // The version a card had at the revision the human answered.
  const vAt = (id) => {
    const rec = st.cards.get(id);
    if (!rec) return 1;
    const past = rec.history.filter((h) => !reply.rev || h.rev <= reply.rev);
    return (past[past.length - 1] || rec.history[0]).v;
  };
  const refs = (s) => [...s.matchAll(/#(\d+)/g)].map((m) => byN.get(+m[1])).filter(Boolean);
  const items = [];
  const problems = [];

  for (const l of reply.lines) {
    if (l.kind === 'note') { items.push({ kind: 'note', text: unquote(l.what) }); continue; }
    if (l.kind === 'order') { items.push({ section: l.who.replace(/^§/, ''), kind: 'order', value: l.what.split(',').map((x) => x.trim()).filter(Boolean) }); continue; }
    const card = byId.get(l.who);
    if (!card && !st.cards.has(l.who)) { problems.push(`${l.who}: no such card on ${board.id}`); continue; }
    let what = l.what;
    const base = { card: l.who, v: vAt(l.who) };
    const stale = what.match(/\s+\[answered on v(\d+), card is now v\d+\]$/);
    if (stale) { base.v = +stale[1]; what = what.slice(0, stale.index); }
    const after = what.match(/\s+\[answered after (.*?) changed\]$/);
    if (after) what = what.slice(0, after.index);
    const extra = after ? { after: refs(after[1]) } : {};

    if (l.kind === 'mark') { items.push({ kind: 'mark', value: what.split(/\s/)[0], ...base }); continue; }
    if (l.kind === 'reply') { items.push({ kind: 'reply', text: unquote(what), ...base }); continue; }
    const defaults = card && l.kind === 'choose' ? card.anatomy.options.filter((o) => o.default).map((o) => o.value) : [];
    if (/^untouched\b/.test(what)) { items.push({ ...base, kind: l.kind, state: 'untouched', ...(l.kind === 'choose' && !defaults.length ? { default: [] } : {}) }); continue; }
    if (/^held:/.test(what)) {
      items.push({ ...base, kind: l.kind, state: 'held', needs: refs(what), why: /changed from your suggestion/.test(what) ? 'changed' : /not needed/.test(what) ? 'skip' : 'open' });
      continue;
    }
    if (l.kind === 'choose') {
      // The word before the colon is not trusted: the state is worked out again
      // from the values, so a reply cannot claim to confirm what it changes.
      const m = what.match(/^(?:confirmed|changed|chosen):\s*(.*?)(?:\s+\(you suggested .*\))?$/);
      const options = card ? card.anatomy.options : [];
      const value = m ? valuesIn(m[1], options) : [];
      if (!m || !value.length) { problems.push(`${l.who}: "${what}" names no option of the card (${options.map((o) => o.value).join(', ')})`); continue; }
      if (value.length > 1 && !card.multi) { problems.push(`${l.who}: ${value.length} options on a single choice (${value.join(', ')})`); continue; }
      const same = value.length === defaults.length && value.every((v) => defaults.includes(v));
      items.push({ kind: 'choose', value, default: defaults, state: !defaults.length ? 'chosen' : same ? 'confirmed' : 'changed', ...base, ...extra });
    } else if (l.kind === 'approve') {
      if (!/^(approved|rejected)$/.test(what)) { problems.push(`${l.who}: approve is approved or rejected, not "${what}"`); continue; }
      items.push({ kind: 'approve', value: what === 'approved' ? 'approve' : 'reject', ...base, ...extra });
    } else if (l.kind === 'do') {
      if (!/^(done|cannot)$/.test(what)) { problems.push(`${l.who}: do is done or cannot, not "${what}"`); continue; }
      items.push({ kind: 'do', value: what, ...base, ...extra });
    } else if (l.kind === 'answer') {
      items.push({ kind: 'answer', text: unquote(what), ...base, ...extra });
    }
  }
  return { items, problems };
}
