// digest.js -- the human's batch of responses, as text an agent reads.
//
// One implementation, two callers: the board page uses it for "Copy reply"
// when no server is running, and the CLI uses it for `cards inbox` and
// `cards wait`. Plain script on purpose, so it can be inlined into the page
// and imported by Node without a build step.
(function (root) {
  'use strict';

  function quote(s) {
    return '"' + String(s).replace(/\s+/g, ' ').trim() + '"';
  }

  function pad(s, n) {
    s = String(s);
    return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length);
  }

  // batch: { board: {id, title, path}, round, rev, at, items: [...] }
  // Commands in the text use `cards`, which SKILL.md defines as node <skill>/bin/cards.mjs.
  // cards: { [id]: { n, v, title } } -- the board as it is now
  function cardsDigest(batch, cards) {
    cards = cards || {};
    var lines = [];
    var b = batch.board || {};
    lines.push('cards: reply from the board ' + quote(b.title || b.id));
    var head = [];
    if (b.path) head.push(b.path);
    if (batch.rev) head.push('rev ' + batch.rev);
    if (batch.round) head.push('round ' + batch.round);
    if (batch.at) head.push(String(batch.at).replace('T', ' ').slice(0, 16));
    lines.push(head.join(' · '));
    lines.push('');

    var items = batch.items || [];
    if (!items.length) lines.push('  (no responses)');
    items.forEach(function (it) {
      var c = it.card ? cards[it.card] : null;
      var who = it.card ? (c ? '#' + c.n + ' ' : '') + it.card : it.section !== undefined ? '§' + (it.section || 'board') : 'board';
      var what;
      switch (it.kind) {
        case 'choose':
          if (it.state === 'untouched') what = 'untouched (suggestion kept; not consent)';
          else {
            what = (it.state === 'confirmed' ? 'confirmed: ' : 'changed: ') + (it.value || []).join(', ');
            if (it.state === 'changed' && it.default && it.default.length) what += '  (you suggested ' + it.default.join(', ') + ')';
          }
          break;
        case 'approve':
          what = it.state === 'untouched' ? 'untouched (no answer; not consent)' : it.value === 'approve' ? 'approved' : 'rejected';
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
      var stale = c && it.v && c.v && it.v < c.v ? '  [answered on v' + it.v + ', card is now v' + c.v + ']' : '';
      lines.push('  ' + pad(who, 16) + pad(it.kind, 9) + what + stale);
    });

    lines.push('');
    lines.push('Quoted text is the human\'s own words from the board.');
    if (b.id) lines.push('Next: revise ' + (b.path || 'the board source') + ' (same question -> edit the card; new question -> new card with from=), mark answered asks DONE, then run: cards render ' + b.id);
    return lines.join('\n');
  }

  // cardsAnswered(sends) -> Set of "id@v" whose ask got a real answer.
  function cardsAnswered(sends) {
    var out = new Set();
    (sends || []).forEach(function (b) {
      b.items.forEach(function (it) {
        if (it.card && it.state !== 'untouched' && ['choose', 'approve', 'answer'].indexOf(it.kind) >= 0) out.add(it.card + '@' + it.v);
      });
    });
    return out;
  }

  root.cardsDigest = cardsDigest;
  root.cardsAnswered = cardsAnswered;
})(typeof globalThis !== 'undefined' ? globalThis : this);
