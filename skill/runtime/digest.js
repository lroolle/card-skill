// digest.js -- the human's batch of responses, as text an agent reads.
//
// One implementation, two callers: the board page uses it for "Copy reply"
// when no server is running, and the CLI uses it for `cards inbox` and
// `cards wait`. Plain script on purpose, so it can be inlined into the page
// and imported by Node without a build step.
//
// The text is also a wire format: `cards ingest` reads a pasted reply back
// into the log (lib/ingest.mjs). So a line is `who  kind  what`, the human's
// words are JSON strings, and an option comes back as its key.
(function (root) {
  'use strict';

  // The human's words, exact: quotes and line breaks are escaped, nothing is cut.
  function quote(s) {
    return JSON.stringify(String(s).trim());
  }

  function pad(s, n) {
    s = String(s);
    return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length);
  }

  // A short key for one reply, so the same paste is recorded once and the
  // page knows its copied answers have arrived.
  function replyKey(batch) {
    var s = JSON.stringify([batch.rev, batch.at, batch.items]);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return ('0000000' + h.toString(16)).slice(-8);
  }

  // batch: { board: {id, title, path}, round, rev, at, key, pasted, items: [...] }
  // Commands in the text use `cards`, which SKILL.md defines as node <skill>/bin/cards.mjs.
  // cards: { [id]: { n, v, title } } -- the board as it is now
  function cardsDigest(batch, cards) {
    cards = cards || {};
    var lines = [];
    var b = batch.board || {};
    var num = function (id) { return cards[id] ? '#' + cards[id].n : id; };
    lines.push('cards: reply from the board ' + quote(b.title || b.id) + (b.id ? ' (' + b.id + ')' : ''));
    var head = [];
    if (b.path) head.push(b.path);
    if (batch.rev) head.push('rev ' + batch.rev);
    if (batch.round) head.push('round ' + batch.round);
    if (batch.at) head.push(String(batch.at).replace('T', ' ').slice(0, 16));
    if (batch.key) head.push('reply ' + batch.key);
    lines.push(head.join(' · '));
    lines.push('');

    var items = batch.items || [];
    if (!items.length) lines.push('  (no responses)');
    items.forEach(function (it) {
      var c = it.card ? cards[it.card] : null;
      var who = it.card ? (c ? '#' + c.n + ' ' : '') + it.card : it.section !== undefined ? '§' + it.section : 'board';
      var what;
      if (it.state === 'held') {
        // An ask that depends on another ask. It was not answered, or its answer was
        // made for a premise the human then changed: it is not an answer.
        var up = (it.needs || []).map(num).join(', ');
        what = it.why === 'changed' ? 'held: ' + up + ' changed from your suggestion; this ask was written for the suggestion. Ask again.'
          : it.why === 'skip' ? 'held: not needed; it applies to another answer of ' + up
          : 'held: waits for ' + up;
      } else switch (it.kind) {
        case 'choose':
          if (it.state === 'untouched') what = it.default && it.default.length === 0 ? 'untouched (no answer)' : 'untouched (suggestion kept; not consent)';
          else {
            what = it.state + ': ' + (it.value || []).join(', ');
            if (it.state === 'changed' && it.default && it.default.length) what += '  (you suggested ' + it.default.join(', ') + ')';
          }
          break;
        case 'approve':
          what = it.state === 'untouched' ? 'untouched (no answer; not consent)' : it.value === 'approve' ? 'approved' : 'rejected';
          break;
        case 'do':
          what = it.state === 'untouched' ? 'untouched (not done yet)' : it.value === 'done' ? 'done' : 'cannot';
          break;
        case 'answer':
          what = it.state === 'untouched' ? 'untouched (no answer)' : quote(it.text);
          break;
        case 'mark':
          what = { keep: 'keep (confirmed, keep it)', drop: 'drop (wrong or not needed)', more: 'more (go deeper)' }[it.value] || it.value;
          break;
        case 'reply':
        case 'note':
          what = quote(it.text);
          break;
        case 'order':
          what = (it.value || []).join(', ');
          break;
        default:
          what = JSON.stringify(it);
      }
      // Answered with the human's own override, after an ask it depends on changed.
      if (it.after && it.after.length) what += '  [answered after ' + it.after.map(num).join(', ') + ' changed]';
      var stale = c && it.v && c.v && it.v < c.v ? '  [answered on v' + it.v + ', card is now v' + c.v + ']' : '';
      lines.push('  ' + pad(who, 16) + pad(it.kind, 9) + what + stale);
    });

    lines.push('');
    lines.push('Quoted text is the human\'s own words from the board.');
    if (b.id) {
      if (batch.pasted) lines.push('This reply is not on disk yet. Record it first: cards ingest ' + b.id + '   (this text on stdin)');
      lines.push('Next: revise ' + (b.path || 'the board source') + ' (same question -> edit the card; new question -> new card with :FROM:), close the answered asks (cards settle ' + b.id + '), then run: cards render ' + b.id);
    }
    return lines.join('\n');
  }

  // cardsAnswered(sends) -> Set of "id@v" whose ask has an answer that stands.
  // A later round that holds the ask takes the answer back.
  function cardsAnswered(sends) {
    var out = new Set();
    (sends || []).forEach(function (b) {
      b.items.forEach(function (it) {
        if (!it.card || ['choose', 'approve', 'answer', 'do'].indexOf(it.kind) < 0 || it.state === 'untouched') return;
        if (it.state === 'held') out.delete(it.card + '@' + it.v); else out.add(it.card + '@' + it.v);
      });
    });
    return out;
  }

  root.cardsDigest = cardsDigest;
  root.cardsAnswered = cardsAnswered;
  root.cardsReplyKey = replyKey;
})(typeof globalThis !== 'undefined' ? globalThis : this);
