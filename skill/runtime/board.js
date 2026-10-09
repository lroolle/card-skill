// board.js -- the board runtime. Fixed code: the agent writes board.md, never this.
//
// State lives in three places, on purpose:
//   B  page data from the compiler (read-only here; replaced on live update)
//   S  view state: view, altitude, filter, sort, search, focus (view and altitude persist;
//      each view keeps its own altitude: the rack opens at Gist to read, the desk at Claim to see links)
//   D  drafts: responses not yet sent (localStorage). Sent replies live in log.jsonl.
(function () {
  'use strict';

  var B = JSON.parse(document.getElementById('board-data').textContent);
  var app = document.getElementById('app');
  var ID = B.board.id;
  var NS = 'cards:' + B.board.path + ':' + ID + ':';

  var ASK_LABEL = { choose: 'Choose', approve: 'Approve', answer: 'Answer' };
  var BASIS = { fact: 'Fact', inference: 'Inference', guess: 'Guess' };
  var MARKS = ['keep', 'drop', 'more'];
  var MARK_LABEL = { keep: 'Keep', drop: 'Drop', more: 'More' };
  var MARK_STAMP = { keep: 'Kept', drop: 'Dropped', more: 'More asked' };
  var ASK_DONE = { choose: 'Chosen', approve: 'Approved', reject: 'Rejected', answer: 'Answered' };
  // One relation vocabulary for both views: [type, label in the focused card's list, label on the lit card].
  var REL = [
    ['option', 'Options', 'Option of'], ['decides', 'Decided in', 'Decides'],
    ['needs', 'Needs', 'Blocks'], ['blocks', 'Blocks', 'Needs'],
    ['from', 'Sources', 'Source of'], ['followup', 'Follow-ups', 'Follow-up of'],
    ['mentions', 'Mentions', 'Mentioned by'], ['mentioned', 'Mentioned by', 'Mentions'],
  ];
  var REL_LIT = {};
  REL.forEach(function (r) { REL_LIT[r[0]] = r[2]; });
  var MARK_TITLE = {
    keep: 'Keep: this is right and it matters (=)',
    drop: 'Drop: wrong or not needed (-)',
    more: 'More: go deeper on this (m)',
  };
  var ICON = {
    grip: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><g fill="currentColor"><circle cx="4" cy="2.5" r="1.1"/><circle cx="8" cy="2.5" r="1.1"/><circle cx="4" cy="6" r="1.1"/><circle cx="8" cy="6" r="1.1"/><circle cx="4" cy="9.5" r="1.1"/><circle cx="8" cy="9.5" r="1.1"/></g></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></g></svg>',
  };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- persistence ----------

  function load(k, d) {
    try { var v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
  }
  function save(k, v) {
    try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { /* private mode: drafts live for this tab */ }
  }
  function emptyDrafts() { return { cards: {}, order: {}, note: '', sentRev: 0 }; }

  var S = { view: load('view', 'rack'), alts: { rack: load('alt', 'gist'), desk: load('deskAlt', 'claim') }, filter: 'all', sort: 'board', q: '', focus: null, hover: null, open: new Set(), replyOpen: new Set() };
  S.alt = S.alts[S.view];
  var D = load('drafts', null) || emptyDrafts();
  // Without a server, copied drafts stay visible until the agent publishes a new rev.
  if (D.sentRev && B.board.rev > D.sentRev) D = emptyDrafts();
  reconcileDrafts();
  var changed = new Set();
  var seen = load('seen', null);
  if (seen) Object.keys(B.cards).forEach(function (id) { if (seen[id] === undefined || B.cards[id].v > seen[id]) changed.add(id); });
  saveSeen();
  var ANS = new Set();
  var pendingData = null;

  function saveSeen() {
    var s = {};
    Object.keys(B.cards).forEach(function (id) { s[id] = B.cards[id].v; });
    save('seen', s);
  }
  function saveDrafts() {
    Object.keys(D.cards).forEach(function (id) {
      var d = D.cards[id];
      var live = Object.keys(d).some(function (k) { var v = d[k]; return k !== 'v' && v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length); });
      if (!live) delete D.cards[id];
    });
    save('drafts', D);
  }
  function touchDrafts() { if (D.sentRev) D.sentRev = 0; saveDrafts(); }

  // ---------- helpers ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function cards() { return Object.keys(B.cards).map(function (id) { return B.cards[id]; }); }
  function cardEl(id) { return document.getElementById('c-' + id); }
  function draft(id) {
    var d = D.cards[id] || (D.cards[id] = {});
    d.v = B.cards[id].v; // the version this draft now answers
    return d;
  }

  function answeredSet() { return window.cardsAnswered(B.sends); }

  // A draft answers the card version it was made on. When the agent revises a
  // card, a drafted choice or approval no longer fits and is dropped; typed
  // text is kept and goes out tagged with the old version, so the agent sees it as stale.
  function reconcileDrafts() {
    Object.keys(D.cards).forEach(function (id) {
      var d = D.cards[id];
      var c = B.cards[id];
      if (!c) { delete D.cards[id]; return; }
      if (d.v && d.v !== c.v) { delete d.choice; delete d.approve; }
    });
    saveDrafts();
  }
  function isOpenAsk(c) { return !!c.ask && c.status !== 'done'; }
  function hasDraftAnswer(c) {
    var d = D.cards[c.id];
    if (!d) return false;
    if (c.ask === 'choose') return !!(d.choice && d.choice.length);
    if (c.ask === 'approve') return !!d.approve;
    if (c.ask === 'answer') return !!(d.answer && d.answer.trim());
    return false;
  }
  function sentAnswer(c) { return ANS.has(c.id + '@' + c.v) || (!!D.sentRev && hasDraftAnswer(c)); }
  // "Yours": an open ask whose answer has not left the page.
  function unsent(c) { return isOpenAsk(c) && !sentAnswer(c); }

  function lastSentOrder(sid) {
    for (var i = B.sends.length - 1; i >= 0; i--) {
      var b = B.sends[i];
      if (b.rev !== B.board.rev) break; // the agent has published since; board.md order rules
      for (var j = 0; j < b.items.length; j++) if (b.items[j].kind === 'order' && b.items[j].section === sid) return b.items[j].value;
    }
    return null;
  }
  function orderedIds(s) {
    var want = D.order[s.id] || lastSentOrder(s.id) || s.cards;
    var out = want.filter(function (id) { return s.cards.indexOf(id) >= 0; });
    s.cards.forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); });
    return out;
  }
  var STATUS_RANK = { open: 1, doing: 0, blocked: 2, done: 3 };
  function sortedIds(s) {
    var ids = orderedIds(s);
    if (S.sort === 'board') return ids;
    var pos = {};
    ids.forEach(function (id, k) { pos[id] = k; });
    var key = S.sort === 'recent'
      ? function (c) { return -c.rev; }
      : function (c) { return unsent(c) ? -1 : STATUS_RANK[c.status]; };
    return ids.slice().sort(function (a, b) {
      return (key(B.cards[a]) - key(B.cards[b])) || (pos[a] - pos[b]);
    });
  }

  // relations(id) -> Map(other id -> type). When two cards link more than one
  // way, the most specific type wins: the REL order is the precedence.
  function relations(id) {
    var c = B.cards[id];
    var rel = new Map();
    function add(o, type) { if (o !== id && B.cards[o] && !rel.has(o)) rel.set(o, type); }
    var all = cards();
    c.options.forEach(function (o) { if (o.ref) add(o.ref, 'option'); });
    all.forEach(function (o) { if (o.options.some(function (p) { return p.ref === id; })) add(o.id, 'decides'); });
    c.needs.forEach(function (o) { add(o, 'needs'); });
    all.forEach(function (o) { if (o.needs.indexOf(id) >= 0) add(o.id, 'blocks'); });
    c.from.forEach(function (o) { add(o, 'from'); });
    all.forEach(function (o) { if (o.from.indexOf(id) >= 0) add(o.id, 'followup'); });
    c.refs.forEach(function (o) { add(o, 'mentions'); });
    all.forEach(function (o) { if (o.refs.indexOf(id) >= 0) add(o.id, 'mentioned'); });
    return rel;
  }

  // What the human did on an ask, drafted or sent: 'choose' | 'approve' | 'reject' | 'answer' | null.
  function answerOf(c) {
    var d = D.cards[c.id] || {};
    if (hasDraftAnswer(c)) return c.ask === 'approve' ? d.approve : c.ask;
    for (var i = B.sends.length - 1; i >= 0; i--) {
      var it = B.sends[i].items.filter(function (x) { return x.card === c.id && x.v === c.v && x.kind === c.ask && x.state !== 'untouched'; })[0];
      if (it) return c.ask === 'approve' ? it.value : c.ask;
    }
    return null;
  }
  function tabLabel(c) {
    var a = answerOf(c);
    return a ? ASK_DONE[a] : ASK_LABEL[c.ask];
  }

  // ---------- responses ----------

  function buildItems(withUntouched) {
    var items = [];
    cards().forEach(function (c) {
      var d = D.cards[c.id] || {};
      var base = { card: c.id, v: d.v || c.v };
      if (d.mark) items.push(Object.assign({ kind: 'mark', value: d.mark }, base));
      if (c.ask === 'choose' && d.choice && d.choice.length) {
        var def = c.options.filter(function (o) { return o.default; }).map(function (o) { return o.value; });
        var same = d.choice.length === def.length && d.choice.every(function (v) { return def.indexOf(v) >= 0; });
        items.push(Object.assign({ kind: 'choose', value: d.choice, default: def, state: same ? 'confirmed' : 'changed' }, base));
      }
      if (c.ask === 'approve' && d.approve) items.push(Object.assign({ kind: 'approve', value: d.approve }, base));
      if (c.ask === 'answer' && d.answer && d.answer.trim()) items.push(Object.assign({ kind: 'answer', text: d.answer.trim() }, base));
      if (d.reply && d.reply.trim()) items.push(Object.assign({ kind: 'reply', text: d.reply.trim() }, base));
    });
    B.sections.forEach(function (s) {
      var o = D.order[s.id];
      if (o && o.join() !== s.cards.join()) items.push({ section: s.id, kind: 'order', value: o });
    });
    if (D.note && D.note.trim()) items.push({ kind: 'note', text: D.note.trim() });
    if (withUntouched && items.length) {
      cards().forEach(function (c) {
        if (unsent(c) && !hasDraftAnswer(c)) items.push({ card: c.id, v: c.v, kind: c.ask, state: 'untouched' });
      });
    }
    return items;
  }

  function waitingCount() {
    return cards().filter(function (c) { return unsent(c) && !hasDraftAnswer(c); }).length;
  }

  function turn() {
    var all = cards();
    var waiting = waitingCount();
    var drafted = D.sentRev ? 0 : buildItems(false).length;
    if (waiting) return { k: 'you', text: 'Your turn · ' + waiting + ' waiting on you' };
    if (drafted) return { k: 'ready', text: 'Ready to send · ' + drafted + ' response' + (drafted > 1 ? 's' : '') };
    if (D.sentRev) return { k: 'agent', text: 'Agent’s turn · reply copied' };
    var last = B.sends[B.sends.length - 1];
    if (last && last.rev === B.board.rev) {
      return { k: 'agent', text: 'Agent’s turn · round ' + last.round + (last.round <= B.read ? ' read' : ' sent') };
    }
    var doing = all.filter(function (c) { return c.status === 'doing'; }).length;
    if (doing) return { k: 'agent', text: 'Agent working · ' + doing + ' in progress' };
    return { k: 'idle', text: 'Nothing waiting on you' };
  }

  function describe(it, c) {
    switch (it.kind) {
      case 'choose': return 'Chose ' + it.value.map(function (v) {
        var o = c.options.filter(function (p) { return p.value === v; })[0];
        return o && o.ref && B.cards[o.ref] ? B.cards[o.ref].title_text : v;
      }).join(', ');
      case 'approve': return it.value === 'approve' ? 'Approved' : 'Rejected';
      case 'mark': return MARK_LABEL[it.value] || it.value;
      default: return it.text || '';
    }
  }

  // ---------- render ----------

  function render() {
    ANS = answeredSet();
    var n = Object.keys(B.cards).length;
    var t = turn();
    var html = [];
    html.push('<div class="page board view-' + S.view + ' alt-' + S.alt + '">');
    html.push('<header><div class="andon">' +
      '<span class="lamp" data-turn="' + t.k + '" role="status"><i></i><span>' + esc(t.text) + '</span></span>' +
      '<span class="stat">rev ' + B.board.rev + ' · ' + n + ' card' + (n === 1 ? '' : 's') + (B.live ? ' · live' : '') + '</span>' +
      '<span class="path">' + esc(B.board.path) + '</span></div>' +
      '<div class="notice" id="notice" hidden></div>' +
      '<h1 class="title">' + esc(B.board.title) + '</h1>' +
      (B.board.lede_html ? '<div class="lede">' + B.board.lede_html + '</div>' : '') +
      '<nav class="rail" aria-label="Asks on this board"></nav></header>');
    if (!n) html.push('<p class="empty">No cards yet. The agent writes them into ' + esc(B.board.path) + '.</p>');
    html.push('<div class="shelves"><svg class="wires" aria-hidden="true"></svg>');
    B.sections.forEach(function (s) { html.push(sectionHtml(s)); });
    html.push('</div>');
    html.push('<p class="empty" id="no-match" hidden></p>');
    html.push('<section class="closing"><h2>Anything else?</h2><p>A note for the agent about the whole board. It goes out with your next send.</p>' +
      '<textarea data-field="note" rows="3" placeholder="Reply to the whole board" aria-label="Reply to the whole board">' + esc(D.note || '') + '</textarea></section>');
    html.push('</div>');
    html.push(toolbar());
    app.innerHTML = html.join('');
    applyView();
    watchSizes();
  }

  function sectionHtml(s) {
    var ids = sortedIds(s);
    var keys = s.layout === 'compare' ? factKeys(ids) : null;
    var head = s.title ? '<div class="shelf-head"><h2>' + esc(s.title) + '</h2><span class="count">' + ids.length + '</span></div>' : '';
    // On the desk a column is as wide as its widest figure needs (card padding and border: 34px).
    var figW = Math.max.apply(null, [0].concat(ids.map(function (id) { return B.cards[id].fig_w || 0; })));
    var colW = figW ? ' style="--col-w:' + Math.min(560, figW + 34) + 'px"' : '';
    return '<section class="shelf" data-section="' + esc(s.id) + '"' + colW + '>' + head +
      (s.note_html ? '<div class="shelf-note">' + s.note_html + '</div>' : '') +
      '<div class="slots" data-layout="' + s.layout + '" style="--cols:' + Math.min(Math.max(ids.length, 1), 4) + '">' +
      ids.map(function (id) { return cardHtml(B.cards[id], keys); }).join('') + '</div></section>';
  }

  function factKeys(ids) {
    var keys = [];
    ids.forEach(function (id) { B.cards[id].facts.forEach(function (f) { if (keys.indexOf(f[0]) < 0) keys.push(f[0]); }); });
    return keys.length ? keys : null;
  }

  function factsHtml(c, keys) {
    if (!c.facts.length && !keys) return '';
    var rows;
    if (keys) {
      var map = {};
      c.facts.forEach(function (f) { map[f[0]] = f[1]; });
      rows = keys.map(function (k) { return '<dt>' + esc(k) + '</dt><dd' + (map[k] === undefined ? ' class="blank">—' : '>' + map[k]) + '</dd>'; });
    } else {
      rows = c.facts.map(function (f) { return '<dt>' + esc(f[0]) + '</dt><dd>' + f[1] + '</dd>'; });
    }
    return '<dl class="facts">' + rows.join('') + '</dl>';
  }

  function askHtml(c, d) {
    if (!isOpenAsk(c)) return '';
    if (c.ask === 'choose') {
      var chosen = d.choice || [];
      var type = c.multi ? 'checkbox' : 'radio';
      return '<div class="ask" role="group" aria-label="' + (c.multi ? 'Choose any' : 'Choose one') + '">' + c.options.map(function (o) {
        var on = chosen.indexOf(o.value) >= 0;
        var hint = o.default ? (on ? 'Suggested · chosen' : 'Suggested') : '';
        return '<label class="opt' + (on ? ' on' : '') + (o.default ? ' suggested' : '') + '"' + (c.multi ? ' data-multi' : '') + '>' +
          '<input type="' + type + '" name="o-' + esc(c.id) + '" value="' + esc(o.value) + '" data-opt' + (on ? ' checked' : '') + '>' +
          '<span class="dot"></span><span class="lbl">' + o.label_html + '</span><span class="hint">' + hint + '</span></label>';
      }).join('') + '</div>';
    }
    if (c.ask === 'approve') {
      return '<div class="ask gate" role="group" aria-label="Approve or reject">' +
        '<button class="btn" data-approve="approve" aria-pressed="' + (d.approve === 'approve') + '">Approve</button>' +
        '<button class="btn reject" data-approve="reject" aria-pressed="' + (d.approve === 'reject') + '">Reject</button></div>';
    }
    return '<div class="ask"><textarea data-field="answer" rows="2" placeholder="Your answer" aria-label="Answer card ' + c.n + '">' + esc(d.answer || '') + '</textarea></div>';
  }

  function threadHtml(c) {
    var out = [];
    B.sends.forEach(function (b) {
      b.items.forEach(function (it) {
        if (it.card === c.id && it.state !== 'untouched') out.push('<div class="said"><b>You · r' + b.round + '</b><span>' + esc(describe(it, c)) + '</span></div>');
      });
    });
    return out.length ? '<div class="thread">' + out.join('') + '</div>' : '';
  }

  function cardHtml(c, keys) {
    var d = D.cards[c.id] || {};
    var meta = [];
    if (c.status === 'doing') meta.push('<span class="st-doing">In progress</span>');
    if (c.status === 'blocked') meta.push('<span class="st-blocked">Blocked</span>');
    if (c.status === 'done') meta.push('<span>Done</span>');
    if (c.basis) meta.push('<span title="How the agent knows this">' + BASIS[c.basis] + '</span>');
    if (c.v > 1) meta.push('<span title="Revised ' + (c.v - 1) + ' time' + (c.v > 2 ? 's' : '') + '">v' + c.v + '</span>');
    if (changed.has(c.id)) meta.push('<span class="chg">' + (c.v > 1 ? 'Changed' : 'New') + '</span>');
    if (c.tags.length) meta.push('<span class="tags">' + c.tags.map(function (t) { return '#' + esc(t); }).join(' ') + '</span>');
    var pct = c.progress ? Math.round(100 * c.progress.done / c.progress.total) : 0;
    var hist = c.history.length
      ? '<details class="history"><summary>Earlier versions (' + c.history.length + ')</summary><ol>' + c.history.map(function (h) {
        return '<li><span>v' + h.v + ' · rev ' + h.rev + '</span><div><del>' + h.title_html + '</del></div>' +
          (h.gist_html ? '<div class="past-gist">' + h.gist_html + '</div>' : '') + '</li>';
      }).join('') + '</ol></details>'
      : '';
    var replyShown = !!(d.reply) || S.replyOpen.has(c.id);
    return '<article class="card' + (c.wide ? ' wide' : '') + '" id="c-' + esc(c.id) + '" data-id="' + esc(c.id) + '" data-status="' + c.status + '"' +
      (c.ask ? ' data-ask="' + c.ask + '"' : '') + ' tabindex="0" aria-labelledby="t-' + esc(c.id) + '">' +
      (isOpenAsk(c) ? '<div class="tab">' + tabLabel(c) + '</div>' : '') +
      '<div class="addr"><span class="n ref-n" title="Card ' + c.n + '">' + c.n + '</span><span class="rel"></span>' +
      '<span class="stamp">' + (d.mark ? MARK_STAMP[d.mark] : '') + '</span>' + meta.join('') + '</div>' +
      '<h3 class="claim" id="t-' + esc(c.id) + '">' + c.title_html + '</h3>' +
      (c.progress ? '<div class="meter" role="img" aria-label="' + c.progress.done + ' of ' + c.progress.total + ' done"><i style="width:' + pct + '%"></i></div>' : '') +
      (c.gist_html ? '<div class="gist">' + c.gist_html + '</div>' : '') +
      (c.figure_html || '') +
      factsHtml(c, keys) + askHtml(c, d) +
      (c.depth_html ? '<div class="depth">' + c.depth_html + '</div>' : '') +
      '<div class="context"></div>' + hist + threadHtml(c) +
      '<div class="acts">' + MARKS.map(function (m) {
        return '<button class="act" data-mark="' + m + '" aria-pressed="' + (d.mark === m) + '" title="' + MARK_TITLE[m] + '">' + MARK_LABEL[m] + '</button>';
      }).join('') + '<button class="act reply-btn" data-act="reply" aria-pressed="' + replyShown + '" title="Reply to this card (r)">Reply</button>' +
      '<button class="grip" data-act="grip" aria-label="Move card ' + c.n + ' (Alt+Arrow keys)" title="Drag to reorder">' + ICON.grip + '</button></div>' +
      '<div class="reply"' + (replyShown ? '' : ' hidden') + '><textarea data-field="reply" rows="2" placeholder="Reply to card ' + c.n + '" aria-label="Reply to card ' + c.n + '">' + esc(d.reply || '') + '</textarea></div>' +
      '</article>';
  }

  function toolbar() {
    return '<nav class="bar" aria-label="Board tools"><div class="tools">' +
      '<div class="seg seg-filter" role="group" aria-label="Filter">' +
      '<button data-filter="all">All</button>' +
      '<button data-filter="yours" title="Asks waiting on you (n jumps to the next)">Yours<span class="c" data-count="yours"></span></button>' +
      '<button data-filter="changed" title="New or revised since your last visit">Changed<span class="c" data-count="changed"></span></button></div>' +
      '<span class="sep"></span>' +
      '<div class="seg seg-alt" role="group" aria-label="Detail">' +
      '<button data-alt="claim" title="Claims only (1)">Claim</button>' +
      '<button data-alt="gist" title="Claim and gist (2)">Gist</button>' +
      '<button data-alt="full" title="Everything (3)">Full</button></div>' +
      '<div class="seg seg-view"><button data-act="desk" title="Lay the cards out on a desk, with lines between related cards (d)">Desk</button></div>' +
      '<span class="sep"></span>' +
      '<select data-sort aria-label="Order"><option value="board">Board order</option><option value="waiting">Waiting first</option><option value="recent">Recent first</option></select>' +
      '<label class="search"><span class="icon-btn" aria-hidden="true">' + ICON.search + '</span><input type="search" data-search placeholder="Find" aria-label="Find cards (/)" value="' + esc(S.q) + '"></label>' +
      '<button class="icon-btn" data-act="help" aria-label="Keyboard shortcuts" title="Keys (?)">?</button></div>' +
      '<button class="send" data-act="send" title="Send your responses to the agent (Ctrl+Enter)">Send</button></nav>';
  }

  // The andon rail: one real tab per open ask, in board order. It puts the
  // asks in the first viewport and jumps to each one.
  function renderRail() {
    var rail = $('.rail');
    if (!rail) return;
    var asks = [];
    B.sections.forEach(function (s) { orderedIds(s).forEach(function (id) { if (isOpenAsk(B.cards[id])) asks.push(B.cards[id]); }); });
    rail.hidden = !asks.length;
    var html = asks.map(function (c) {
      var done = sentAnswer(c) || hasDraftAnswer(c);
      return '<button class="rail-tab" data-goto="' + esc(c.id) + '" data-open' + (done ? ' data-answered' : '') +
        ' title="' + esc(c.title_text) + '"><span class="ref-n">' + c.n + '</span>' + tabLabel(c) + '</button>';
    }).join('');
    if (rail.innerHTML !== html) rail.innerHTML = html;
  }

  function contextStrip(id) {
    var c = B.cards[id];
    var el = cardEl(id) && cardEl(id).querySelector('.context');
    if (!el) return;
    var rel = relations(id);
    var groups = REL.map(function (r) {
      var list = [];
      rel.forEach(function (type, other) { if (type === r[0]) list.push(other); });
      return [r[1], list];
    }).filter(function (g) { return g[1].length; });
    el.innerHTML = groups.length ? groups.map(function (g) {
      return '<span>' + g[0] + ' ' + g[1].filter(function (x) { return B.cards[x]; }).map(function (x) {
        return '<button data-goto="' + esc(x) + '" title="' + esc(B.cards[x].title_text) + '"><span class="ref-n">' + B.cards[x].n + '</span></button>';
      }).join(' ') + '</span>';
    }).join('') : '<span>No links to other cards</span>';
  }

  function applyView() {
    var root = $('.board');
    if (!root) return;
    ANS = answeredSet();
    var rel = S.focus ? relations(S.focus) : new Map();
    root.className = 'page board view-' + S.view + ' alt-' + S.alt + (S.focus && rel.size ? ' focusing' : '');
    var deskBtn = $('[data-act="desk"]');
    if (deskBtn) deskBtn.setAttribute('aria-pressed', String(S.view === 'desk'));
    $$('[data-filter]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.filter === S.filter)); });
    $$('[data-alt]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.alt === S.alt)); });
    var sel = $('[data-sort]');
    if (sel) sel.value = S.sort;

    // The count includes drafted answers (still yours to send); it is hot only while one is unanswered.
    // The badge counts asks still unanswered: the andon number. The Yours filter
    // also keeps asks answered but not yet sent, so a card does not vanish as you answer it.
    var waiting = waitingCount();
    var cy = $('[data-count="yours"]');
    cy.textContent = waiting ? String(waiting) : '';
    cy.classList.toggle('hot', waiting > 0);
    $('[data-count="changed"]').textContent = changed.size ? String(changed.size) : '';

    var q = S.q.trim().toLowerCase();
    var fn = S.focus ? B.cards[S.focus].n : '';
    var shown = 0;
    $$('.card').forEach(function (el) {
      var c = B.cards[el.dataset.id];
      var show = true;
      if (S.filter === 'yours') show = unsent(c);
      else if (S.filter === 'changed') show = changed.has(c.id);
      if (q && c.text.toLowerCase().indexOf(q) < 0 && String(c.n) !== q) show = false;
      el.hidden = !show;
      if (show) shown++;
      el.classList.toggle('focused', c.id === S.focus);
      el.classList.toggle('lit', rel.has(c.id));
      el.classList.toggle('open', S.open.has(c.id));
      el.querySelector('.rel').textContent = rel.has(c.id) ? REL_LIT[rel.get(c.id)] + ' ' + fn : '';
      var answered = sentAnswer(c) || hasDraftAnswer(c);
      if (answered) el.setAttribute('data-answered', ''); else el.removeAttribute('data-answered');
      var tab = el.querySelector('.tab');
      if (tab) tab.textContent = tabLabel(c);
    });
    $$('.shelf').forEach(function (sh) { sh.hidden = !sh.querySelector('.card:not([hidden])'); });
    var none = $('#no-match');
    none.hidden = shown > 0 || !Object.keys(B.cards).length;
    none.textContent = S.filter === 'yours' && !q ? 'Nothing is waiting on you.' : S.filter === 'changed' && !q ? 'Nothing changed since your last visit.' : 'No card matches.';
    if (S.focus) contextStrip(S.focus);

    var items = buildItems(false).length;
    var send = $('[data-act="send"]');
    send.disabled = !items || !!D.sentRev || !!pendingSend;
    send.textContent = pendingSend ? 'Sending\u2026' : D.sentRev ? 'Copied' : items ? 'Send ' + items : 'Send';
    var t = turn();
    var lamp = $('.lamp');
    lamp.dataset.turn = t.k;
    if (lamp.lastChild.textContent !== t.text) lamp.lastChild.textContent = t.text;
    renderRail();
    $$('.grip').forEach(function (g) { g.disabled = S.sort !== 'board'; g.title = S.sort === 'board' ? 'Drag to reorder' : 'Switch to board order to reorder'; });
    alignCompare();
    drawWires();
  }

  // In a compare shelf, claims and gists share a height so facts line up row by row.
  function alignCompare() {
    $$('.slots[data-layout="compare"]').forEach(function (slots) {
      var wide = getComputedStyle(slots).gridTemplateColumns.split(' ').length > 1;
      ['.claim', '.gist', '> .fig'].forEach(function (sel) {
        var els = $$('.card:not([hidden]) ' + sel, slots);
        els.forEach(function (el) { el.style.minHeight = ''; });
        if (!wide || els.length < 2) return;
        var max = Math.max.apply(null, els.map(function (el) { return el.offsetHeight; }));
        els.forEach(function (el) { el.style.minHeight = max + 'px'; });
      });
    });
  }

  // ---------- the desk ----------
  //
  // The same cards, laid out by rule: one column per section in board order,
  // cards in board order inside it. Nobody places a card, so the layout costs
  // no agent time and no human time, and it changes only when the board does.
  // A line means "feeds into": from= (source), needs= (needed first) and
  // option refs (an option of a decision). Mentions draw only for the focused
  // card. Focus turns a card's lines blue; the far card names the relation.

  var WIRE_Y = 21; // lines meet a card at its address line, where the numeral is

  function wireList() {
    var seen = {};
    var out = [];
    function add(a, b, type) {
      if (a === b || !B.cards[a] || !B.cards[b]) return;
      var key = a < b ? a + ' ' + b : b + ' ' + a;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ a: a, b: b, type: type });
    }
    var all = cards();
    // REL precedence: option, then needs, then from, then mention.
    all.forEach(function (c) { c.options.forEach(function (o) { if (o.ref) add(o.ref, c.id, 'option'); }); });
    all.forEach(function (c) { c.needs.forEach(function (x) { add(x, c.id, 'needs'); }); });
    all.forEach(function (c) { c.from.forEach(function (x) { add(x, c.id, 'from'); }); });
    all.forEach(function (c) { c.refs.forEach(function (x) { add(x, c.id, 'mentions'); }); });
    return out;
  }

  // Measure the desk: each column's bounds, its cards, and the open gaps
  // between cards, where a line may cross the column without touching a card.
  function measureDesk(box) {
    // Coordinates in the desk's scrolled content, where the line layer lives.
    var base = box.getBoundingClientRect();
    var ox = box.scrollLeft - base.left - box.clientLeft;
    var oy = box.scrollTop - base.top - box.clientTop;
    var rel = function (r) { return { l: r.left + ox, r: r.right + ox, t: r.top + oy, b: r.bottom + oy }; };
    var cols = [];
    var rect = {};
    $$('.shelf', box).forEach(function (sh) {
      if (sh.hidden) return;
      var col = { k: cols.length, l: 0, r: 0, gaps: [] };
      var sr = rel(sh.getBoundingClientRect());
      col.l = sr.l; col.r = sr.r;
      var head = sh.querySelector('.slots');
      var prevBottom = head ? rel(head.getBoundingClientRect()).t - 4 : sr.t;
      $$('.card:not([hidden])', sh).forEach(function (el) {
        var r = rel(el.getBoundingClientRect());
        var tab = el.querySelector('.tab');
        var top = tab && tab.offsetParent ? rel(tab.getBoundingClientRect()).t : r.t;
        if (top - prevBottom >= 6) col.gaps.push({ y0: prevBottom, y1: top, used: 0 });
        prevBottom = r.b;
        r.col = col.k;
        r.ins = [];
        r.outs = [];
        rect[el.dataset.id] = r;
      });
      col.gaps.push({ y0: prevBottom, y1: prevBottom + 40, used: 0 });
      cols.push(col);
    });
    return { cols: cols, rect: rect };
  }

  // A line between far columns passes each column in between through the
  // open gap nearest to its straight course, never behind a card.
  function crossing(col, want) {
    var best = null;
    col.gaps.forEach(function (g) {
      var y = Math.max(g.y0 + 3, Math.min(g.y1 - 3, want));
      var cost = Math.abs(y - want);
      if (!best || cost < best.cost) best = { g: g, cost: cost };
    });
    var g = best.g;
    var mid = (g.y0 + g.y1) / 2;
    var off = g.used ? (g.used % 2 ? 1 : -1) * Math.ceil(g.used / 2) * 4 : 0;
    g.used++;
    return Math.max(g.y0 + 2, Math.min(g.y1 - 2, (g.y1 - g.y0 < 24 ? mid : Math.max(g.y0 + 8, Math.min(g.y1 - 8, want))) + off));
  }

  function wireD(w, m) {
    var a = m.rect[w.a];
    var b = m.rect[w.b];
    var ya = a.t + w.ya;
    var yb = b.t + w.yb;
    var d;
    var pass = '';
    var tip;
    if (a.col === b.col) {
      // Same column: an arc in the gutter to the right, wider for longer spans.
      var k = Math.min(44, 16 + Math.abs(yb - ya) * 0.08);
      d = 'M' + a.r + ',' + ya + ' C' + (a.r + k) + ',' + ya + ' ' + (b.r + k) + ',' + yb + ' ' + b.r + ',' + yb;
      tip = [b.r, yb, 1];
    } else {
      var fwd = a.col < b.col;
      var x = fwd ? a.r : a.l;
      var y = ya;
      d = 'M' + x + ',' + y;
      var step = fwd ? 1 : -1;
      for (var c = a.col + step; c !== b.col; c += step) {
        var col = m.cols[c];
        var want = ya + (yb - ya) * (c - a.col) / (b.col - a.col);
        var cy = crossing(col, want);
        var inX = fwd ? col.l : col.r;
        var outX = fwd ? col.r : col.l;
        var dx = (inX - x) / 2;
        // The run across a column is drawn apart, dotted: it passes by, it does not attach.
        d += ' C' + (x + dx) + ',' + y + ' ' + (inX - dx) + ',' + cy + ' ' + inX + ',' + cy + ' M' + outX + ',' + cy;
        pass += 'M' + inX + ',' + cy + ' L' + outX + ',' + cy + ' ';
        x = outX;
        y = cy;
      }
      var endX = fwd ? b.l : b.r;
      var dx2 = (endX - x) / 2;
      d += ' C' + (x + dx2) + ',' + y + ' ' + (endX - dx2) + ',' + yb + ' ' + endX + ',' + yb;
      tip = [endX, yb, fwd ? -1 : 1];
    }
    // The arrow tip points into the card: from the left when s = -1, from the right when s = 1.
    var tx = tip[0], ty = tip[1], s = tip[2];
    return { d: d + ' M' + (tx + 6 * s) + ',' + (ty - 4) + ' L' + tx + ',' + ty + ' L' + (tx + 6 * s) + ',' + (ty + 4), pass: pass.trim() };
  }

  function drawWires() {
    var svg = $('.wires');
    if (!svg) return;
    if (S.view !== 'desk') { if (svg.innerHTML) svg.innerHTML = ''; return; }
    var box = $('.shelves');
    var m = measureDesk(box);
    var lit = S.focus;
    var list = wireList().filter(function (w) {
      if (!m.rect[w.a] || !m.rect[w.b]) return false;
      return w.type !== 'mentions' || lit === w.a || lit === w.b;
    });
    // Ends that meet one side of one card spread out along its address line,
    // in the order of their far ends, so arrow tips never sit on each other.
    var sides = {};
    function side(id, which, w, end) { (sides[id + which] || (sides[id + which] = [])).push({ w: w, end: end }); }
    list.forEach(function (w) {
      var a = m.rect[w.a];
      var b = m.rect[w.b];
      var fwd = a.col <= b.col;
      side(w.a, fwd ? 'r' : 'l', w, 'ya');
      side(w.b, a.col === b.col ? 'r' : fwd ? 'l' : 'r', w, 'yb');
    });
    Object.keys(sides).forEach(function (k) {
      var ends = sides[k];
      ends.sort(function (p, q) {
        var po = m.rect[p.end === 'ya' ? p.w.b : p.w.a];
        var qo = m.rect[q.end === 'ya' ? q.w.b : q.w.a];
        return po.t - qo.t;
      });
      ends.forEach(function (e, i) { e.w[e.end] = Math.max(8, WIRE_Y + (i - (ends.length - 1) / 2) * 10); });
    });
    // Measure the desk without the line layer, or an old, larger layer keeps the desk wide.
    svg.setAttribute('width', 0);
    svg.setAttribute('height', 0);
    var w = box.scrollWidth;
    var h = box.scrollHeight;
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.innerHTML = list.map(function (wi) {
      var on = lit === wi.a || lit === wi.b;
      var hot = S.hover && (S.hover === wi.a || S.hover === wi.b);
      var g = wireD(wi, m);
      return '<g class="wire w-' + wi.type + (on ? ' on' : '') + (hot ? ' hot' : '') + '" data-a="' + esc(wi.a) + '" data-b="' + esc(wi.b) + '">' +
        '<path d="' + g.d + '"/>' + (g.pass ? '<path class="pass" d="' + g.pass + '"/>' : '') + '</g>';
    }).join('');
  }

  // Lines follow the cards: any change in a card's size redraws them.
  var sizeWatch = window.ResizeObserver ? new ResizeObserver(function () { scheduleWires(); }) : null;
  var wireFrame = 0;
  function scheduleWires() {
    if (wireFrame) return;
    wireFrame = requestAnimationFrame(function () { wireFrame = 0; drawWires(); });
  }
  function watchSizes() {
    if (!sizeWatch) return;
    sizeWatch.disconnect();
    if (S.view !== 'desk') return;
    $$('.shelves, .shelves .card').forEach(function (el) { sizeWatch.observe(el); });
  }
  function setHover(id) {
    if (S.view !== 'desk' || S.hover === id) return;
    S.hover = id;
    $$('.wire').forEach(function (p) { p.classList.toggle('hot', !!id && (p.dataset.a === id || p.dataset.b === id)); });
  }
  function setAlt(a) {
    S.alt = S.alts[S.view] = a;
    save(S.view === 'desk' ? 'deskAlt' : 'alt', a);
    applyView();
  }
  function toggleDesk() {
    var el = S.focus && cardEl(S.focus);
    S.view = S.view === 'desk' ? 'rack' : 'desk';
    S.alt = S.alts[S.view];
    S.hover = null;
    save('view', S.view);
    applyView();
    watchSizes();
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function refreshCard(id) {
    var el = cardEl(id);
    if (!el) return;
    var s = B.sections.filter(function (x) { return x.id === B.cards[id].section; })[0];
    var keys = s && s.layout === 'compare' ? factKeys(s.cards) : null;
    var wasFocus = document.activeElement === el;
    el.outerHTML = cardHtml(B.cards[id], keys);
    applyView();
    watchSizes();
    if (wasFocus) cardEl(id).focus({ preventScroll: true });
  }

  // ---------- focus ----------

  function focusCard(id, opts) {
    opts = opts || {};
    if (!B.cards[id]) return;
    if (S.filter !== 'all' || S.q) {
      var el0 = cardEl(id);
      if (el0 && el0.hidden) { S.filter = 'all'; S.q = ''; var si = $('[data-search]'); if (si) si.value = ''; }
    }
    S.focus = id;
    if (opts.open) S.open.add(id);
    applyView();
    var el = cardEl(id);
    if (!el) return;
    if (opts.focus !== false) el.focus({ preventScroll: true });
    if (opts.scroll !== false) el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    if (history.replaceState) history.replaceState(null, '', '#c-' + id);
  }
  function clearFocus() {
    S.focus = null;
    applyView();
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
  }
  function visibleCards() { return $$('.card:not([hidden])'); }
  function step(dir) {
    var list = visibleCards();
    if (!list.length) return;
    var k = list.findIndex(function (el) { return el.dataset.id === S.focus; });
    var next = list[k < 0 ? (dir > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, k + dir))];
    focusCard(next.dataset.id);
  }
  function nextWaiting() {
    var list = $$('.card').filter(function (el) { return unsent(B.cards[el.dataset.id]) && !hasDraftAnswer(B.cards[el.dataset.id]); });
    if (!list.length) { toast('Nothing is waiting on you.'); return; }
    var k = list.findIndex(function (el) { return el.dataset.id === S.focus; });
    focusCard(list[(k + 1) % list.length].dataset.id, { open: true });
  }

  // ---------- mutations ----------

  function setMark(id, m) {
    var d = draft(id);
    d.mark = d.mark === m ? undefined : m;
    touchDrafts();
    $$('[data-mark]', cardEl(id)).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mark === d.mark)); });
    cardEl(id).querySelector('.stamp').textContent = d.mark ? MARK_STAMP[d.mark] : '';
    applyView();
  }
  function toggleReply(id, force) {
    var open = force !== undefined ? force : !S.replyOpen.has(id);
    if (open) S.replyOpen.add(id); else S.replyOpen.delete(id);
    var el = cardEl(id);
    var box = el.querySelector('.reply');
    box.hidden = !open && !draft(id).reply;
    el.querySelector('[data-act="reply"]').setAttribute('aria-pressed', String(!box.hidden));
    if (open) box.querySelector('textarea').focus();
  }
  function moveCard(id, dir) {
    if (S.sort !== 'board') { toast('Switch to board order to move cards.'); return; }
    var el = cardEl(id);
    var sib = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    if (!sib) return;
    el.parentElement.insertBefore(el, dir < 0 ? sib : sib.nextElementSibling);
    commitOrder(el.parentElement);
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }
  function commitOrder(slots) {
    var sid = slots.closest('.shelf').dataset.section;
    D.order[sid] = $$('.card', slots).map(function (el) { return el.dataset.id; });
    touchDrafts();
    applyView();
  }

  // ---------- send ----------

  function cardIndex() {
    var out = {};
    cards().forEach(function (c) { out[c.id] = { n: c.n, v: c.v, title: c.title_text }; });
    return out;
  }

  var pendingSend = null;
  var UNDO_MS = 5000;
  function send() {
    if (pendingSend || !buildItems(false).length || D.sentRev) return;
    if (!B.live) { openCopy(window.cardsDigest({ board: { id: ID, title: B.board.title, path: B.board.path }, rev: B.board.rev, at: new Date().toISOString(), items: buildItems(true) }, cardIndex())); return; }
    // Undo over confirmation: the round leaves after a short hold.
    var back = document.activeElement;
    pendingSend = setTimeout(function () { post(); restoreFocus(back); }, UNDO_MS);
    $('[data-act="send"]').disabled = true;
    $('[data-act="send"]').textContent = 'Sending\u2026';
    toast('Sending round ' + (B.sends.length + 1) + '.', 'Undo', function () { undoSend(); restoreFocus(back); }, UNDO_MS);
    var u = $('.toast button');
    if (u) u.focus();
  }

  function undoSend() {
    if (!pendingSend) return;
    clearTimeout(pendingSend);
    pendingSend = null;
    toast('Not sent. Your responses are kept.');
    applyView();
  }
  function restoreFocus(el) {
    if (el && document.contains(el) && el !== document.body) el.focus({ preventScroll: true });
  }

  function post() {
    pendingSend = null;
    var items = buildItems(true);
    if (!items.length) { applyView(); return; }
    fetch('/api/' + encodeURIComponent(ID) + '/send', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: B.token, rev: B.board.rev, items: items }),
    }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; });
    }).then(function (j) {
      D = emptyDrafts();
      saveDrafts();
      S.replyOpen.clear();
      toast('Sent round ' + j.round + '. The agent reads it on its next step.');
      return refresh();
    }).catch(function (e) {
      toast('Not sent: ' + e.message + '. Your responses are kept.');
      applyView();
    });
  }

  function openCopy(text) {
    var dlg = document.createElement('dialog');
    dlg.innerHTML = '<h2>Copy your reply</h2><p>No board server is running, so the reply goes through the clipboard. Paste it into your agent. With <code>cards serve</code>, Send writes it to disk instead.</p>' +
      '<textarea readonly aria-label="Reply text">' + esc(text) + '</textarea>' +
      '<div class="row"><button class="btn" data-close>Close</button><button class="send" data-copy>Copy</button></div>';
    document.body.appendChild(dlg);
    var ta = dlg.querySelector('textarea');
    function done(msg) {
      D.sentRev = B.board.rev;
      saveDrafts();
      applyView();
      dlg.close();
      toast(msg);
    }
    function copy() {
      var fallback = function () { ta.select(); try { document.execCommand('copy'); done('Copied. Paste it into your agent.'); } catch (e) { toast('Select the text and copy it.'); } };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done('Copied. Paste it into your agent.'); }, fallback);
      else fallback();
    }
    dlg.querySelector('[data-copy]').addEventListener('click', copy);
    dlg.querySelector('[data-close]').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('close', function () { dlg.remove(); });
    dlg.showModal();
    ta.select();
  }

  function openHelp() {
    var keys = [['j / k', 'Next / previous card'], ['Enter', 'Open or close the card'], ['Esc', 'Clear focus'], ['n', 'Next card waiting on you'],
      ['1 2 3', 'Claim / Gist / Full'], ['d', 'Desk: cards laid out, with lines'], ['=  -  m', 'Keep / Drop / More'], ['r', 'Reply to the card'], ['Alt + arrows', 'Move the card'],
      ['/', 'Find'], ['f', 'Next filter'], ['s', 'Next order'], ['Ctrl + Enter', 'Send'], ['Esc', 'Undo a send in its first 5 seconds']];
    var dlg = document.createElement('dialog');
    dlg.innerHTML = '<h2>Keys</h2><dl class="keys">' + keys.map(function (k) { return '<dt>' + k[0] + '</dt><dd>' + k[1] + '</dd>'; }).join('') + '</dl>' +
      '<div class="row"><button class="btn" data-close>Close</button></div>';
    document.body.appendChild(dlg);
    dlg.querySelector('[data-close]').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('close', function () { dlg.remove(); });
    dlg.showModal();
  }

  var toastTimer;
  function toast(msg, actionLabel, action, ms) {
    var t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    if (actionLabel) {
      var b = document.createElement('button');
      b.textContent = actionLabel;
      b.addEventListener('click', function () { t.hidden = true; action(); });
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2800);
  }
  function notice(msg) {
    var n = $('#notice');
    if (!n) return;
    n.hidden = !msg;
    n.textContent = msg || '';
  }

  // ---------- live updates (cards serve) ----------

  function refresh() {
    return fetch('/api/' + encodeURIComponent(ID) + '/data', { cache: 'no-store' }).then(function (r) {
      return r.json().then(function (j) {
        if (r.status === 409) { notice('board.md has an error at line ' + j.errors[0].line + ': ' + j.errors[0].msg + '. Showing rev ' + B.board.rev + '.'); return; }
        if (!r.ok) throw new Error(r.status);
        var same = j.board.rev === B.board.rev && j.sends.length === B.sends.length && j.read === B.read;
        if (same) { notice(''); return; }
        // Never swap data under a text box: the DOM would point at cards the data no longer has.
        var typing = document.activeElement && document.activeElement.tagName === 'TEXTAREA';
        if (typing) { pendingData = j; notice('The agent updated the board. It refreshes when you leave the text box.'); return; }
        applyData(j);
      });
    }).catch(function () { /* the server went away; the page keeps working as a static board */ });
  }
  function applyData(next) {
    var before = B;
    B = next;
    pendingData = null;
    var moved = [];
    Object.keys(B.cards).forEach(function (id) {
      if (!before.cards[id] || before.cards[id].v !== B.cards[id].v) { changed.add(id); moved.push(id); }
    });
    changed.forEach(function (id) { if (!B.cards[id]) changed.delete(id); });
    saveSeen();
    reconcileDrafts();
    notice('');
    rerender(moved);
  }

  function rerender(moved) {
    var y = window.scrollY;
    var focus = S.focus;
    if (focus && !B.cards[focus]) S.focus = null;
    render();
    window.scrollTo(0, y);
    (moved || []).forEach(function (id) { var el = cardEl(id); if (el && !reduced) el.classList.add('flash'); });
    if (S.focus && cardEl(S.focus)) cardEl(S.focus).focus({ preventScroll: true });
  }

  // ---------- events ----------

  function typingTarget(t) { return t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT'); }
  var INTERACTIVE = 'a, button, input, textarea, select, label, summary, details';

  app.addEventListener('click', function (e) {
    var t = e.target;
    if (panned) { panned = false; return; }
    var go = t.closest('[data-goto]');
    if (go) { focusCard(go.dataset.goto, { open: go.hasAttribute('data-open') }); return; }
    var ref = t.closest('a.ref[data-ref]');
    if (ref) { e.preventDefault(); focusCard(ref.dataset.ref); return; }
    var card = t.closest('.card');
    var mark = t.closest('[data-mark]');
    if (mark && card) { setMark(card.dataset.id, mark.dataset.mark); return; }
    var ap = t.closest('[data-approve]');
    if (ap && card) {
      var d = draft(card.dataset.id);
      d.approve = d.approve === ap.dataset.approve ? undefined : ap.dataset.approve;
      touchDrafts();
      refreshCard(card.dataset.id);
      return;
    }
    // A second click on a chosen single option clears it: undo over confirmation.
    var opt = t.closest('.opt');
    if (opt && card && !opt.hasAttribute('data-multi') && opt.querySelector('input').checked && t.tagName !== 'INPUT') {
      e.preventDefault();
      draft(card.dataset.id).choice = undefined;
      touchDrafts();
      refreshCard(card.dataset.id);
      return;
    }
    var act = t.closest('[data-act]');
    if (act) {
      var a = act.dataset.act;
      if (a === 'reply' && card) toggleReply(card.dataset.id);
      else if (a === 'desk') toggleDesk();
      else if (a === 'send') send();
      else if (a === 'help') openHelp();
      return;
    }
    var f = t.closest('[data-filter]');
    if (f) { S.filter = f.dataset.filter; applyView(); return; }
    var al = t.closest('[data-alt]');
    if (al) { setAlt(al.dataset.alt); return; }
    // A drag that selects text is reading, not a click: the card stays as it is.
    var sel = window.getSelection && window.getSelection();
    if (card && sel && !sel.isCollapsed && card.contains(sel.anchorNode)) return;
    if (card && !t.closest(INTERACTIVE)) {
      var id = card.dataset.id;
      if (S.focus === id) { if (S.open.has(id)) S.open.delete(id); else S.open.add(id); applyView(); }
      else focusCard(id, { open: true, scroll: false });
      return;
    }
    if (!card && !t.closest('.bar') && !t.closest(INTERACTIVE) && S.focus) clearFocus();
  });

  app.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('[data-opt]')) {
      var card = t.closest('.card');
      var c = B.cards[card.dataset.id];
      var vals = $$('input[data-opt]', card).filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
      draft(c.id).choice = vals.length ? vals : undefined;
      touchDrafts();
      refreshCard(c.id);
      return;
    }
    if (t.matches('[data-sort]')) { S.sort = t.value; render(); }
  });

  var saveTimer;
  app.addEventListener('input', function (e) {
    var t = e.target;
    if (t.matches('[data-search]')) { S.q = t.value; applyView(); return; }
    var field = t.dataset.field;
    if (!field) return;
    if (field === 'note') D.note = t.value;
    else {
      var cardNode = t.closest('.card');
      if (!B.cards[cardNode.dataset.id]) return;
      draft(cardNode.dataset.id)[field] = t.value;
    }
    if (D.sentRev) D.sentRev = 0;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDrafts, 250);
    applyView();
  });

  // Tab onto a card selects it, so keys act on what the ring shows. Keyboard
  // focus only: selecting on mousedown would shift the layout under the click.
  app.addEventListener('focusin', function (e) {
    var t = e.target;
    if (t.classList && t.classList.contains('card') && t.matches(':focus-visible') && S.focus !== t.dataset.id) { S.focus = t.dataset.id; applyView(); }
  });

  app.addEventListener('focusout', function (e) {
    if (e.target.tagName === 'TEXTAREA') {
      saveDrafts();
      if (pendingData) setTimeout(function () {
        if (!pendingData || (document.activeElement && document.activeElement.tagName === 'TEXTAREA')) return;
        applyData(pendingData);
      }, 0);
    }
  });

  // drag to reorder, within a shelf
  var drag = null;
  app.addEventListener('pointerdown', function (e) {
    var g = e.target.closest('.grip');
    if (!g || g.disabled || e.button !== 0) return;
    var card = g.closest('.card');
    drag = { card: card, slots: card.parentElement, moved: false };
    card.classList.add('dragging');
    g.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  app.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var hit = document.elementFromPoint(e.clientX, e.clientY);
    var over = hit && hit.closest('.card');
    if (!over || over === drag.card || over.parentElement !== drag.slots) return;
    var r = over.getBoundingClientRect();
    var cols = getComputedStyle(drag.slots).gridTemplateColumns.split(' ').length;
    var before = cols > 1 ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
    drag.slots.insertBefore(drag.card, before ? over : over.nextElementSibling);
    drag.moved = true;
  });
  function endDrag() {
    if (!drag) return;
    drag.card.classList.remove('dragging');
    if (drag.moved) commitOrder(drag.slots);
    drag = null;
  }
  app.addEventListener('pointerup', endDrag);
  app.addEventListener('pointercancel', endDrag);

  // On the desk, the card under the pointer darkens its own lines.
  app.addEventListener('pointerover', function (e) {
    var card = e.target.closest && e.target.closest('.card');
    setHover(card ? card.dataset.id : null);
    // In a flow figure, the box under the pointer darkens its own arrows.
    var fn = e.target.closest && e.target.closest('svg.flow .fn');
    var svg = e.target.closest && e.target.closest('svg.flow');
    if (svg) $$('.fe', svg).forEach(function (g) { g.classList.toggle('hot', !!fn && (g.dataset.a === fn.dataset.n || g.dataset.b === fn.dataset.n)); });
  });
  app.addEventListener('pointerleave', function () { setHover(null); });

  // Drag the empty desk to pan, as you would slide paper on a table.
  var pan = null;
  var panned = false;
  app.addEventListener('pointerdown', function (e) {
    if (S.view !== 'desk' || e.button !== 0 || e.pointerType !== 'mouse') return;
    var t = e.target;
    if (!t.closest('.shelves') || t.closest('.card') || t.closest(INTERACTIVE)) return;
    pan = { x: e.clientX, y: e.clientY, moved: 0, box: t.closest('.shelves') };
  });
  window.addEventListener('pointermove', function (e) {
    if (!pan) return;
    var dx = e.clientX - pan.x;
    var dy = e.clientY - pan.y;
    pan.x = e.clientX;
    pan.y = e.clientY;
    pan.moved += Math.abs(dx) + Math.abs(dy);
    if (pan.moved > 4) {
      document.documentElement.classList.add('panning');
      pan.box.scrollLeft -= dx;
      window.scrollBy(0, -dy);
    }
  });
  window.addEventListener('pointerup', function () {
    if (!pan) return;
    panned = pan.moved > 4;
    pan = null;
    document.documentElement.classList.remove('panning');
  });

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); return; }
    if (e.key === 'Escape') {
      if (document.querySelector('dialog[open]')) return;
      if (pendingSend) { e.preventDefault(); undoSend(); return; }
      if (typingTarget(t)) { t.blur(); if (S.focus && cardEl(S.focus)) cardEl(S.focus).focus({ preventScroll: true }); return; }
      if (S.focus) { S.open.delete(S.focus); clearFocus(); }
      return;
    }
    if (typingTarget(t) || e.metaKey || e.ctrlKey || document.querySelector('dialog[open]')) return;
    var tc = t.closest && t.closest('.card');
    var id = tc ? tc.dataset.id : S.focus;
    if (e.altKey && id && /^Arrow/.test(e.key)) {
      e.preventDefault();
      // On the desk, left and right mean columns; a card moves only up and down in its own.
      if (S.view === 'desk' && /Left|Right/.test(e.key)) { toast('On the desk, Alt + Up / Down moves a card in its column.'); return; }
      moveCard(id, e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (e.altKey) return;
    switch (e.key) {
      case 'j': case 'ArrowDown': e.preventDefault(); step(1); break;
      case 'k': case 'ArrowUp': e.preventDefault(); step(-1); break;
      case 'Enter': case 'o':
        if (id && (t === cardEl(id) || t === document.body || tc)) {
          e.preventDefault();
          if (S.open.has(id)) S.open.delete(id); else S.open.add(id);
          applyView();
        }
        break;
      case '1': setAlt('claim'); break;
      case '2': setAlt('gist'); break;
      case '3': setAlt('full'); break;
      case '=': case '+': if (id) setMark(id, 'keep'); break;
      case '-': if (id) setMark(id, 'drop'); break;
      case 'm': if (id) setMark(id, 'more'); break;
      case 'r': if (id) { e.preventDefault(); toggleReply(id, true); } break;
      case 'n': nextWaiting(); break;
      case 'd': toggleDesk(); break;
      case 'f': S.filter = { all: 'yours', yours: 'changed', changed: 'all' }[S.filter]; applyView(); break;
      case 's': S.sort = { board: 'waiting', waiting: 'recent', recent: 'board' }[S.sort]; render(); toast('Order: ' + $('[data-sort] option[value="' + S.sort + '"]').textContent); break;
      case '/': e.preventDefault(); $('[data-search]').focus(); break;
      case '?': openHelp(); break;
    }
  });

  // ---------- boot ----------

  render();
  var resizeTimer;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(alignCompare, 120); });
  var hash = location.hash.replace(/^#c-/, '');
  if (hash && B.cards[hash]) focusCard(hash, { open: true });
  if (B.live && window.EventSource) {
    var es = new EventSource('/api/' + encodeURIComponent(ID) + '/events');
    es.addEventListener('change', refresh);
    // Catch anything that changed between this page's render and the stream opening.
    es.addEventListener('hello', refresh);
  }
})();
