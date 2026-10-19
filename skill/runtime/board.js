// board.js -- the board runtime. Fixed code: the agent writes board.org, never this.
//
// State lives in three places, on purpose:
//   B  page data from the compiler (read-only here; replaced on live update)
//   S  view state: view, altitude, filter, sort, search, focus (view and altitude persist;
//      each view keeps its own altitude: the rack opens at Gist to read, the desk at Claim to see links)
//   D  drafts: responses not yet sent (localStorage). Sent replies live in log.jsonl.
(function () {
  'use strict';

  var B = JSON.parse(document.getElementById('board-data').textContent);
  // The map of a project's boards (lib/index.mjs) is this runtime too: each card is a board,
  // each section a group. It has no asks of its own, so it sends nothing and has no chat.
  var MAP = B.kind === 'map';
  var app = document.getElementById('app');
  var ID = B.board.id;
  // A map names its own key: every project's map has the same path, and the pages of
  // every project share one origin when they are files.
  var NS = 'cards:' + (B.board.key || B.board.path + ':' + ID) + ':';

  // t(key, vars) -> a chrome string in the board's language, the same lookup as
  // lib/i18n.mjs. It reads B on each call: a live update replaces B and its table.
  // The result is plain text: esc() it on the way into innerHTML.
  function t(key, vars) {
    vars = vars || {};
    var table = B.strings || {};
    var k = vars.n === 1 && table[key + '_one'] !== undefined ? key + '_one' : key;
    var s = table[k] == null ? key : table[k];
    return s.replace(/\{(\w+)\}/g, function (m, name) { return name in vars ? String(vars[name]) : m; });
  }
  // The same string as HTML, for markup inside a sentence: the text escaped,
  // then each {name} in html filled with ready markup.
  function tHtml(key, html) {
    return esc(t(key)).replace(/\{(\w+)\}/g, function (m, name) { return name in html ? html[name] : m; });
  }

  // Label tables hold string keys; t() turns them into words at render time.
  var ASK_LABEL = { choose: 'ask_choose', approve: 'ask_approve', answer: 'ask_answer', do: 'ask_do' };
  var BASIS = { fact: 'basis_fact', inference: 'basis_inference', guess: 'basis_guess' };
  var MARKS = ['keep', 'drop', 'more'];
  var MARK_LABEL = { keep: 'mark_keep', drop: 'mark_drop', more: 'mark_more' };
  var MARK_STAMP = { keep: 'mark_kept', drop: 'mark_dropped', more: 'mark_more_asked' };
  var ASK_DONE = { choose: 'ask_chosen', approve: 'ask_approved', reject: 'ask_rejected', answer: 'ask_answered', done: 'ask_did', cannot: 'ask_could_not', aside: 'ask_set_aside' };
  // One relation vocabulary for both views: [type, label in the focused card's list,
  // label on the lit card ({card} is the focused card's numeral)].
  var REL = [
    ['option', 'rel_option', 'rel_lit_option'], ['decides', 'rel_decides', 'rel_lit_decides'],
    ['needs', 'rel_needs', 'rel_lit_needs'], ['blocks', 'rel_blocks', 'rel_lit_blocks'],
    ['from', 'rel_from', 'rel_lit_from'], ['followup', 'rel_followup', 'rel_lit_followup'],
    ['mentions', 'rel_mentions', 'rel_lit_mentions'], ['mentioned', 'rel_mentioned', 'rel_lit_mentioned'],
    ['on', 'rel_on', 'rel_lit_on'], ['pinned', 'rel_pinned', 'rel_lit_pinned'],
  ];
  var REL_LIT = {};
  REL.forEach(function (r) { REL_LIT[r[0]] = r[2]; });
  var MARK_TITLE = { keep: 'mark_keep_title', drop: 'mark_drop_title', more: 'mark_more_title' };
  var ICON = {
    grip: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><g fill="currentColor"><circle cx="4" cy="2.5" r="1.1"/><circle cx="8" cy="2.5" r="1.1"/><circle cx="4" cy="6" r="1.1"/><circle cx="8" cy="6" r="1.1"/><circle cx="4" cy="9.5" r="1.1"/><circle cx="8" cy="9.5" r="1.1"/></g></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></g></svg>',
    prev: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    next: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  // The mark: a card with its tab. It stands at the head of the page and in the
  // browser tab; its tab lights while an ask waits on you.
  var MARK_TAB = 'M1.5 3A1.5 1.5 0 0 1 3 1.5h3.5A1.5 1.5 0 0 1 8 3v2.5H1.5z';
  var MARK_CARD = 'M1.5 5h11.5A1.5 1.5 0 0 1 14.5 6.5v6.5a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 13z';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // ?view=rack&level=gist opens the page that way once, for a link or a picture; nothing is saved.
  var ASKED = (function () {
    var q = {};
    try { new URLSearchParams(location.search).forEach(function (v, k) { q[k] = v; }); } catch (e) { /* an old browser: no options */ }
    return { view: /^(desk|rack)$/.test(q.view) ? q.view : null, alt: /^(claim|gist|full)$/.test(q.level) ? q.level : null,
      // ?embed: the board sits in a frame on another page. It keeps one row of tools and no chat box,
      // and lets the wheel go on to the page around it. ?fresh: a sample that anyone may answer;
      // nothing is kept in this browser, so each visit starts with the board as the agent wrote it.
      embed: 'embed' in q, fresh: 'fresh' in q };
  })();
  if (ASKED.embed) document.documentElement.classList.add('embed');

  // ---------- persistence ----------

  function load(k, d) {
    if (ASKED.fresh) return d;
    try { var v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
  }
  function save(k, v) {
    if (ASKED.fresh) return;
    try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { /* private mode: drafts live for this tab */ }
  }
  function emptyDrafts() { return { cards: {}, order: {}, note: '', comments: [], sentRev: 0 }; }
  function arrived(key) { return !!key && (B.sends || []).some(function (b) { return b.key === key; }); }

  // The board opens on the desk (D15): the cards laid out with their links, zoomed to fit.
  // A phone opens on the rack: at phone width the whole desk fits only as a minimap.
  // So does a short window (a phone on its side, a small frame): the desk needs height.
  var NARROW = window.matchMedia('(max-width: 720px), (max-height: 560px)').matches;
  // The desk has no level of its own until you pick one: the first view takes the
  // most detail that still fits the window at a readable size (firstView, below).
  var deskAltSet = load('deskAlt', null);
  var S = { view: ASKED.view || load('view', NARROW ? 'rack' : 'desk'), alts: { rack: load('alt', 'gist'), desk: deskAltSet || 'gist' }, filter: 'all', sort: 'board', q: '', focus: null, hover: null, open: new Set(), replyOpen: new Set(),
    zoom: load('zoom', 'fit'), scale: 1, back: null, chatOpen: false, screen: false };
  if (ASKED.alt) S.alts[S.view] = ASKED.alt;
  S.alt = S.alts[S.view];
  var D = load('drafts', null) || emptyDrafts();
  // Without a server, copied drafts stay visible until the agent publishes a new
  // rev, or records the pasted reply (`cards ingest`): then they are on disk.
  if (D.sentRev && (B.board.rev > D.sentRev || arrived(D.sentKey))) D = emptyDrafts();
  if (D.chatCopied) D.chatCopied = D.chatCopied.filter(function (m) { return !arrived(m.key); });
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
      if (d.v && d.v !== c.v) { delete d.choice; delete d.approve; delete d.done; delete d.anyway; delete d.aside; }
    });
    saveDrafts();
  }
  function isOpenAsk(c) { return !!c.ask && c.status !== 'done'; }
  function hasDraftAnswer(c) {
    var d = D.cards[c.id];
    if (!d) return false;
    // Set aside: the human will not answer this now. It goes out as that, and waits no more.
    if (d.aside) return true;
    if (c.ask === 'choose') return !!(d.choice && d.choice.length);
    if (c.ask === 'approve') return !!d.approve;
    if (c.ask === 'do') return !!d.done;
    if (c.ask === 'answer') return !!(d.answer && d.answer.trim());
    return false;
  }
  function sentAnswer(c) { return ANS.has(c.id + '@' + c.v) || (!!D.sentRev && hasDraftAnswer(c) && !held(c)); }

  // ---- asks that depend on asks ----
  //
  // An ask that :NEEDS: another open ask is written for an answer the human has
  // not given yet. So it waits: locked until the other ask is answered, and held
  // back if that answer is not the one the agent suggested, because its own
  // options may no longer fit. The human can still answer it anyway; the reply
  // then says so. Either way the agent learns which answers rest on which.

  function defaultsOf(c) { return c.options.filter(function (o) { return o.default; }).map(function (o) { return o.value; }); }
  function sameSet(a, b) { return a.length === b.length && a.every(function (v) { return b.indexOf(v) >= 0; }); }
  // The last thing the human said on this ask. A later round that holds the
  // ask takes an earlier answer back: the answer was for a premise that changed.
  function sentItem(c, anyVersion) {
    for (var i = B.sends.length - 1; i >= 0; i--) {
      var it = B.sends[i].items.filter(function (x) { return x.card === c.id && (anyVersion || x.v === c.v) && x.kind === c.ask && x.state !== 'untouched'; })[0];
      if (it) return it.state === 'held' ? null : it;
    }
    return null;
  }
  // The answer an ask has now, as a list of values, or null when it has none
  // that counts: no answer, or an answer that is itself held.
  function answerValues(c, seen) {
    if (!isOpenAsk(c)) {
      // A closed ask: what the human last said, at any version of the card. Set aside is no answer.
      var past = sentItem(c, true);
      if (past && past.state === 'aside') return null;
      return past ? (past.value === undefined ? ['*'] : [].concat(past.value)) : ['*'];
    }
    var d = D.cards[c.id] || {};
    if (d.aside) return null;
    // Its own gate, with the same `seen`: a fresh walk here would never end on a cycle.
    var g = gate(c, seen);
    if (g && !(g.why === 'changed' && d.anyway)) return null;
    if (hasDraftAnswer(c)) return c.ask === 'choose' ? d.choice : c.ask === 'approve' ? [d.approve] : c.ask === 'do' ? [d.done] : ['*'];
    var it = sentItem(c);
    return it && it.state !== 'aside' ? (it.value === undefined ? ['*'] : [].concat(it.value)) : null;
  }
  function asSuggested(c, values) {
    if (c.ask === 'choose') { var def = defaultsOf(c); return !def.length || sameSet(values, def); }
    if (c.ask === 'approve') return values[0] === 'approve';
    if (c.ask === 'do') return values[0] === 'done';
    return true;
  }
  // gate(c) -> null, or { why, needs: [ids] }:
  //   open     an ask it needs has no answer yet
  //   skip     it is written for one answer (:NEEDS: a=link) and the human gave another
  //   changed  it is written for the agent's suggestion and the human chose otherwise
  function gate(c, seen) {
    if (!isOpenAsk(c) || !c.needs.length) return null;
    seen = seen || {};
    if (seen[c.id]) return null; // two asks that need each other: neither waits
    seen[c.id] = true;
    var open = [];
    var skip = [];
    var moved = [];
    c.needs.forEach(function (id) {
      var u = B.cards[id];
      if (!u || !u.ask) return;
      var want = (c.when || {})[id];
      if (!isOpenAsk(u) && !want) return;
      var vals = answerValues(u, seen);
      if (!vals) open.push(id);
      else if (want === '*' || vals[0] === '*' && !isOpenAsk(u)) return;
      else if (want) { if (vals.indexOf(want) < 0) skip.push(id); }
      else if (!asSuggested(u, vals)) moved.push(id);
    });
    seen[c.id] = false;
    return open.length ? { why: 'open', needs: open } : skip.length ? { why: 'skip', needs: skip } : moved.length ? { why: 'changed', needs: moved } : null;
  }
  function overridden(c) { var g = gate(c); return !!g && g.why === 'changed' && !!(D.cards[c.id] || {}).anyway; }
  // Held: the ask cannot be answered now, or its answer does not go out as one.
  function held(c) { var g = gate(c); return !!g && !(g.why === 'changed' && (D.cards[c.id] || {}).anyway); }
  function nums(ids) { return ids.map(function (id) { return '#' + B.cards[id].n; }).join(t('list_sep')); }
  // "Yours": an open ask whose answer has not left the page.
  function unsent(c) { return MAP ? !!c.map.asks.length : isOpenAsk(c) && !sentAnswer(c); }

  function lastSentOrder(sid) {
    for (var i = B.sends.length - 1; i >= 0; i--) {
      var b = B.sends[i];
      if (b.rev !== B.board.rev) break; // the agent has published since; the board source's order rules
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
      ? function (c) { return MAP ? -(Date.parse(c.map.at) || 0) : -c.rev; }
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
    // A card pinned on a part of a sheet: in the sheet, the part carries its numeral.
    (c.on || []).forEach(function (p) { add(p[0], 'on'); });
    all.forEach(function (o) { if ((o.on || []).some(function (p) { return p[0] === id; })) add(o.id, 'pinned'); });
    return rel;
  }

  // What the human did on an ask, drafted or sent: 'choose' | 'approve' | 'reject' | 'answer' | null.
  function answerOf(c) {
    var d = D.cards[c.id] || {};
    if (d.aside) return 'aside';
    if (hasDraftAnswer(c)) return c.ask === 'approve' ? d.approve : c.ask === 'do' ? d.done : c.ask;
    var it = sentItem(c);
    if (it && it.state === 'aside') return 'aside';
    if (it) return c.ask === 'approve' || c.ask === 'do' ? it.value : c.ask;
    return null;
  }
  function tabLabel(c) {
    if (MAP) return t('tile_asks', { n: c.map.asks.length });
    if ((D.cards[c.id] || {}).aside) return t('ask_set_aside');
    if (held(c)) {
      var g = gate(c);
      return g.why === 'skip' ? t('ask_skip') : g.why === 'changed' ? t('ask_on_hold') : t('ask_held', { card: nums(g.needs) });
    }
    var a = answerOf(c);
    return t(a ? ASK_DONE[a] : ASK_LABEL[c.ask]);
  }

  // ---------- responses ----------

  function buildItems(withUntouched) {
    var items = [];
    cards().forEach(function (c) {
      var d = D.cards[c.id] || {};
      var base = { card: c.id, v: d.v || c.v };
      if (d.mark) items.push(Object.assign({ kind: 'mark', value: d.mark }, base));
      // A held answer does not go out as an answer (see the second pass). One the
      // human gave anyway carries `after`: the asks that changed under it.
      // An ask set aside goes out as that, held or not: the human will not answer it now.
      var aside = isOpenAsk(c) && !!d.aside;
      if (aside) items.push(Object.assign({ kind: c.ask, state: 'aside' }, base));
      var go = !aside && isOpenAsk(c) && hasDraftAnswer(c) && !held(c);
      var g = go ? gate(c) : null;
      var ans = g ? Object.assign({ after: g.needs }, base) : base;
      if (go && c.ask === 'choose') {
        var def = defaultsOf(c);
        // No suggestion means nothing to confirm or change: the answer is "chosen".
        items.push(Object.assign({ kind: 'choose', value: d.choice, default: def, state: !def.length ? 'chosen' : sameSet(d.choice, def) ? 'confirmed' : 'changed' }, ans));
      }
      if (go && c.ask === 'approve') items.push(Object.assign({ kind: 'approve', value: d.approve }, ans));
      if (go && c.ask === 'do') items.push(Object.assign({ kind: 'do', value: d.done }, ans));
      if (go && c.ask === 'answer') items.push(Object.assign({ kind: 'answer', text: d.answer.trim() }, ans));
      if (d.reply && d.reply.trim()) items.push(Object.assign({ kind: 'reply', text: d.reply.trim() }, base));
    });
    (D.comments || []).forEach(function (m) { items.push({ kind: 'note', text: m.text }); });
    B.sections.forEach(function (s) {
      var o = D.order[s.id];
      if (o && o.join() !== s.cards.join()) items.push({ section: s.id, kind: 'order', value: o });
    });
    if (withUntouched && items.length) {
      cards().forEach(function (c) {
        if (!isOpenAsk(c)) return;
        // Held goes out for every held ask, also one answered in an earlier
        // round: that answer no longer stands, and the agent must learn it.
        if ((D.cards[c.id] || {}).aside) return;
        var g = held(c) ? gate(c) : null;
        if (g) items.push({ card: c.id, v: c.v, kind: c.ask, state: 'held', needs: g.needs, why: g.why });
        else if (!unsent(c)) return;
        else if (!hasDraftAnswer(c)) items.push(Object.assign({ card: c.id, v: c.v, kind: c.ask, state: 'untouched' }, c.ask === 'choose' && !defaultsOf(c).length ? { default: [] } : {}));
      });
    }
    return items;
  }

  // Asks you can answer now and have not. A held ask is not one of them.
  function waitingCount() {
    if (MAP) return cards().reduce(function (k, c) { return k + c.map.asks.length; }, 0);
    return cards().filter(function (c) { return unsent(c) && !held(c) && !hasDraftAnswer(c); }).length;
  }

  function turn() {
    var all = cards();
    var waiting = waitingCount();
    if (MAP) return waiting ? { k: 'you', text: t('turn_you', { n: waiting }) } : { k: 'idle', text: t('turn_idle') };
    var drafted = D.sentRev ? 0 : buildItems(false).length;
    if (waiting) return { k: 'you', text: t('turn_you', { n: waiting }) };
    if (drafted) return { k: 'ready', text: t('turn_ready', { n: drafted }) };
    if (D.sentRev) return { k: 'agent', text: t('turn_copied') };
    var last = B.sends[B.sends.length - 1];
    if (last && last.rev === B.board.rev) {
      return { k: 'agent', text: t(last.round <= B.read ? 'turn_read' : 'turn_sent', { round: last.round }) };
    }
    var doing = all.filter(function (c) { return c.status === 'doing'; }).length;
    if (doing) return { k: 'agent', text: t('turn_working', { n: doing }) };
    return { k: 'idle', text: t('turn_idle') };
  }

  function describe(it, c) {
    if (it.state === 'aside') return t('ask_set_aside');
    switch (it.kind) {
      case 'choose': return t('thread_chose', { options: it.value.map(function (v) {
        var o = c.options.filter(function (p) { return p.value === v; })[0];
        return o && o.label_text ? o.label_text : v;
      }).join(t('list_sep')) });
      case 'approve': return t(it.value === 'approve' ? 'ask_approved' : 'ask_rejected');
      case 'do': return t(it.value === 'done' ? 'ask_did' : 'ask_could_not');
      case 'mark': return MARK_LABEL[it.value] ? t(MARK_LABEL[it.value]) : it.value;
      default: return it.text || '';
    }
  }

  // ---------- render ----------

  function render() {
    hidePeek();
    ANS = answeredSet();
    var n = Object.keys(B.cards).length;
    var now = turn();
    var stat = MAP ? [t('map_boards', { n: B.board.boards })].concat(B.board.groups ? [t('map_groups', { n: B.board.groups })] : [])
      : [t('stat_rev', { rev: B.board.rev }), t('stat_cards', { n: n })];
    if (B.live) stat.push(t('stat_live'));
    if (B.board.author) stat.push(t('stat_by', { author: B.board.author }));
    var build = B.build || {};
    var html = [];
    html.push('<div class="page board' + (MAP ? ' map' : '') + ' view-' + S.view + ' alt-' + S.alt + (S.screen ? ' screen' : '') + '">');
    // The bar: one line that stays at the top. The way to the other boards, the title, whose
    // turn it is, the asks, the way from card to card, the languages, and what the board is about.
    html.push('<header class="top"><div class="topbar">' +
      (build.home ? '<a class="mark" href="' + esc(build.home) + '" target="_blank" rel="noopener noreferrer" title="' + esc(t('mark_title', { version: build.version })) + '" aria-label="' + esc(t('mark_title', { version: build.version })) + '">' +
        '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path class="mark-tab" d="' + MARK_TAB + '"/><path d="' + MARK_CARD + '"/></svg></a>' : '') +
      switcherHtml() +
      '<h1 class="title" title="' + esc(B.board.title) + '">' + esc(B.board.title) + '</h1>' +
      '<span class="lamp" data-turn="' + now.k + '" role="status"><i></i><span>' + esc(now.text) + '</span></span>' +
      '<nav class="rail" aria-label="' + esc(t(MAP ? 'map_rail_label' : 'rail_label')) + '"></nav>' +
      (MAP ? '' : '<button class="link aside-all" data-act="aside-all" title="' + esc(t('aside_all_title')) + '" hidden>' + esc(t('aside_all')) + '</button>') +
      '<span class="bar-gap"></span>' +
      (n ? '<span class="stepper" role="group" aria-label="' + esc(t('step_label')) + '"><button class="icon-btn" data-act="step-prev" title="' + esc(t('step_prev')) + '" aria-label="' + esc(t('step_prev')) + '">' + ICON.prev + '</button>' +
        '<span class="step-now" aria-live="polite"></span><button class="icon-btn" data-act="step-next" title="' + esc(t('step_next')) + '" aria-label="' + esc(t('step_next')) + '">' + ICON.next + '</button></span>' : '') +
      langsHtml() +
      '<button class="info-btn" data-act="info" aria-expanded="' + !!S.info + '" aria-controls="intro" title="' + esc(t('info_title')) + '">' + esc(t('info_btn')) + '</button>' +
      '</div><div class="notice" id="notice" hidden></div></header>' +
      // What the board is about: under the bar in the reading view, where it scrolls away; on the
      // desk, behind About. Never in the bar itself, which stays.
      '<section class="intro' + (S.info ? ' open' : '') + '" id="intro" aria-label="' + esc(t('info_title')) + '">' +
      (B.board.lede_html ? '<div class="lede">' + B.board.lede_html + '</div>' : '') + relatedHtml() +
      '<p class="meta"><span class="stat">' + esc(stat.join(' · ')) + '</span>' + (B.board.path ? '<span class="path">' + esc(B.board.path) + '</span>' : '') + '</p>' +
      '</section>');
    if (!n) html.push('<p class="empty">' + esc(MAP ? t('map_empty') : t('empty_board', { path: B.board.path })) + '</p>');
    if (S.view === 'desk' && n) html.push(deskBarHtml());
    // The desk is a view (.shelves) onto a plane that zooms; .sizer gives the zoomed plane its scroll size.
    html.push('<div class="shelves"><div class="sizer"><div class="plane"><svg class="wires" aria-hidden="true"></svg>' + (MAP ? '<div class="frames"></div>' : ''));
    if (MAP && S.view === 'rack') html.push(mapListHtml());
    else B.sections.forEach(function (s) { html.push(sectionHtml(s)); });
    html.push('</div></div></div>');
    html.push('<p class="empty" id="no-match" hidden></p>');
    html.push('</div>');
    html.push(toolbar());
    if (!MAP) html.push(chatHtml());
    app.innerHTML = html.join('');
    applyView();
    watchSizes();
  }

  // The boards this board connects to, under its title: where it comes from, what it waits on,
  // what it leads to (lib/index.mjs, relatedOf). Each is a link to that board.
  function relatedHtml() {
    var list = B.board.related || [];
    var group = B.board.category ? '<span class="grp">' + esc(t('related_group', { group: B.board.category })) + '</span>' : '';
    if (MAP || (!list.length && !group)) return '';
    return '<nav class="related" aria-label="' + esc(t('related_label')) + '">' + group + list.map(function (r) {
      return '<span><b>' + esc(t('related_' + r.rel)) + '</b> ' + r.boards.map(function (o) {
        return o.href ? '<a href="' + esc(o.href) + '" title="' + esc(o.title) + '">' + esc(o.id) + '</a>' : '<span title="' + esc(o.title) + '">' + esc(o.id) + '</span>';
      }).join(t('list_sep')) + '</span>';
    }).join('') + '</nav>';
  }

  // The same board in other languages: a short mark each (EN, 中), its name in its own language
  // for the pointer and a screen reader.
  function langName(tag) {
    try { return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) || tag; } catch (e) { return tag; }
  }
  var LANG_SHORT = { en: 'EN', zh: '中', ja: '日', ko: '한' };
  function langShort(tag) {
    var p = String(tag || '').split('-')[0].toLowerCase();
    return LANG_SHORT[p] || p.toUpperCase();
  }
  function langMark(tag, href, self) {
    var name = esc(langName(tag));
    return self || !href ? '<b aria-current="page" lang="' + esc(tag) + '" title="' + name + '" aria-label="' + name + '">' + esc(langShort(tag)) + '</b>'
      : '<a href="' + esc(href) + '" lang="' + esc(tag) + '" hreflang="' + esc(tag) + '" title="' + name + '" aria-label="' + name + '">' + esc(langShort(tag)) + '</a>';
  }
  function langsHtml() {
    var list = B.board.langs || [];
    if (list.length < 2) return '';
    return '<nav class="langs" aria-label="' + esc(t('langs_label')) + '">' + list.map(function (m) {
      // The other language opens the way this page was opened: in a frame, as a sample, on this view.
      return langMark(m.lang, m.self ? '' : m.href + location.search, m.self);
    }).join('') + '</nav>';
  }

  // The way to the other boards of the project: the map first, then every board, by group.
  // A board page knows the boards as they were at its render; the map is always current.
  function switcherHtml() {
    if (ASKED.embed) return '';
    var home = B.board.home;
    var list = MAP ? Object.keys(B.cards).length ? B.sections.reduce(function (acc, s) {
      return acc.concat(s.cards.map(function (id) { var c = B.cards[id]; return { id: id, title: c.title_text, group: s.title, href: c.map.href, self: false, rel: '' }; }));
    }, []) : [] : (B.board.boards || []);
    if (!home && !list.length && !MAP) return '';
    var label = MAP ? t('switch_map') : B.public ? t('home_back') : t('switch_boards');
    if (B.public || (!list.length && !MAP)) return '<a class="switch" href="' + esc(home) + '">' + esc(label) + '</a>';
    var group = null;
    var rows = list.map(function (b) {
      var head = b.group !== group ? '<li class="sw-group" role="presentation">' + esc(b.group || t('switch_no_group')) + '</li>' : '';
      group = b.group;
      var rel = b.rel ? '<span class="sw-rel">' + esc(t('related_' + b.rel)) + '</span>' : '';
      return head + '<li role="none">' + (b.href && !b.self ? '<a role="menuitem" href="' + esc(b.href) + '">' : '<span role="menuitem" aria-current="' + (b.self ? 'page' : 'false') + '">') +
        '<span class="sw-id">' + esc(b.id) + '</span><span class="sw-t">' + esc(b.title) + '</span>' + rel + (b.href && !b.self ? '</a>' : '</span>') + '</li>';
    }).join('');
    var map = MAP ? '<li role="none"><span role="menuitem" aria-current="page" class="sw-map">' + esc(t('switch_map_all')) + '</span></li>'
      : home ? '<li role="none"><a role="menuitem" class="sw-map" href="' + esc(home) + '">' + esc(t('switch_map_all')) + '</a></li>' : '';
    return '<span class="switcher"><button class="switch" data-act="switch" aria-haspopup="menu" aria-expanded="false" aria-controls="switch-menu" title="' + esc(t('switch_title')) + '">' +
      esc(label) + ICON.down + '</button><ul class="pop" id="switch-menu" role="menu" hidden>' + map + rows + '</ul></span>';
  }

  // Rows of a compare shelf hold the same count where they can: six options are 3 + 3, not 4 + 2.
  function compareCols(n) { return n <= 4 ? Math.max(n, 1) : Math.ceil(n / Math.ceil(n / 4)); }

  function sectionHtml(s) {
    if (MAP) return groupHtml(s);
    var all = sortedIds(s);
    // A sheet leads its section: the drawing first, then the cards about it. On the
    // rack the sheets stand above the cards; on the desk they lie in a lane beside them.
    var sheets = all.filter(function (id) { return B.cards[id].sheet; });
    var ids = all.filter(function (id) { return !B.cards[id].sheet; });
    var keys = s.layout === 'compare' ? factKeys(ids) : null;
    var head = s.title ? '<div class="shelf-head"><h2>' + esc(s.title) + '</h2><span class="count">' + all.length + '</span></div>' : '';
    // On the desk a column is as wide as its widest figure needs (card padding and border: 34px).
    var figW = Math.max.apply(null, [0].concat(ids.map(function (id) { return B.cards[id].fig_w || 0; })));
    // At Full a column is also as wide as its widest table wants (compile.mjs, tableWidth).
    // (A DONE card is closed: its table does not show, and asks for no room.)
    var tblW = Math.max.apply(null, [0].concat(ids.map(function (id) { return B.cards[id].status === 'done' ? 0 : B.cards[id].tbl_w || 0; })));
    var colW = figW || tblW ? ' style="' + (figW ? '--col-w:' + Math.min(560, figW + 34) + 'px;' : '') + (tblW ? '--col-wf:' + Math.min(560, tblW + 34) + 'px' : '') + '"' : '';
    var top = head || s.note_html ? '<div class="shelf-top">' + head + (s.note_html ? '<div class="shelf-note">' + s.note_html + '</div>' : '') + '</div>' : '';
    var lane = sheets.length ? '<div class="sheets">' + sheets.map(function (id) { return cardHtml(B.cards[id], null); }).join('') + '</div>' : '';
    var slots = ids.length || !sheets.length ? '<div class="slots" data-layout="' + s.layout + '" style="--cols:' + compareCols(ids.length) + '">' +
      ids.map(function (id) { return cardHtml(B.cards[id], keys); }).join('') + '</div>' : '';
    return '<section class="shelf' + (sheets.length ? ' has-sheets' + (slots ? '' : ' only-sheets') : '') + '" data-section="' + esc(s.id) + '"' + colW + '>' + top +
      lane + slots + '</section>';
  }

  var KEY_HTML = {}; // a fact's key as written -> its markup
  function factKeys(ids) {
    var keys = [];
    ids.forEach(function (id) { B.cards[id].facts.forEach(function (f) { if (keys.indexOf(f[0]) < 0) keys.push(f[0]); if (f[2]) KEY_HTML[f[0]] = f[2]; }); });
    return keys.length ? keys : null;
  }

  function factsHtml(c, keys) {
    if (!c.facts.length && !keys) return '';
    var rows;
    // A key shows its markup (code, emphasis) as any text of the card does. Where a card of a
    // compare section lacks a key, the key's markup comes from a card that has it.
    var keyHtml = function (f) { return f[2] || esc(f[0]); };
    if (keys) {
      var map = {};
      var names = {};
      c.facts.forEach(function (f) { map[f[0]] = f[1]; names[f[0]] = keyHtml(f); });
      rows = keys.map(function (k) { return '<dt>' + (names[k] || KEY_HTML[k] || esc(k)) + '</dt><dd' + (map[k] === undefined ? ' class="blank">—' : '>' + map[k]) + '</dd>'; });
    } else {
      rows = c.facts.map(function (f) { return '<dt>' + keyHtml(f) + '</dt><dd>' + f[1] + '</dd>'; });
    }
    return '<dl class="facts">' + rows.join('') + '</dl>';
  }

  // The line over a gated ask: what it waits for, and the way out.
  function gateHtml(c) {
    var g = gate(c);
    if (!g) return '';
    var who = g.needs.map(function (id) {
      return '<button class="link" data-goto="' + esc(id) + '" title="' + esc(B.cards[id].title_text) + '"><span class="ref-n">' + B.cards[id].n + '</span></button>';
    }).join(' ');
    var say = function (key) { return esc(t(key)).replace(/\{card\}/g, who); };
    if (g.why === 'open') return '<p class="gate-note">' + say('gate_open') + '</p>';
    if (g.why === 'skip') {
      // The answer this ask is written for, in the words of the option.
      var up = B.cards[g.needs[0]];
      var want = c.when[up.id];
      var opt = up.options.filter(function (o) { return o.value === want; })[0];
      var word = opt ? opt.label_text : { approve: t('ask_approve'), reject: t('ask_reject'), done: t('ask_do_done'), cannot: t('ask_do_cannot') }[want] || want;
      return '<p class="gate-note">' + say('gate_skip').replace(/\{value\}/g, esc(word)) + '</p>';
    }
    return overridden(c)
      ? '<p class="gate-note">' + say('gate_after') + '<button class="link" data-act="hold">' + esc(t('gate_hold')) + '</button></p>'
      : '<p class="gate-note">' + say('gate_changed') + '<button class="link" data-act="anyway">' + esc(t('gate_anyway')) + '</button></p>';
  }

  // Set aside: the human will not answer this ask now. The agent learns it, and the ask waits
  // on nobody. Any answer takes it back; so does the button.
  function asideHtml(c, d) {
    return '<p class="aside-row">' + (d.aside ? '<span>' + esc(t('aside_note')) + '</span> ' : '') +
      '<button class="link" data-act="aside" aria-pressed="' + !!d.aside + '" title="' + esc(t('aside_title')) + '">' + esc(t(d.aside ? 'aside_undo' : 'aside')) + '</button></p>';
  }
  function askHtml(c, d) {
    if (!isOpenAsk(c)) return '';
    return askControls(c, d) + asideHtml(c, d);
  }
  function askControls(c, d) {
    // Held controls are shown and off, not hidden: you see what will be asked.
    var off = held(c) ? ' disabled' : '';
    var note = gateHtml(c);
    if (c.ask === 'choose') {
      var chosen = d.choice || [];
      var type = c.multi ? 'checkbox' : 'radio';
      var none = c.suggest === 'none' ? '<p class="ask-note">' + esc(t('ask_no_suggestion')) + '</p>' : '';
      return '<div class="ask' + (off ? ' held' : '') + '" role="group" aria-label="' + esc(t(c.multi ? 'ask_choose_any' : 'ask_choose_one')) + '">' + note + none + c.options.map(function (o) {
        var on = chosen.indexOf(o.value) >= 0;
        var hint = o.default ? esc(t(on ? 'ask_suggested_chosen' : 'ask_suggested')) : '';
        return '<label class="opt' + (on ? ' on' : '') + (o.default ? ' suggested' : '') + '"' + (c.multi ? ' data-multi' : '') + '>' +
          '<input type="' + type + '" name="o-' + esc(c.id) + '" value="' + esc(o.value) + '" data-opt' + (on ? ' checked' : '') + off + '>' +
          '<span class="dot"></span><span class="lbl">' + o.label_html + '</span><span class="hint">' + hint + '</span></label>';
      }).join('') + '</div>';
    }
    if (c.ask === 'approve') {
      return '<div class="ask gate' + (off ? ' held' : '') + '" role="group" aria-label="' + esc(t('ask_approve_or_reject')) + '">' + note +
        '<button class="btn" data-approve="approve" aria-pressed="' + (d.approve === 'approve') + '"' + off + '>' + esc(t('ask_approve')) + '</button>' +
        '<button class="btn reject" data-approve="reject" aria-pressed="' + (d.approve === 'reject') + '"' + off + '>' + esc(t('ask_reject')) + '</button></div>';
    }
    // do: something only you can do, away from the board. You say when it is done.
    if (c.ask === 'do') {
      return '<div class="ask gate' + (off ? ' held' : '') + '" role="group" aria-label="' + esc(t('ask_do_group')) + '">' + note +
        '<button class="btn" data-done="done" aria-pressed="' + (d.done === 'done') + '"' + off + '>' + esc(t('ask_do_done')) + '</button>' +
        '<button class="btn reject" data-done="cannot" aria-pressed="' + (d.done === 'cannot') + '"' + off + '>' + esc(t('ask_do_cannot')) + '</button></div>';
    }
    return '<div class="ask' + (off ? ' held' : '') + '">' + note + '<textarea data-field="answer" rows="2" placeholder="' + esc(t('ask_answer_placeholder')) + '" aria-label="' + esc(t('ask_answer_label', { card: c.n })) + '"' + off + '>' + esc(d.answer || '') + '</textarea></div>';
  }

  function threadHtml(c) {
    var out = [];
    B.sends.forEach(function (b) {
      b.items.forEach(function (it) {
        if (it.card === c.id && it.state !== 'untouched' && it.state !== 'held') out.push('<div class="said"><b>' + esc(t('thread_you', { round: b.round })) + '</b><span>' + esc(describe(it, c)) + '</span></div>');
      });
    });
    return out.length ? '<div class="thread">' + out.join('') + '</div>' : '';
  }

  function cardHtml(c, keys) {
    if (MAP) return tileHtml(c);
    var d = D.cards[c.id] || {};
    var meta = [];
    if (c.status === 'doing') meta.push('<span class="st-doing">' + esc(t('status_doing')) + '</span>');
    if (c.status === 'blocked') meta.push('<span class="st-blocked">' + esc(t('status_blocked')) + '</span>');
    if (c.status === 'done') meta.push('<span>' + esc(t('status_done')) + '</span>');
    if (c.basis) meta.push('<span title="' + esc(t('basis_title')) + '">' + esc(t(BASIS[c.basis])) + '</span>');
    if (c.v > 1) meta.push('<span title="' + esc(t('card_revised', { n: c.v - 1 })) + '">' + esc(t('card_v', { v: c.v })) + '</span>');
    if (changed.has(c.id)) meta.push('<span class="chg">' + esc(t(c.v > 1 ? 'card_changed' : 'card_new')) + '</span>');
    if (c.tags.length) meta.push('<span class="tags">' + c.tags.map(function (tag) { return '#' + esc(tag); }).join(' ') + '</span>');
    var pct = c.progress ? Math.round(100 * c.progress.done / c.progress.total) : 0;
    var hist = c.history.length
      ? '<details class="history"><summary>' + esc(t('card_history', { n: c.history.length })) + '</summary><ol>' + c.history.map(function (h) {
        return '<li><span>' + esc(t('card_history_item', { v: h.v, rev: h.rev })) + '</span><div><del>' + h.title_html + '</del></div>' +
          (h.gist_html ? '<div class="past-gist">' + h.gist_html + '</div>' : '') + '</li>';
      }).join('') + '</ol></details>'
      : '';
    var replyShown = !!(d.reply) || S.replyOpen.has(c.id);
    // A sheet is one drawing: its numeral is the figure's number, and the drawing comes
    // before the words, at the width it needs (the drawing, the card's padding and border).
    var sheet = !!c.sheet;
    var gist = c.gist_html ? '<div class="gist">' + c.gist_html + '</div>' : '';
    return '<article class="card' + (sheet ? ' sheet' : '') + (c.wide && !sheet ? ' wide' : '') + (c.tbl_w > 440 && c.status !== 'done' ? ' wide-t' : '') + '" id="c-' + esc(c.id) + '" data-id="' + esc(c.id) + '" data-status="' + c.status + '"' +
      (c.ask ? ' data-ask="' + c.ask + '"' : '') + (sheet && c.fig_w ? ' style="--sheet-w:' + (c.fig_w + 34) + 'px"' : '') + ' tabindex="0" aria-labelledby="t-' + esc(c.id) + '">' +
      (isOpenAsk(c) ? '<div class="tab">' + esc(tabLabel(c)) + '</div>' : '') +
      '<div class="addr"><span class="n ref-n" title="' + esc(t('card_n', { card: c.n })) + '">' + (sheet ? esc(t('fig')) + ' ' : '') + c.n + '</span><span class="rel"></span>' +
      '<span class="stamp">' + (d.mark ? esc(t(MARK_STAMP[d.mark])) : '') + '</span>' + meta.join('') + '</div>' +
      '<h3 class="claim" id="t-' + esc(c.id) + '">' + c.title_html + '</h3>' +
      (c.progress ? '<div class="meter" role="img" aria-label="' + esc(t('card_progress', { done: c.progress.done, total: c.progress.total })) + '"><i style="width:' + pct + '%"></i></div>' : '') +
      (sheet ? (c.figure_html || '') + gist : gist + (c.figure_html || '')) +
      factsHtml(c, keys) + askHtml(c, d) +
      (c.depth_html ? '<div class="depth">' + c.depth_html + '</div>' : '') +
      '<div class="context"></div>' + hist + threadHtml(c) +
      '<div class="acts">' + MARKS.map(function (m) {
        return '<button class="act" data-mark="' + m + '" aria-pressed="' + (d.mark === m) + '" title="' + esc(t(MARK_TITLE[m])) + '">' + esc(t(MARK_LABEL[m])) + '</button>';
      }).join('') + '<button class="act reply-btn" data-act="reply" aria-pressed="' + replyShown + '" title="' + esc(t('reply_title')) + '">' + esc(t('reply')) + '</button>' +
      '<button class="grip" data-act="grip" aria-label="' + esc(t('grip_label', { card: c.n })) + '" title="' + esc(t('grip_title')) + '">' + ICON.grip + '</button></div>' +
      '<div class="reply"' + (replyShown ? '' : ' hidden') + '><textarea data-field="reply" rows="2" placeholder="' + esc(t('reply_label', { card: c.n })) + '" aria-label="' + esc(t('reply_label', { card: c.n })) + '">' + esc(d.reply || '') + '</textarea></div>' +
      '<span class="widen" aria-hidden="true" title="' + esc(t('size_title')) + '"></span>' +
      '</article>';
  }

  function toolbar() {
    return '<nav class="bar" aria-label="' + esc(t('bar_label')) + '"><div class="tools">' +
      '<div class="seg seg-filter" role="group" aria-label="' + esc(t('filter_label')) + '">' +
      '<button data-filter="all">' + esc(t('filter_all')) + '</button>' +
      '<button data-filter="yours" title="' + esc(t('filter_yours_title')) + '">' + esc(t('filter_yours')) + '<span class="c" data-count="yours"></span></button>' +
      '<button data-filter="changed" title="' + esc(t('filter_changed_title')) + '">' + esc(t('filter_changed')) + '<span class="c" data-count="changed"></span></button></div>' +
      '<span class="sep"></span>' +
      '<div class="seg seg-alt" role="group" aria-label="' + esc(t('alt_label')) + '">' +
      '<button data-alt="claim" title="' + esc(t('alt_claim_title')) + '">' + esc(t('alt_claim')) + '</button>' +
      '<button data-alt="gist" title="' + esc(t('alt_gist_title')) + '">' + esc(t('alt_gist')) + '</button>' +
      '<button data-alt="full" title="' + esc(t('alt_full_title')) + '">' + esc(t('alt_full')) + '</button></div>' +
      '<div class="seg seg-view">' + (MAP ? '<button data-act="desk" title="' + esc(t('map_view_title')) + '">' + esc(t('map_view')) + '</button><button data-act="list" title="' + esc(t('list_view_title')) + '">' + esc(t('list_view')) + '</button>'
        : '<button data-act="desk" title="' + esc(t('desk_title')) + '">' + esc(t('desk')) + '</button>') +
      (screenAllowed() ? '<button data-act="screen" title="' + esc(t('screen_title')) + '">' + esc(t('screen')) + '</button>' : '') + '</div>' +
      '<span class="sep"></span>' +
      '<select data-sort aria-label="' + esc(t('sort_label')) + '"><option value="board">' + esc(t('sort_board')) + '</option><option value="waiting">' + esc(t('sort_waiting')) + '</option><option value="recent">' + esc(t('sort_recent')) + '</option></select>' +
      '<label class="search"><span class="icon-btn" aria-hidden="true">' + ICON.search + '</span><input type="search" data-search placeholder="' + esc(t('find')) + '" aria-label="' + esc(t('find_label')) + '" value="' + esc(S.q) + '"></label>' +
      '<button class="icon-btn" data-act="help" aria-label="' + esc(t('help_label')) + '" title="' + esc(t('help_title')) + '">?</button></div>' +
      (MAP ? '' : '<button class="send" data-act="send" title="' + esc(t('send_title')) + '">' + esc(t('send')) + '</button>') + '</nav>';
  }

  // The andon rail: one real tab per open ask, in board order. It puts the
  // asks in the first viewport and jumps to each one.
  function renderRail() {
    var rail = $('.rail');
    if (!rail) return;
    if (MAP) return mapRail(rail);
    var asks = [];
    B.sections.forEach(function (s) { orderedIds(s).forEach(function (id) { if (isOpenAsk(B.cards[id])) asks.push(B.cards[id]); }); });
    rail.hidden = !asks.length;
    var html = asks.map(function (c) {
      var done = sentAnswer(c) || (hasDraftAnswer(c) && !held(c));
      return '<button class="rail-tab" data-goto="' + esc(c.id) + '" data-open' + (done ? ' data-answered' : '') + (held(c) ? ' data-held' : '') +
        ' title="' + esc(c.title_text) + '"><span class="ref-n">' + c.n + '</span>' + esc(tabLabel(c)) + '</button>';
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
      return '<span>' + esc(t(g[0])) + ' ' + g[1].filter(function (x) { return B.cards[x]; }).map(function (x) {
        return '<button data-goto="' + esc(x) + '" title="' + esc(B.cards[x].title_text) + '"><span class="ref-n">' + B.cards[x].n + '</span></button>';
      }).join(' ') + '</span>';
    }).join('') : '<span>' + esc(t('rel_none')) + '</span>';
  }

  function applyView() {
    var root = $('.board');
    if (!root) return;
    ANS = answeredSet();
    var rel = S.focus ? relations(S.focus) : new Map();
    root.className = 'page board' + (MAP ? ' map' : '') + ' view-' + S.view + ' alt-' + S.alt + (S.focus && rel.size ? ' focusing' : '') + (S.screen ? ' screen' : '');
    var deskBtn = $('[data-act="desk"]');
    if (deskBtn) deskBtn.setAttribute('aria-pressed', String(S.view === 'desk'));
    var listBtn = $('[data-act="list"]');
    if (listBtn) listBtn.setAttribute('aria-pressed', String(S.view === 'rack'));
    var screenBtn = $('[data-act="screen"]');
    if (screenBtn) screenBtn.setAttribute('aria-pressed', String(S.screen));
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
    var fn = S.focus ? (MAP ? '' : '#') + B.cards[S.focus].n : '';
    var shown = 0;
    $$('.card', app).forEach(function (el) {
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
      el.querySelector('.rel').textContent = rel.has(c.id) ? t(REL_LIT[rel.get(c.id)], { card: fn }) : '';
      var answered = sentAnswer(c) || (hasDraftAnswer(c) && !held(c));
      if (answered) el.setAttribute('data-answered', ''); else el.removeAttribute('data-answered');
      if (held(c)) el.setAttribute('data-held', ''); else el.removeAttribute('data-held');
      var tab = el.querySelector('.tab');
      if (tab) tab.textContent = tabLabel(c);
    });
    $$('.shelf').forEach(function (sh) { sh.hidden = !sh.querySelector('.card:not([hidden])'); });
    lightParts();
    var none = $('#no-match');
    none.hidden = shown > 0 || !Object.keys(B.cards).length;
    none.textContent = t(S.filter === 'yours' && !q ? 'empty_yours' : S.filter === 'changed' && !q ? 'empty_changed' : MAP ? 'map_empty_search' : 'empty_search');
    if (S.focus) contextStrip(S.focus);

    var items = buildItems(false).length;
    var send = $('[data-act="send"]');
    if (send) {
      send.disabled = !items || !!D.sentRev || !!pendingSend;
      send.textContent = pendingSend ? t('send_sending') : D.sentRev ? t('send_copied') : items ? t('send_n', { n: items }) : t('send');
    }
    var now = turn();
    var lamp = $('.lamp');
    lamp.dataset.turn = now.k;
    if (lamp.lastChild.textContent !== now.text) lamp.lastChild.textContent = now.text;
    renderRail();
    stepLabel();
    var all = $('.aside-all');
    if (all) all.hidden = !waiting || !!D.sentRev || !!pendingSend;
    setIcon(waiting);
    $$('.grip').forEach(function (g) { g.disabled = S.sort !== 'board'; g.title = t(S.sort === 'board' ? 'grip_title' : 'grip_title_sorted'); });
    alignCompare();
    packRack();
    layoutDesk();
  }

  // Focus on a card pinned on a sheet lights the part it is about, and its numeral there.
  function lightParts() {
    $$('.sheet svg .lit, .sheet svg .pin.on').forEach(function (el) { el.classList.remove('lit', 'on'); });
    var c = S.focus && B.cards[S.focus];
    if (!c) return;
    (c.on || []).forEach(function (p) {
      var sh = cardEl(p[0]);
      // The sheet's own drawing: a later figure in its depth may name a part the same.
      if (sh) $$(':scope > .fig svg [data-part="' + p[1] + '"]', sh).forEach(function (el) { el.classList.add('lit'); });
    });
    $$('.sheet > .fig svg .pin[data-card="' + c.id + '"]').forEach(function (el) { el.classList.add('on'); });
  }

  // The browser tab says it too: a count before the title, and the lit tab of the mark.
  // The icon is its own small document, so it cannot read the page's tokens;
  // their values are read here and written into it.
  var iconState = null;
  function token(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function setIcon(waiting) {
    var ink = token('--fg');
    var state = waiting + ':' + ink + ':' + B.board.title;
    if (state === iconState) return;
    iconState = state;
    document.title = (waiting ? '(' + waiting + ') ' : '') + B.board.title;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
      '<path fill="' + (waiting ? token('--signal') : ink) + '" d="' + MARK_TAB + '"/><path fill="' + ink + '" d="' + MARK_CARD + '"/></svg>';
    var link = document.querySelector('link[rel="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; link.type = 'image/svg+xml'; document.head.appendChild(link); }
    link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
    var mark = $('.mark');
    if (mark) mark.classList.toggle('lit', !!waiting);
  }
  // Day or night changes the ink: draw the icon again.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { iconState = null; applyView(); });

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

  // ---------- the rack: cards packed in columns ----------
  //
  // A grid section on the rack puts each card, in board order, at the top of
  // the column that is free highest; a wide card takes the two neighbouring
  // columns that are. Columns free within PACK_EVEN of the highest count as
  // level, and the leftmost of them wins, so cards of like height still read
  // in rows. No hole stays beside a wide card or under a short one. The order
  // of the cards in the page, which the keyboard and a screen reader follow,
  // does not change. A compare section keeps its rows (its facts line up), a
  // list keeps its one column, and Claim is a ledger.
  var PACK_EVEN = 32;
  var packGap = 0; // the vertical gap of an unpacked grid (board.css, .slots): read once, kept
  // Everything is measured on the layout as it stands, and only then changed: a section that
  // lost its places for a moment would collapse, and the browser would scroll the page.
  function packRack() {
    $$('.slots').forEach(function (slots) {
      var all = $$(':scope > .card', slots);
      var items = all.filter(function (el) { return !el.hidden; });
      var was = slots.classList.contains('packed');
      var cs = getComputedStyle(slots);
      if (!was) packGap = parseFloat(cs.rowGap) || packGap;
      var cols = cs.gridTemplateColumns.split(' ').length;
      var on = S.view === 'rack' && S.alt !== 'claim' && slots.dataset.layout === 'grid' && items.length > 1 && cols > 1;
      if (!on) {
        if (was) { slots.classList.remove('packed'); all.forEach(function (el) { el.style.gridColumn = el.style.gridRow = ''; }); }
        return;
      }
      // A card takes two columns when board.css says so (a wide figure, a wide table at Full),
      // and when its first figure is wider than one column holds (the card's padding and
      // border: 34px). Full screen has narrower columns than the 330px compile.mjs assumes.
      var colW = parseFloat(cs.gridTemplateColumns) || 0;
      var unit = 4; // board.css: a packed grid has rows of --s1
      var bottom = [];
      for (var c = 0; c < cols; c++) bottom.push(0);
      var places = items.map(function (el) {
        var card = B.cards[el.dataset.id];
        var fw = card && card.fig_w && card.status !== 'done' ? card.fig_w + 34 : 0;
        var wide = el.classList.contains('wide') || (S.alt === 'full' && el.classList.contains('wide-t')) || fw > colW + 1;
        var w = Math.min(wide ? 2 : 1, cols);
        var tops = [];
        for (var x = 0; x + w <= cols; x++) tops.push(Math.max.apply(null, bottom.slice(x, x + w)));
        var low = Math.min.apply(null, tops);
        var at = 0;
        while (tops[at] > low + PACK_EVEN) at++;
        var r0 = Math.ceil(tops[at] / unit);
        var rows = Math.ceil((el.offsetHeight + packGap) / unit);
        for (var y = at; y < at + w; y++) bottom[y] = (r0 + rows) * unit;
        return [(at + 1) + ' / span ' + w, (r0 + 1) + ' / span ' + rows];
      });
      slots.classList.add('packed');
      all.forEach(function (el) { if (el.hidden) el.style.gridColumn = el.style.gridRow = ''; });
      items.forEach(function (el, k) {
        if (el.style.gridColumn !== places[k][0]) el.style.gridColumn = places[k][0];
        if (el.style.gridRow !== places[k][1]) el.style.gridRow = places[k][1];
      });
    });
  }
  // A card that grows (opened, an image loaded, a table stacked) packs the section again, in the next frame.
  var packFrame = 0;
  function schedulePack() {
    if (packFrame) return;
    packFrame = requestAnimationFrame(function () { packFrame = 0; if (S.view === 'rack') packRack(); });
  }
  var packWatch = window.ResizeObserver ? new ResizeObserver(schedulePack) : null;

  // ---------- the map: the boards of a project on one table ----------
  //
  // Each card is a board (a tile), each section a group its boards name
  // (#+category:). On the desk a named group is a frame; the boards that name
  // none lie outside every frame. A tile's title opens its board, and each ask
  // on it opens that ask on its board. The lines are the board's own words:
  // it comes from a board, waits on one, or links to a card on one.
  //
  // Drag a tile by its top strip, a frame by its name, a frame's corner to
  // size it. On your table a board is in the group whose frame holds its
  // middle. New group puts an empty frame beside the rest; a double-click on a
  // name, or Enter on it, renames it. Your table lives in this browser, as the
  // desk of a board does; Arrange puts every board back in the group it names.

  var LANE = 4;           // boards in one column of a group on the desk; then the next column
  var FRAME_PAD = 24;     // the frame's edge to its boards (board.css, .board.map .shelf.framed)
  var FRAME_HEAD = 32;    // the strip that holds a frame's name (board.css, .frame-head)
  var FRAME_MIN = [240, 144]; // ten and six steps of the desk's grid (GRID, below)
  var MAP_LEGEND = [['from', 'map_line_from'], ['needs', 'map_line_needs'], ['mentions', 'map_line_links']];

  function groupHtml(s) {
    var ids = sortedIds(s);
    // On the desk a long group stands in columns of LANE; the rack packs its own grid.
    var lanes = [];
    if (S.view === 'desk') for (var k = 0; k < ids.length; k += LANE) lanes.push(ids.slice(k, k + LANE));
    else lanes.push(ids);
    var head = s.title ? '<div class="shelf-top"><div class="shelf-head"><h2>' + esc(s.title) + '</h2><span class="count">' + ids.length + '</span></div></div>' : '';
    return '<section class="shelf' + (s.frame ? ' framed' : '') + '" data-section="' + esc(s.id) + '" style="--lanes:' + Math.max(1, lanes.length) + '">' + head +
      lanes.map(function (lane) { return '<div class="slots" data-layout="grid">' + lane.map(function (id) { return tileHtml(B.cards[id]); }).join('') + '</div>'; }).join('') + '</section>';
  }

  function tileHtml(c) {
    var m = c.map;
    var meta = [];
    if (m.broken) meta.push('<span class="st-blocked">' + esc(t('tile_broken')) + '</span>');
    meta.push('<span>' + esc(c.rev ? t('tile_rev', { rev: c.rev }) : t('tile_not_rendered')) + '</span>');
    if (changed.has(c.id)) meta.push('<span class="chg">' + esc(t(seen && seen[c.id] !== undefined ? 'card_changed' : 'card_new')) + '</span>');
    if (m.unread) meta.push('<span>' + esc(t('tile_unread', { n: m.unread })) + '</span>');
    // A board in more than one language is one tile, with a link to each language.
    var langs = m.langs.length > 1 ? '<span class="tile-langs">' + m.langs.map(function (l) {
      return l.self || !l.href ? '<b lang="' + esc(l.lang) + '">' + esc(langName(l.lang)) + '</b>' : '<a href="' + esc(l.href) + '" lang="' + esc(l.lang) + '">' + esc(langName(l.lang)) + '</a>';
    }).join('') + '</span>' : '';
    var title = m.href ? '<a href="' + esc(m.href) + '" title="' + esc(t('tile_open_title')) + '">' + c.title_html + '</a>' : c.title_html;
    var pct = c.progress ? Math.round(100 * c.progress.done / c.progress.total) : 0;
    var asks = m.asks.length ? '<ul class="tile-asks">' + m.asks.map(function (a) {
      var inner = '<span class="ref-n">' + esc(a.n) + '</span><span class="tile-ask-t">' + esc(a.title) + '</span><span class="tile-ask-k">' + esc(t(ASK_LABEL[a.kind] || 'ask_answer')) + '</span>';
      return '<li>' + (a.href ? '<a href="' + esc(a.href) + '" title="' + esc(t('tile_ask_title')) + '">' + inner + '</a>' : '<span>' + inner + '</span>') + '</li>';
    }).join('') + '</ul>' : '';
    var fig = c.figure_html ? '<div class="tile-fig"' + (m.sheet ? ' title="' + esc(t('tile_sheet', { n: m.sheet.n, title: m.sheet.title })) + '"' : '') + '>' + c.figure_html + '</div>' : '';
    return '<article class="card tile" id="c-' + esc(c.id) + '" data-id="' + esc(c.id) + '" data-status="' + c.status + '" tabindex="0" aria-labelledby="t-' + esc(c.id) + '">' +
      (m.asks.length ? '<div class="tab">' + esc(tabLabel(c)) + '</div>' : '') +
      '<div class="addr"><span class="n ref-n" title="' + esc(m.group || '') + '">' + esc(c.n) + '</span><span class="rel"></span><span class="stamp"></span>' + meta.join('') + langs + '</div>' +
      '<h3 class="claim" id="t-' + esc(c.id) + '">' + title + '</h3>' +
      (c.progress ? '<div class="meter" role="img" aria-label="' + esc(t('card_progress', { done: c.progress.done, total: c.progress.total })) + '"><i style="width:' + pct + '%"></i></div>' : '') +
      (c.gist_html ? '<div class="gist">' + c.gist_html + '</div>' : '') + fig + asks +
      (c.depth_html ? '<div class="depth">' + c.depth_html + '</div>' : '') +
      '<div class="context"></div>' +
      '<div class="acts"><button class="grip" data-act="grip" aria-label="' + esc(t('grip_label', { card: c.n })) + '" title="' + esc(t('grip_title')) + '">' + ICON.grip + '</button></div>' +
      '<span class="widen" aria-hidden="true" title="' + esc(t('size_title')) + '"></span>' +
      '</article>';
  }

  // The rail of the map: a tab for each board with asks that wait on you, and how many.
  // It jumps to the board's tile, where each ask is a link to its card.
  function mapRail(rail) {
    var list = [];
    B.sections.forEach(function (s) { s.cards.forEach(function (id) { if (B.cards[id].map.asks.length) list.push(B.cards[id]); }); });
    rail.hidden = !list.length;
    var html = list.map(function (c) {
      return '<button class="rail-tab" data-goto="' + esc(c.id) + '" data-open title="' + esc(c.title_text) + '"><span class="ref-n">' + esc(c.n) + '</span>' + esc(tabLabel(c)) + '</button>';
    }).join('');
    if (rail.innerHTML !== html) rail.innerHTML = html;
  }

  // The list: every board of the project, one row each, in the order of the map until you
  // sort it by a column. A click on a column's head sorts by it; again, the other way; a third
  // time, back to the order of the map. The rows are the tiles' own cards, so Find, the filters,
  // the keys and focus work on them as on the map.
  var LIST_COLS = [['board', 'list_board', 1], ['group', 'list_group', 1], ['asks', 'list_asks', -1], ['cards', 'list_cards', -1], ['at', 'list_changed', -1], ['rev', 'list_rev', -1]];
  var LIST_KEY = {
    board: function (c) { return c.title_text.toLowerCase(); },
    group: function (c) { return (c.map.group || '\uffff').toLowerCase(); },
    asks: function (c) { return c.map.asks.length; },
    cards: function (c) { return c.map.cards; },
    at: function (c) { return c.map.at || ''; },
    rev: function (c) { return c.rev; },
  };
  S.lsort = { k: 'order', d: 1 };
  function listIds() {
    var order = [];
    B.sections.forEach(function (s) { s.cards.forEach(function (id) { order.push(id); }); });
    var k = S.lsort.k;
    if (k === 'order' || !LIST_KEY[k]) return order;
    var pos = {};
    order.forEach(function (id, i) { pos[id] = i; });
    return order.slice().sort(function (a, b) {
      var x = LIST_KEY[k](B.cards[a]);
      var y = LIST_KEY[k](B.cards[b]);
      return (x < y ? -1 : x > y ? 1 : 0) * S.lsort.d || pos[a] - pos[b];
    });
  }
  function sortList(k) {
    var col = LIST_COLS.filter(function (c) { return c[0] === k; })[0];
    if (!col) return;
    if (S.lsort.k !== k) S.lsort = { k: k, d: col[2] };
    else if (S.lsort.d === col[2]) S.lsort.d = -col[2];
    else S.lsort = { k: 'order', d: 1 };
    render();
    var b = $('[data-lsort="' + k + '"]');
    if (b) b.focus({ preventScroll: true });
  }
  function mapListHtml() {
    var head = '<div class="list-head" role="row">' + LIST_COLS.map(function (c) {
      var on = S.lsort.k === c[0];
      return '<span role="columnheader" class="l-' + c[0] + '" aria-sort="' + (on ? (S.lsort.d > 0 ? 'ascending' : 'descending') : 'none') + '">' +
        '<button data-lsort="' + c[0] + '" title="' + esc(t('list_sort_title')) + '">' + esc(t(c[1])) + (on ? '<i aria-hidden="true">' + (S.lsort.d > 0 ? '↑' : '↓') + '</i>' : '') + '</button></span>';
    }).join('') + '</div>';
    return '<div class="map-list" role="table" aria-label="' + esc(t('list_label')) + '">' + head + '<div role="rowgroup">' + listIds().map(rowHtml).join('') + '</div></div>';
  }
  function rowHtml(id) {
    var c = B.cards[id];
    var m = c.map;
    var title = m.href ? '<a href="' + esc(m.href) + '" title="' + esc(t('tile_open_title')) + '">' + c.title_html + '</a>' : c.title_html;
    var langs = m.langs.length > 1 ? '<span class="tile-langs">' + m.langs.map(function (l) { return langMark(l.lang, l.self ? '' : l.href, l.self); }).join('') + '</span>' : '';
    var asks = m.asks.length ? '<ul class="tile-asks">' + m.asks.map(function (a) {
      return '<li>' + (a.href ? '<a href="' + esc(a.href) + '">' : '<span>') + '<span class="ref-n">' + esc(a.n) + '</span><span class="tile-ask-t">' + esc(a.title) + '</span><span class="tile-ask-k">' + esc(t(ASK_LABEL[a.kind] || 'ask_answer')) + '</span>' + (a.href ? '</a>' : '</span>') + '</li>';
    }).join('') + '</ul>' : '';
    var pct = c.progress ? Math.round(100 * c.progress.done / c.progress.total) : 0;
    return '<div class="card row" role="row" id="c-' + esc(id) + '" data-id="' + esc(id) + '" data-status="' + c.status + '" tabindex="0" aria-labelledby="t-' + esc(id) + '">' +
      '<div role="cell" class="l-board"><div class="addr"><span class="n ref-n">' + esc(c.n) + '</span><span class="rel"></span><span class="stamp"></span>' +
        (m.broken ? '<span class="st-blocked">' + esc(t('tile_broken')) + '</span>' : '') + (changed.has(id) ? '<span class="chg">' + esc(t(seen && seen[id] !== undefined ? 'card_changed' : 'card_new')) + '</span>' : '') + langs + '</div>' +
        '<h3 class="claim" id="t-' + esc(id) + '">' + title + '</h3>' + (c.gist_html ? '<div class="gist">' + c.gist_html + '</div>' : '') + asks + '<div class="context"></div></div>' +
      '<div role="cell" class="l-group">' + esc(m.group || '') + '</div>' +
      '<div role="cell" class="l-asks">' + (m.asks.length ? '<span class="l-wait">' + esc(t('tile_asks', { n: m.asks.length })) + '</span>' : '<span class="l-none">–</span>') + '</div>' +
      '<div role="cell" class="l-cards">' + (c.progress ? '<span class="meter" role="img" aria-label="' + esc(t('card_progress', { done: c.progress.done, total: c.progress.total })) + '"><i style="width:' + pct + '%"></i></span>' : '') +
        '<span>' + esc(c.progress ? t('card_progress', { done: c.progress.done, total: c.progress.total }) : t('tile_cards', { n: m.cards })) + '</span></div>' +
      '<div role="cell" class="l-at">' + esc(m.at ? clock(m.at) : '') + '</div>' +
      '<div role="cell" class="l-rev">' + esc(c.rev ? String(c.rev) : t('tile_not_rendered')) + '</div>' +
      '</div>';
  }

  function frameName(id) {
    var own = PLACE && PLACE.names && PLACE.names[id];
    if (own) return own;
    var s = B.sections.filter(function (x) { return x.id === id; })[0];
    return s && s.title ? s.title : t('frame_untitled');
  }
  function frameEl(id) { return $('.frame[data-frame="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); }
  // [{ id, box: [x, y, w, h] }]: your frames, or on the rule layout one around each named group.
  function frameBoxes(plane) {
    // Your boxes come from this browser's storage: as numbers, whatever was stored.
    if (PLACE) return Object.keys(PLACE.frames || {}).map(function (id) { var f = PLACE.frames[id] || []; return { id: id, box: [0, 1, 2, 3].map(function (k) { return +f[k] || 0; }) }; });
    return $$('.shelf.framed', plane).filter(function (sh) { return !sh.hidden; }).map(function (sh) {
      var r = planeBox(sh, plane);
      return { id: sh.dataset.section, box: [r.l, r.t, r.r - r.l, r.b - r.t] };
    });
  }
  // The tiles whose middle lies in a box, on your table. all: also those a filter hides.
  function membersOf(box, plane, all) {
    return $$('.card', plane).filter(function (el) {
      var p = PLACE && PLACE.cards[el.dataset.id];
      if (!p || (el.hidden && !all)) return false;
      var cx = p[0] + (el.offsetWidth || p[2]) / 2;
      var cy = p[1] + (el.offsetHeight || 0) / 2;
      return cx >= box[0] && cx <= box[0] + box[2] && cy >= box[1] && cy <= box[1] + box[3];
    });
  }
  function drawFrames() {
    var layer = $('.frames');
    if (!layer || S.renaming || fdrag) return;
    if (!deskOn()) { if (layer.innerHTML) layer.innerHTML = ''; return; }
    var plane = $('.plane');
    var html = frameBoxes(plane).map(function (f) {
      var shelf = $('.shelf[data-section="' + f.id + '"]', plane);
      var n = PLACE ? membersOf(f.box, plane).length : shelf ? $$('.card:not([hidden])', shelf).length : 0;
      var empty = PLACE && !membersOf(f.box, plane, true).length;
      var name = frameName(f.id);
      return '<div class="frame" data-frame="' + esc(f.id) + '" style="left:' + f.box[0] + 'px;top:' + f.box[1] + 'px;width:' + f.box[2] + 'px;height:' + f.box[3] + 'px">' +
        '<div class="frame-head" tabindex="0" role="group" aria-label="' + esc(name) + '" title="' + esc(t('frame_move_title')) + '"><b class="frame-name">' + esc(name) + '</b><span class="count">' + n + '</span>' +
        (empty ? '<button class="link frame-x" data-act="frame-remove" title="' + esc(t('frame_remove_title')) + '">' + esc(t('frame_remove')) + '</button>' : '') + '</div>' +
        '<span class="frame-size" title="' + esc(t('frame_size_label', { name: name })) + '"></span></div>';
    }).join('');
    if (layer.innerHTML !== html) layer.innerHTML = html;
  }

  // A board the agent added since you arranged the map goes into the frame of its group, at
  // its foot; the frame grows, and what lies under it moves down by as much, so frames never
  // overlap. A board of a group that has no frame yet gets one of its own, beside the rest.
  // Returns the boards that belong to no group: they go to a column of their own.
  function mapWaiting(waiting, right, grow) {
    var loose = [];
    var fresh = {};
    waiting.forEach(function (el) {
      var sid = B.cards[el.dataset.id].section;
      var shelf = B.sections.filter(function (x) { return x.id === sid; })[0];
      if (!shelf || !shelf.frame) { loose.push(el); return; }
      var f = PLACE.frames[sid];
      if (!f) {
        (fresh[sid] || (fresh[sid] = [])).push(el);
        return;
      }
      var p = [f[0] + FRAME_PAD, snap(f[1] + f[3] - FRAME_PAD + GRID), 288];
      PLACE.cards[el.dataset.id] = p;
      setBox(el, p);
      var was = f[1] + f[3];
      f[3] = snap(p[1] + el.offsetHeight + FRAME_PAD + GRID / 2) - f[1];
      pushBelow(sid, f, f[1] + f[3] - was, el.dataset.id);
      grow(el, p);
    });
    // A new group: a frame beside the rest of the table, its boards one under the other.
    var x = snap(Math.max(right, tableRight()) + GRID * 4);
    Object.keys(fresh).forEach(function (sid) {
      var y = GRID * 2 + FRAME_HEAD;
      fresh[sid].forEach(function (el) {
        var p = [x + FRAME_PAD, y, 288];
        PLACE.cards[el.dataset.id] = p;
        setBox(el, p);
        grow(el, p);
        y = snap(y + el.offsetHeight + GRID * 2);
      });
      PLACE.frames[sid] = [x, GRID * 2, 288 + 2 * FRAME_PAD, y - GRID * 2];
      x = snap(x + 288 + 2 * FRAME_PAD + GRID * 4);
    });
    return loose;
  }
  // Everything that starts under a frame's old foot, within its width, moves down by dy: the
  // frames there with their boards, and the boards there that lie in no frame. The boards of
  // the frame itself stay, and so does keep, the board just put into it.
  function pushBelow(sid, f, dy, keep) {
    if (dy <= 0) return;
    var plane = $('.plane');
    var foot = f[1] + f[3] - dy;
    var across = function (l, r) { return r > f[0] && l < f[0] + f[2]; };
    var stay = {};
    stay[keep] = true;
    membersOf([f[0], f[1], f[2], f[3] - dy], plane, true).forEach(function (el) { stay[el.dataset.id] = true; });
    var move = {};
    Object.keys(PLACE.frames).forEach(function (id) {
      var g = PLACE.frames[id];
      if (id === sid || g[1] < foot || !across(g[0], g[0] + g[2])) return;
      membersOf(g, plane, true).forEach(function (el) { move[el.dataset.id] = true; });
      g[1] += dy;
    });
    Object.keys(PLACE.cards).forEach(function (id) {
      var p = PLACE.cards[id];
      if (stay[id] || !(move[id] || (p[1] >= foot && across(p[0], p[0] + p[2])))) return;
      p[1] += dy;
      var el = cardEl(id);
      if (el) setBox(el, p);
    });
  }

  // The right edge of everything on your table: where a new thing goes, so nothing you placed moves.
  // A board a filter hides counts too: a new frame must not land on it.
  function tableRight() {
    var right = 0;
    Object.keys(PLACE.cards).forEach(function (id) { if (cardEl(id)) right = Math.max(right, PLACE.cards[id][0] + PLACE.cards[id][2]); });
    Object.keys(PLACE.frames || {}).forEach(function (id) { var f = PLACE.frames[id]; right = Math.max(right, f[0] + f[2]); });
    return right;
  }
  function newGroup() {
    if (!deskOn()) return;
    if (!PLACE) freeze();
    PLACE.frames = PLACE.frames || {};
    PLACE.names = PLACE.names || {};
    var k = 1;
    while (PLACE.frames['u' + k]) k++;
    var id = 'u' + k;
    // Beside the rest of the table, never over it: a frame dropped on boards would take them in.
    PLACE.frames[id] = [snap(tableRight() + GRID * 4), GRID * 2, GRID * 14, GRID * 9];
    PLACE.names[id] = t('frame_untitled') + ' ' + k;
    savePlace();
    layoutDesk();
    var f = PLACE.frames[id];
    var box = deskBox();
    var o = planeOrigin();
    var z = Math.max(S.scale, 0.5);
    animateTo(z, o[0] + (f[0] + f[2] / 2) * z - box.clientWidth / 2, o[1] + (f[1] + f[3] / 2) * z - (box.clientHeight - padY(box)) / 2);
    renameFrame(id);
  }
  function removeFrame(id) {
    if (!PLACE || !PLACE.frames || !PLACE.frames[id]) return;
    delete PLACE.frames[id];
    if (PLACE.names) delete PLACE.names[id];
    savePlace();
    layoutDesk();
  }
  function renameFrame(id) {
    var el = frameEl(id);
    var name = el && el.querySelector('.frame-name');
    if (!name) return;
    S.renaming = id;
    var input = document.createElement('input');
    input.className = 'frame-input';
    input.value = frameName(id);
    input.setAttribute('aria-label', t('frame_name_label'));
    input.maxLength = 60;
    name.replaceWith(input);
    input.focus();
    input.select();
    var done = false;
    function finish(keep) {
      if (done) return;
      done = true;
      S.renaming = null;
      var v = input.value.replace(/\s+/g, ' ').trim();
      if (keep && v && v !== frameName(id)) {
        if (!PLACE) freeze();
        PLACE.names = PLACE.names || {};
        PLACE.names[id] = v;
        savePlace();
      }
      layoutDesk();
      var head = frameEl(id) && frameEl(id).querySelector('.frame-head');
      if (head) head.focus({ preventScroll: true });
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });
  }

  // Drag a frame by its name: it takes the boards inside it along. Drag its corner to size it.
  var fdrag = null;
  function startFrame(e) {
    if (!MAP || !deskOn() || e.button !== 0) return false;
    var hit = e.target.closest('.frame-head, .frame-size');
    if (!hit || e.target.closest('button, input')) return false;
    fdrag = { id: hit.closest('.frame').dataset.frame, x: e.clientX, y: e.clientY, moved: false, pid: e.pointerId, el: hit, size: hit.classList.contains('frame-size') };
    e.preventDefault();
    return true;
  }
  function moveFrame(e) {
    var dx = e.clientX - fdrag.x;
    var dy = e.clientY - fdrag.y;
    if (!fdrag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    if (!fdrag.moved) {
      var d0 = fdrag;
      fdrag = null; // a frozen layout draws its frames once more, before this drag owns them
      if (!PLACE) freeze();
      fdrag = d0;
      var f0 = PLACE.frames && PLACE.frames[fdrag.id];
      if (!f0) { fdrag = null; return; }
      fdrag.moved = true;
      fdrag.start = f0.slice();
      fdrag.members = fdrag.size ? [] : membersOf(f0, $('.plane'), true).map(function (el) { return [el, el.dataset.id, PLACE.cards[el.dataset.id].slice()]; });
      document.documentElement.classList.add(fdrag.size ? 'sizing-frame' : 'moving-frame');
      fdrag.el = frameEl(fdrag.id).querySelector(fdrag.size ? '.frame-size' : '.frame-head');
      try { fdrag.el.setPointerCapture(fdrag.pid); } catch (err) { /* the pointer left already */ }
    }
    var f = PLACE.frames[fdrag.id];
    var kx = dx / S.scale;
    var ky = dy / S.scale;
    if (fdrag.size) {
      f[2] = Math.max(FRAME_MIN[0], fdrag.start[2] + kx);
      f[3] = Math.max(FRAME_MIN[1], fdrag.start[3] + ky);
    } else {
      f[0] = Math.max(0, fdrag.start[0] + kx);
      f[1] = Math.max(0, fdrag.start[1] + ky);
      fdrag.members.forEach(function (m) {
        var p = PLACE.cards[m[1]];
        p[0] = m[2][0] + f[0] - fdrag.start[0];
        p[1] = m[2][1] + f[1] - fdrag.start[1];
        setBox(m[0], p);
      });
    }
    var el = frameEl(fdrag.id);
    if (el) { el.style.left = f[0] + 'px'; el.style.top = f[1] + 'px'; el.style.width = f[2] + 'px'; el.style.height = f[3] + 'px'; }
    scheduleWires();
    e.preventDefault();
  }
  function endFrame() {
    if (!fdrag) return;
    var d = fdrag;
    fdrag = null;
    document.documentElement.classList.remove('sizing-frame', 'moving-frame');
    if (!d.moved) return;
    var f = PLACE.frames[d.id];
    if (d.size) {
      f[2] = Math.max(FRAME_MIN[0], snap(f[2]));
      f[3] = Math.max(FRAME_MIN[1], snap(f[3]));
    } else {
      // The frame and its boards land on the grid together, by the same step.
      var sx = snap(f[0]) - f[0];
      var sy = snap(f[1]) - f[1];
      f[0] += sx;
      f[1] += sy;
      d.members.forEach(function (m) { var p = PLACE.cards[m[1]]; p[0] += sx; p[1] += sy; });
    }
    savePlace();
    layoutDesk();
    swallowClick();
  }

  // ---------- the desk ----------
  //
  // The same cards laid out on a table. A rule places them by default: one
  // column per section, in board order. Drag a card by its top strip and the
  // table becomes yours: every card keeps the place it had, and only what you
  // move moves. Arrange goes back to the rule. Your layout lives in this
  // browser; board.org never changes (the box keeps the order, the desk is
  // for work).
  //
  // The table zooms: Fit shows the whole board; 50% and 100% read it; Ctrl or
  // a pinch zooms at the pointer. Focusing a card at a small scale zooms to
  // it, and Esc goes back.
  //
  // A line means "feeds into". Each link type has its own color and end:
  //   source (from)  grey, open arrow       needs   red, filled arrow
  //   option         violet, a diamond at the decision
  //   mention        dashed, a dot; drawn only for the card in focus

  var WIRE_Y = 21;  // lines meet a card at its address line, where the numeral is
  var GRID = 24;    // the dot grid; a moved card snaps to it
  var TAB_H = 20;
  var TIP_INSET = { from: 0, needs: 7, option: 12, mentions: 3 };
  var LEGEND = [['from', 'desk_line_from'], ['needs', 'desk_line_needs'], ['option', 'desk_line_option'], ['mentions', 'desk_line_mentions']];
  var PLACE = load('place', null); // your layout: { cards: { id: [x, y, w] }, labels: { section: [x, y, w] } }

  function savePlace() { save('place', PLACE); }
  function snap(v) { return Math.max(0, Math.round(v / GRID) * GRID); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function deskOn() { return S.view === 'desk' && !!$('.plane'); }

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

  // Layout coordinates inside the plane: offsets, which a zoom transform does not change.
  function planeBox(el, plane) {
    var x = 0;
    var y = 0;
    for (var n = el; n && n !== plane; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    return { l: x, t: y, r: x + el.offsetWidth, b: y + el.offsetHeight };
  }

  // Each card's box, and for the rule layout each column's bounds and the open
  // gaps between its cards, where a line may cross without touching a card.
  function measureDesk(plane) {
    var cols = [];
    var rect = {};
    // A column is a lane of cards one above the other: a section's cards, or one of the
    // sheets that lie side by side before them.
    $$('.shelf', plane).forEach(function (sh) {
      if (sh.hidden) return;
      $$('.sheets > .card, .slots', sh).forEach(function (lane) {
        var els = lane.classList.contains('card') ? (lane.hidden ? [] : [lane]) : $$('.card:not([hidden])', lane);
        if (!els.length) return;
        var col = { k: cols.length, gaps: [] };
        if (!PLACE) {
          var lb = planeBox(lane, plane);
          col.l = lb.l;
          col.r = lb.r;
        }
        var prev = PLACE ? 0 : planeBox(lane, plane).t - 4;
        els.forEach(function (el) {
          var r = planeBox(el, plane);
          var top = el.querySelector('.tab') ? r.t - TAB_H : r.t;
          if (!PLACE && top - prev >= 6) col.gaps.push({ y0: prev, y1: top, used: 0 });
          prev = r.b;
          r.col = PLACE ? -1 : col.k;
          rect[el.dataset.id] = r;
        });
        col.gaps.push({ y0: prev, y1: prev + 40, used: 0 });
        cols.push(col);
      });
    });
    return { cols: cols, rect: rect, free: !!PLACE };
  }

  // Which sides a line leaves and enters: 'r' or 'l'.
  function sidesOf(a, b, free) {
    if (free) {
      if (b.l >= a.r + 16) return ['r', 'l'];
      if (b.r <= a.l - 16) return ['l', 'r'];
      return ['r', 'r'];
    }
    if (a.col === b.col) return ['r', 'r'];
    return a.col < b.col ? ['r', 'l'] : ['l', 'r'];
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

  // The end of a line, at (x, y); s points back along the line (+1: it comes from the right).
  // k scales the end so it keeps its size on screen when the desk is zoomed out.
  function tipD(type, x, y, s, k) {
    k = k || 1;
    var a = 4.5 * k;
    if (type === 'needs') return 'M' + x + ',' + y + ' L' + (x + 8 * k * s) + ',' + (y - a) + ' L' + (x + 8 * k * s) + ',' + (y + a) + ' Z';
    if (type === 'option') return 'M' + x + ',' + y + ' L' + (x + 6 * k * s) + ',' + (y - a) + ' L' + (x + 12 * k * s) + ',' + y + ' L' + (x + 6 * k * s) + ',' + (y + a) + ' Z';
    if (type === 'mentions') { var r = 2.5 * k; return 'M' + (x + 3 * k * s - r) + ',' + y + ' a' + r + ',' + r + ' 0 1,0 ' + 2 * r + ',0 a' + r + ',' + r + ' 0 1,0 ' + -2 * r + ',0'; }
    return 'M' + (x + 6 * k * s) + ',' + (y - 4 * k) + ' L' + x + ',' + y + ' L' + (x + 6 * k * s) + ',' + (y + 4 * k);
  }
  function tipScale() { return clamp(1 / (S.scale || 1), 1, 3); }

  function wireD(w, m) {
    var a = m.rect[w.a];
    var b = m.rect[w.b];
    var ya = a.t + w.ya;
    var yb = b.t + w.yb;
    var sd = sidesOf(a, b, m.free);
    var x = sd[0] === 'r' ? a.r : a.l;
    var tx = sd[1] === 'r' ? b.r : b.l;
    var s = sd[1] === 'r' ? 1 : -1;
    var k = tipScale();
    var ex = tx + TIP_INSET[w.type] * k * s; // the line stops where the end shape starts
    var d = 'M' + x + ',' + ya;
    if (sd[0] === sd[1]) {
      // Same side: an arc in the gutter, wider for longer spans.
      var bend = Math.min(44, 16 + Math.abs(yb - ya) * 0.08) * s;
      d += ' C' + (x + bend) + ',' + ya + ' ' + (ex + bend) + ',' + yb + ' ' + ex + ',' + yb;
    } else {
      var y = ya;
      if (!m.free) {
        var fwd = a.col < b.col;
        for (var c = a.col + (fwd ? 1 : -1); c !== b.col; c += fwd ? 1 : -1) {
          var col = m.cols[c];
          var cy = crossing(col, ya + (yb - ya) * (c - a.col) / (b.col - a.col));
          var inX = fwd ? col.l : col.r;
          var outX = fwd ? col.r : col.l;
          var dx = (inX - x) / 2;
          // The run across a column lies in a gap, so it touches no card and stays solid.
          d += ' C' + (x + dx) + ',' + y + ' ' + (inX - dx) + ',' + cy + ' ' + inX + ',' + cy + ' L' + outX + ',' + cy;
          x = outX;
          y = cy;
        }
      }
      var dx2 = (ex - x) / 2;
      d += ' C' + (x + dx2) + ',' + y + ' ' + (ex - dx2) + ',' + yb + ' ' + ex + ',' + yb;
    }
    return { line: d, tip: tipD(w.type, tx, yb, s, k) };
  }

  function drawWires() {
    var svg = $('.wires');
    if (!svg) return;
    if (!deskOn()) { if (svg.innerHTML) svg.innerHTML = ''; return; }
    var plane = $('.plane');
    var m = measureDesk(plane);
    var lit = S.focus;
    var list = wireList().filter(function (w) {
      if (!m.rect[w.a] || !m.rect[w.b]) return false;
      return w.type !== 'mentions' || lit === w.a || lit === w.b;
    });
    // Ends that meet one side of one card spread out along its address line,
    // 14px apart in the order of their far ends, so end shapes never overlap.
    var sides = {};
    function side(id, which, w, end) { (sides[id + ' ' + which] || (sides[id + ' ' + which] = [])).push({ w: w, end: end }); }
    list.forEach(function (w) {
      var sd = sidesOf(m.rect[w.a], m.rect[w.b], m.free);
      side(w.a, sd[0], w, 'ya');
      side(w.b, sd[1], w, 'yb');
    });
    Object.keys(sides).forEach(function (k) {
      var ends = sides[k];
      var r = m.rect[k.split(' ')[0]];
      ends.sort(function (p, q) {
        var po = m.rect[p.end === 'ya' ? p.w.b : p.w.a];
        var qo = m.rect[q.end === 'ya' ? q.w.b : q.w.a];
        return po.t - qo.t;
      });
      var low = r.b - r.t - 8;
      ends.forEach(function (e, i) { e.w[e.end] = Math.min(low, Math.max(8, WIRE_Y + (i - (ends.length - 1) / 2) * 14)); });
    });
    // Size the layer to the plane without itself, or an old, larger layer keeps the plane wide.
    svg.setAttribute('width', 0);
    svg.setAttribute('height', 0);
    var w = plane.scrollWidth;
    var h = plane.scrollHeight;
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    var lines = list.map(function (wi) {
      var on = lit === wi.a || lit === wi.b;
      var hot = S.hover && (S.hover === wi.a || S.hover === wi.b);
      var g = wireD(wi, m);
      return '<g class="wire w-' + wi.type + (on ? ' on' : '') + (hot ? ' hot' : '') + '" data-a="' + esc(wi.a) + '" data-b="' + esc(wi.b) + '">' +
        '<path class="ln" d="' + g.line + '"/><path class="tip" d="' + g.tip + '"/></g>';
    }).join('');
    // On your own layout a line cannot always go around a card. The lines lie
    // above the cards there, faint where they cross one, so a line never seems
    // to end at a card it does not link.
    if (m.free) {
      var holes = Object.keys(m.rect).map(function (id) { var r = m.rect[id]; return '<rect class="hole" x="' + r.l + '" y="' + r.t + '" width="' + (r.r - r.l) + '" height="' + (r.b - r.t) + '"/>'; }).join('');
      lines = '<defs><mask id="wire-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="' + w + '" height="' + h + '"><rect class="all" width="' + w + '" height="' + h + '"/>' + holes + '</mask></defs><g mask="url(#wire-mask)">' + lines + '</g>';
    }
    svg.innerHTML = lines;
  }

  // ---- your layout ----

  function setBox(el, p) { el.style.left = p[0] + 'px'; el.style.top = p[1] + 'px'; el.style.width = p[2] + 'px'; }
  function clearBox(el) { el.style.left = el.style.top = el.style.width = el.style.zIndex = ''; }

  // The first move freezes the rule layout as it stands: nothing jumps. What a filter hides
  // has no place yet; it gets one when it shows (applyPlace), on the map in a frame of its group.
  function freeze() {
    var plane = $('.plane');
    var place = { cards: {}, labels: {} };
    $$('.card', plane).forEach(function (el) {
      if (el.hidden) return;
      var r = planeBox(el, plane);
      place.cards[el.dataset.id] = [r.l, r.t, el.offsetWidth];
    });
    $$('.shelf-top', plane).forEach(function (el) {
      var sh = el.closest('.shelf');
      if (sh.hidden || MAP) return;
      var r = planeBox(el, plane);
      place.labels[sh.dataset.section] = [r.l, r.t, el.offsetWidth];
    });
    // On the map each named group keeps the frame it has now, and the names you gave.
    if (MAP) {
      place.frames = {};
      place.names = (PLACE && PLACE.names) || {};
      frameBoxes(plane).forEach(function (f) { place.frames[f.id] = f.box.slice(); });
    }
    PLACE = place;
    savePlace();
    layoutDesk();
  }

  function applyPlace(plane) {
    var right = 0;
    var bottom = 0;
    var grow = function (el, p) { right = Math.max(right, p[0] + p[2]); bottom = Math.max(bottom, p[1] + el.offsetHeight); };
    var waiting = [];
    var order = Object.keys(PLACE.cards);
    $$('.card', plane).forEach(function (el) {
      var p = PLACE.cards[el.dataset.id];
      if (!p) { if (!el.hidden) waiting.push(el); return; }
      setBox(el, p);
      el.style.zIndex = String(1 + order.indexOf(el.dataset.id));
      if (!el.hidden) grow(el, p);
    });
    $$('.shelf-top', plane).forEach(function (el) {
      var p = PLACE.labels[el.closest('.shelf').dataset.section];
      el.classList.toggle('stray', !p);
      if (p) { setBox(el, p); grow(el, p); }
    });
    // A card the agent added since you arranged the table goes to a column of
    // its own at the right, so nothing you placed moves.
    if (MAP) {
      PLACE.frames = PLACE.frames || {};
      Object.keys(PLACE.frames).forEach(function (id) { var f = PLACE.frames[id]; right = Math.max(right, f[0] + f[2]); bottom = Math.max(bottom, f[1] + f[3]); });
      waiting = mapWaiting(waiting, right, grow);
      if (!waiting.length) savePlace();
      Object.keys(PLACE.frames).forEach(function (id) { var f = PLACE.frames[id]; right = Math.max(right, f[0] + f[2]); bottom = Math.max(bottom, f[1] + f[3]); });
    }
    if (waiting.length) {
      var x = snap(right + GRID * 4);
      var y = GRID * 2;
      waiting.forEach(function (el) {
        var p = [x, y, el.classList.contains('sheet') ? sheetWidth(el) : 288];
        PLACE.cards[el.dataset.id] = p;
        setBox(el, p);
        grow(el, p);
        y = snap(y + el.offsetHeight + GRID * 2);
      });
      savePlace();
    }
    // While a card is being sized the plane keeps the size it had: a plane that changed its
    // width under a centred or fitted desk would move the card's edge away from the pointer.
    // The card may reach over the plane's edge until you let go.
    var w = right + GRID * 3;
    var h = bottom + GRID * 3;
    if (S.holding && plane.style.width) { w = parseFloat(plane.style.width) || w; h = parseFloat(plane.style.height) || h; }
    plane.style.width = w + 'px';
    plane.style.height = h + 'px';
  }

  // A sheet is as wide as its drawing needs: its own width on the desk, and the most you can drag it to.
  // A done sheet lies back as one line, as narrow as a card.
  function sheetWidth(el) {
    if (el.dataset.status === 'done' && !el.classList.contains('open')) return 288;
    return Math.max(288, parseFloat(getComputedStyle(el).getPropertyValue('--sheet-w')) || 0);
  }

  function nudge(id, key) {
    var p = PLACE && PLACE.cards[id];
    if (!p) return;
    if (key === 'ArrowLeft') p[0] = Math.max(0, p[0] - GRID);
    if (key === 'ArrowRight') p[0] += GRID;
    if (key === 'ArrowUp') p[1] = Math.max(GRID, p[1] - GRID);
    if (key === 'ArrowDown') p[1] += GRID;
    savePlace();
    layoutDesk();
    reveal(id);
  }

  function arrange() {
    if (!PLACE) return;
    var before = PLACE;
    PLACE = null;
    savePlace();
    layoutDesk();
    toast(t(MAP ? 'map_arranged' : 'desk_arranged'), t('undo'), function () { PLACE = before; savePlace(); layoutDesk(); }, 8000);
  }

  // ---- zoom ----

  function deskBox() { return $('.shelves'); }
  function padY(box) {
    var cs = getComputedStyle(box);
    return parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  }
  // Fit shows the whole board with empty table around it. Claim is the map
  // level: there Fit always shows every card, however small, and a click on a
  // card zooms to it. Gist and Full are for reading: there Fit never goes
  // below a readable size; a board too tall fits the window's width instead
  // and the table scrolls down.
  var READABLE = 0.5;  // below this a claim is under 8px
  var TABLE = 0.84;    // the cards take this share of each side: about 30% of the table stays empty
  function fitParts() {
    var box = deskBox();
    var plane = $('.plane');
    var r = box.getBoundingClientRect();
    var cs = getComputedStyle(box);
    var w = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var h = r.height - padY(box);
    return { wide: TABLE * w / plane.offsetWidth, all: TABLE * Math.min(w / plane.offsetWidth, h / plane.offsetHeight) };
  }
  function fitScale() {
    var f = fitParts();
    return clamp(S.alt === 'claim' || f.all >= READABLE ? f.all : Math.max(f.wide, READABLE), 0.15, 1);
  }
  // The first view of a board, when you have not picked a level for the desk:
  // Gist if every section then fits the window's width and the board is at
  // most two windows tall; else Claim, the whole board at once, each card
  // with its claim and its picture.
  function firstView() {
    if (deskAltSet || ASKED.alt || !deskOn()) return;
    deskAltSet = 'auto';
    var box = deskBox();
    var big = fitParts().wide < READABLE || $('.plane').offsetHeight * fitScale() > 2 * (box.clientHeight - padY(box));
    if (S.alt === 'gist' && big) { S.alt = S.alts.desk = 'claim'; applyView(); }
  }
  function syncSizer() {
    var plane = $('.plane');
    var sizer = $('.sizer');
    if (!plane || !sizer) return;
    plane.style.transform = S.scale === 1 ? '' : 'scale(' + S.scale + ')';
    sizer.style.width = Math.ceil(plane.offsetWidth * S.scale) + 'px';
    sizer.style.height = Math.ceil(plane.offsetHeight * S.scale) + 'px';
  }
  // Where the zoomed plane starts inside the desk's scroll area: the frame's
  // padding, and the margin that centers a plane narrower than the frame.
  function planeOrigin() {
    var sizer = $('.sizer');
    return [sizer.offsetLeft, sizer.offsetTop];
  }
  // Scale the table; the plane point at (ax, ay) in the desk's view stays put.
  function setScale(z, ax, ay) {
    var box = deskBox();
    var old = S.scale;
    if (ax === undefined) { ax = box.clientWidth / 2; ay = box.clientHeight / 2; }
    var o = planeOrigin();
    var px = (box.scrollLeft + ax - o[0]) / old;
    var py = (box.scrollTop + ay - o[1]) / old;
    S.scale = S.target = clamp(z, 0.15, 2);
    syncSizer();
    o = planeOrigin();
    box.scrollLeft = o[0] + px * S.scale - ax;
    box.scrollTop = o[1] + py * S.scale - ay;
    updateDeskBar();
    scheduleWires();
  }
  var anim = 0;
  function animateTo(z, left, top) {
    var box = deskBox();
    cancelAnimationFrame(anim);
    S.target = z;
    S.animating = true;
    updateDeskBar(); // the buttons show where the zoom is going, at once
    var z0 = S.scale;
    var l0 = box.scrollLeft;
    var t0 = box.scrollTop;
    var t = 0;
    var dur = reduced ? 0 : 260;
    var start = performance.now();
    function frame(now) {
      t = dur ? Math.min(1, (now - start) / dur) : 1;
      var e = 1 - Math.pow(1 - t, 3);
      S.scale = z0 * Math.pow(z / z0, e);
      syncSizer();
      box.scrollLeft = l0 + (left - l0) * e;
      box.scrollTop = t0 + (top - t0) * e;
      if (t < 1) anim = requestAnimationFrame(frame);
      else { S.animating = false; updateDeskBar(); drawWires(); }
    }
    if (dur) anim = requestAnimationFrame(frame); else frame(start);
  }
  function setZoom(p) {
    S.back = null;
    S.zoom = p;
    save('zoom', p);
    var box = deskBox();
    var z = p === 'fit' ? fitScale() : p;
    if (p === 'fit') { animateTo(z, 0, 0); return; }
    var o = planeOrigin();
    var cx = (box.scrollLeft + box.clientWidth / 2 - o[0]) / S.scale;
    var cy = (box.scrollTop + box.clientHeight / 2 - o[1]) / S.scale;
    animateTo(z, o[0] + cx * z - box.clientWidth / 2, o[1] + cy * z - box.clientHeight / 2);
  }
  function cycleZoom() {
    var order = ['fit', 0.5, 1];
    var k = S.back ? 2 : order.indexOf(S.zoom);
    setZoom(order[(k + 1) % order.length]);
  }

  // Focus on the desk: at a small scale, zoom to the card (and remember the
  // way back for Esc); at a readable scale, bring the card into view.
  function reveal(id) {
    var box = deskBox();
    var el = cardEl(id);
    if (!box || !el || el.hidden) return;
    var r = planeBox(el, $('.plane'));
    var z = S.scale;
    var target = z;
    var vw = box.clientWidth;
    var vh = box.clientHeight - padY(box);
    if (z < 0.75) {
      if (!S.back) S.back = { zoom: S.zoom, scale: z, left: box.scrollLeft, top: box.scrollTop };
      target = 1;
    } else {
      var inView = r.l * z >= box.scrollLeft && r.r * z <= box.scrollLeft + vw && r.t * z - TAB_H >= box.scrollTop && Math.min(r.b, r.t + 200) * z <= box.scrollTop + vh;
      if (inView) return;
    }
    var o = planeOrigin();
    var left = ((r.l + r.r) / 2) * target - vw / 2;
    var top = (r.b - r.t) * target > vh - 80 ? (r.t - TAB_H) * target - 24 : ((r.t + r.b) / 2) * target - vh / 2;
    animateTo(target, left + o[0], top + o[1]);
  }
  function goBack() {
    if (!S.back || !deskOn()) return;
    var b = S.back;
    S.back = null;
    S.zoom = b.zoom;
    animateTo(b.zoom === 'fit' ? fitScale() : b.scale, b.left, b.top);
  }

  // ---- peek: a card at reading size, beside the pointer, on a desk zoomed out ----
  //
  // At Fit a card is a thumbnail. Rest the pointer on one and it shows beside itself at
  // reading size, as it reads at Gist. The peek is a picture: it takes no pointer and no
  // focus, and a click, the wheel, a key or the pointer leaving puts it away. A finger has
  // no hover: there a tap reads the card, as before.
  var PEEK_BELOW = 0.75; // under this scale a claim is too small to read (see reveal)
  var peekTimer = 0;
  var peekId = null;
  var hoverNone = window.matchMedia('(hover: none)');
  function hidePeek() {
    clearTimeout(peekTimer);
    peekId = null;
    var el = $('.peek');
    if (el) el.hidden = true;
  }
  function wantPeek(id) {
    if (!id || !deskOn() || S.scale >= PEEK_BELOW || id === S.focus || move || pan || fdrag || size || S.animating || hoverNone.matches) { hidePeek(); return; }
    if (peekId === id) return;
    hidePeek();
    peekId = id;
    peekTimer = setTimeout(function () { showPeek(id); }, 260);
  }
  function showPeek(id) {
    var src = cardEl(id);
    if (!src || src.hidden || peekId !== id) return;
    var el = $('.peek');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    var c = B.cards[id];
    var clone = src.cloneNode(true);
    ['id', 'data-id', 'tabindex', 'aria-labelledby', 'style'].forEach(function (a) { clone.removeAttribute(a); });
    $$('[id]', clone).forEach(function (x) { x.removeAttribute('id'); });
    $$('.acts, .reply, .widen, .context, .history, .thread', clone).forEach(function (x) { x.remove(); });
    $$('input, textarea, button, select, a', clone).forEach(function (x) { x.setAttribute('tabindex', '-1'); });
    ['focused', 'lit', 'moving', 'sizing', 'flash', 'open'].forEach(function (k) { clone.classList.remove(k); });
    el.className = 'peek alt-gist' + (MAP ? ' map' : '');
    el.style.setProperty('--peek-w', (c && c.sheet && c.fig_w ? Math.min(720, Math.max(360, c.fig_w + 34)) : 360) + 'px');
    el.innerHTML = '';
    el.appendChild(clone);
    el.hidden = false;
    // Beside the card, on the side with room; never under the bar at the top or the tools below.
    var r = src.getBoundingClientRect();
    var w = el.offsetWidth;
    var h = el.offsetHeight;
    var top = ($('header.top') || { offsetHeight: 0 }).offsetHeight + 8;
    var low = window.innerHeight - (($('.bar') || { offsetHeight: 0 }).offsetHeight + 24);
    var x = r.right + 12 + w <= window.innerWidth - 8 ? r.right + 12 : r.left - 12 - w >= 8 ? r.left - 12 - w : Math.max(8, (window.innerWidth - w) / 2);
    var y = clamp(r.top, top, Math.max(top, low - h));
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
    el.classList.toggle('cut', el.scrollHeight > el.clientHeight + 1);
  }
  ['pointerdown', 'wheel', 'keydown', 'resize'].forEach(function (ev) { window.addEventListener(ev, hidePeek, { capture: true, passive: true }); });

  // ---- the desk bar: line key, zoom, arrange ----

  function legendHtml() {
    return (MAP ? MAP_LEGEND : LEGEND).map(function (l) {
      var s = -1;
      var x = 30;
      return '<span class="lg"><svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><g class="wire w-' + l[0] + '">' +
        '<path class="ln" d="M2,6 L' + (x + TIP_INSET[l[0]] * s) + ',6"/><path class="tip" d="' + tipD(l[0], x, 6, s) + '"/></g></svg>' + esc(t(l[1])) + '</span>';
    }).join('');
  }
  function deskBarHtml() {
    return '<div class="desk-bar"><div class="legend" role="note" aria-label="' + esc(t('desk_legend_label')) + '">' + legendHtml() + '</div>' +
      '<div class="desk-tools"><span class="zoom-now"></span>' +
      '<div class="seg seg-zoom" role="group" aria-label="' + esc(t('desk_zoom_label')) + '">' +
      '<button data-zoom="fit" title="' + esc(t('desk_fit_title')) + '">' + esc(t('desk_fit')) + '</button><button data-zoom="0.5">50%</button><button data-zoom="1">100%</button></div>' +
      (MAP ? '<button class="btn" data-act="new-group" title="' + esc(t('frame_new_title')) + '">' + esc(t('frame_new')) + '</button>' : '') +
      '<button class="btn" data-act="arrange">' + esc(t('desk_arrange')) + '</button></div></div>';
  }
  function updateDeskBar() {
    var now = $('.zoom-now');
    if (!now) return;
    // The scale in numbers, when no preset button already says it.
    var preset = !S.back && (S.zoom === 0.5 || S.zoom === 1);
    var target = S.target === undefined ? S.scale : S.target;
    now.textContent = preset ? '' : Math.round(target * 100) + '%';
    $$('[data-zoom]').forEach(function (b) {
      var v = b.dataset.zoom === 'fit' ? 'fit' : +b.dataset.zoom;
      var on = v === 'fit' ? S.zoom === 'fit' && !S.back : S.back ? Math.abs(target - v) < 0.01 : S.zoom === v;
      b.setAttribute('aria-pressed', String(on));
    });
    var ar = $('[data-act="arrange"]');
    ar.disabled = !PLACE;
    ar.title = t(PLACE ? (MAP ? 'map_arrange_title' : 'desk_arrange_title') : (MAP ? 'map_arrange_off_title' : 'desk_arrange_off_title'));
  }

  // Lay the desk out: your places or the rule, then the scale, then the lines.
  function layoutDesk() {
    var plane = $('.plane');
    if (!plane) return;
    var root = $('.board');
    var desk = S.view === 'desk';
    root.classList.toggle('free', desk && !!PLACE);
    if (!desk) return;
    if (PLACE) applyPlace(plane);
    else {
      $$('.card, .shelf-top', plane).forEach(clearBox);
      plane.style.width = plane.style.height = '';
    }
    // A running zoom animation owns the scale until it ends; so does a card that is being sized.
    if (S.holding) { /* keep the scale */ }
    else if (!S.animating && !S.back && S.zoom === 'fit') S.scale = S.target = fitScale();
    else if (!S.animating && !S.back) S.scale = S.target = S.zoom;
    syncSizer();
    drawFrames();
    drawWires();
    updateDeskBar();
  }

  // Lines and the fit follow the cards: any change in a card's size redraws them.
  var sizeWatch = window.ResizeObserver ? new ResizeObserver(function () { scheduleWires(); }) : null;
  var wireFrame = 0;
  function scheduleWires() {
    if (wireFrame) return;
    wireFrame = requestAnimationFrame(function () { wireFrame = 0; if (deskOn()) layoutDesk(); });
  }
  // A table that is wider than its card shows each row as a block (board.css, .table.stacked).
  // Its own width is measured once, as a table, and kept: the card may get wider again.
  // The change is made in the next frame, not inside the observer's own call: a change of layout
  // there is one the observer cannot deliver, and WebKit reports that as an error of the page.
  var tableQueue = new Set();
  var tableFrame = 0;
  var tableWatch = window.ResizeObserver ? new ResizeObserver(function (entries) {
    entries.forEach(function (en) { tableQueue.add(en.target); });
    if (tableFrame) return;
    tableFrame = requestAnimationFrame(function () {
      tableFrame = 0;
      var todo = Array.from(tableQueue);
      tableQueue.clear();
      todo.forEach(function (wrap) { if (wrap.isConnected) fitTable(wrap); });
    });
  }) : null;
  function fitTable(wrap) {
    var room = wrap.clientWidth;
    if (!room) return; // not shown at this level
    var table = wrap.firstElementChild;
    if (!wrap.dataset.own) {
      // The width the table reads well at: each column about 16 characters, or less when the whole
      // table is shorter than that, and never less than its longest words need.
      wrap.classList.remove('stacked');
      table.style.width = '0';
      var least = table.offsetWidth;
      table.style.width = 'max-content';
      var most = table.offsetWidth;
      table.style.width = '';
      wrap.dataset.own = String(Math.min(most, Math.max(least, 120 * (+wrap.dataset.cols || 1))));
    }
    // Rows become blocks only where the columns have names to put on the fields.
    var stack = +wrap.dataset.own > room + 1 && !!table.tHead;
    if (stack !== wrap.classList.contains('stacked')) wrap.classList.toggle('stacked', stack);
  }
  function fitTables(root) {
    $$('.table', root || document).forEach(function (wrap) {
      if (tableWatch) tableWatch.observe(wrap);
      fitTable(wrap);
    });
  }

  function watchSizes() {
    if (tableWatch) tableWatch.disconnect();
    fitTables();
    var bar = $('.bar');
    if (bar) document.documentElement.style.setProperty('--bar-h', bar.offsetHeight + 'px');
    // The bar at the top: a card the keys bring into view stops under it, at every width.
    var top = $('header.top');
    if (top) document.documentElement.style.setProperty('--top-h', top.offsetHeight + 'px');
    if (packWatch) {
      packWatch.disconnect();
      if (S.view === 'rack') $$('.slots[data-layout="grid"], .slots[data-layout="grid"] > .card').forEach(function (el) { packWatch.observe(el); });
    }
    if (!sizeWatch) return;
    sizeWatch.disconnect();
    if (S.view !== 'desk') return;
    $$('.shelves, .shelves .card').forEach(function (el) { sizeWatch.observe(el); });
  }
  function setHover(id) {
    if (S.view !== 'desk' || S.hover === id) return;
    S.hover = id;
    $$('.wires .wire').forEach(function (p) { p.classList.toggle('hot', !!id && (p.dataset.a === id || p.dataset.b === id)); });
  }
  function setAlt(a) {
    S.alt = S.alts[S.view] = a;
    if (S.view === 'desk') deskAltSet = a;
    save(S.view === 'desk' ? 'deskAlt' : 'alt', a);
    applyView();
    if (S.focus && S.view === 'desk') reveal(S.focus);
  }
  function toggleDesk() {
    S.view = S.view === 'desk' ? 'rack' : 'desk';
    S.alt = S.alts[S.view];
    S.hover = null;
    S.back = null;
    save('view', S.view);
    render();
    firstView();
    if (S.focus && cardEl(S.focus)) {
      cardEl(S.focus).focus({ preventScroll: true });
      if (S.view === 'desk') reveal(S.focus); else cardEl(S.focus).scrollIntoView({ block: 'nearest' });
    }
  }

  // ---- full screen ----
  //
  // The board takes the whole screen: the header folds to one line (whose
  // turn, the title, the ask tabs), the rack drops its width limit, and the
  // desk gets the height. Where the browser allows it, the page also asks for
  // the real full screen; where it does not (a phone), the board still fills
  // its window. Leaving the browser's full screen (Esc, a gesture) leaves this
  // mode too. Nothing is kept: a browser enters full screen only on a press.
  // A board in a frame (?embed) has no switch: the page around it owns the screen.
  var screenApi = false; // true while the browser's own full screen is ours
  function screenAllowed() { return !ASKED.embed; }
  function setScreen(on) {
    if (on === S.screen) return;
    S.screen = on;
    var el = document.documentElement;
    if (on && document.fullscreenEnabled && !document.fullscreenElement && el.requestFullscreen) {
      screenApi = true;
      try { var p = el.requestFullscreen(); if (p && p.catch) p.catch(function () { screenApi = false; }); } catch (e) { screenApi = false; }
    }
    if (!on && screenApi && document.fullscreenElement) { screenApi = false; document.exitFullscreen().catch(function () { /* already out */ }); }
    applyView();
    watchSizes();
    if (S.view === 'desk') scheduleWires();
  }
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && screenApi) { screenApi = false; setScreen(false); }
  });

  // ---- the chat with the agent: a box in the bottom-right corner ----
  //
  // A message goes now, as its own round, not with the card answers. The
  // agent answers with `cards say`. The thread shows your rounds, the
  // agent's messages and each revision it published, in time order. Without
  // a server there is no channel: Send copies the message for you to paste.

  var pendingChat = null;
  var chatSeen = load('chatSeen', '');
  function agentUnread() {
    return (B.chat || []).filter(function (m) { return m.who === 'agent' && m.at > chatSeen; }).length;
  }
  // A date or time in the board's language; an invalid tag falls back to the browser's.
  function localized(d, method, opts) {
    try { return d[method](B.board.lang || [], opts); } catch (e) { return d[method]([], opts); }
  }
  function clock(at) {
    var d = new Date(at);
    if (isNaN(d)) return '';
    var time = localized(d, 'toLocaleTimeString', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? time : localized(d, 'toLocaleDateString', { month: 'short', day: 'numeric' }) + ' ' + time;
  }
  function chatThreadHtml() {
    var items = (B.chat || []).map(function (m) {
      if (m.who === 'board') {
        var sys = [m.to && m.to !== m.from ? t('chat_published_span', { from: m.from, to: m.to }) : t('chat_published', { rev: m.to || m.rev })];
        if (m.cards) sys.push(t('chat_card_changes', { n: m.cards }));
        sys.push(clock(m.at));
        return '<li class="sys">' + esc(sys.join(' · ')) + '</li>';
      }
      if (m.who === 'agent') return '<li class="msg agent"><p>' + esc(m.text) + '</p><span class="meta">' + esc(t('chat_agent') + ' · ' + clock(m.at)) + '</span></li>';
      // A round with a message shows it; a round of card answers alone is one line.
      var meta = [t(m.text ? 'chat_round' : 'chat_you_sent_round', { round: m.round })];
      if (m.responses) meta.push(t('chat_responses', { n: m.responses }));
      meta.push(t(m.read ? 'chat_read' : 'chat_sent'), clock(m.at));
      return m.text
        ? '<li class="msg you"><p>' + esc(m.text) + '</p><span class="meta">' + esc(meta.join(' · ')) + '</span></li>'
        : '<li class="sys">' + esc(meta.join(' · ')) + '</li>';
    });
    (D.chatCopied || []).forEach(function (m) {
      items.push('<li class="msg you"><p>' + esc(m.text) + '</p><span class="meta">' + esc(t('chat_copied') + ' · ' + clock(m.at)) + '</span></li>');
    });
    // Comments that wait for Send (no server), and those copied with the last reply.
    (D.comments || []).forEach(function (m, k) {
      items.push('<li class="msg you pending"><p>' + esc(m.text) + '</p><span class="meta">' + esc(t(D.sentRev ? 'chat_copied' : 'chat_pending') + ' · ' + clock(m.at)) +
        (D.sentRev ? '' : ' <button class="link" data-act="chat-remove" data-k="' + k + '">' + esc(t('chat_remove')) + '</button>') + '</span></li>');
    });
    if (pendingChat) {
      items.push('<li class="msg you"><p>' + esc(pendingChat.text) + '</p><span class="meta">' + esc(t('send_sending')) + ' <button class="link" data-act="chat-undo">' + esc(t('undo')) + '</button></span></li>');
    }
    if (!items.length) {
      items.push('<li class="sys">' + esc(t('chat_empty')) + '</li>');
    }
    return items.join('');
  }
  function chatHtml() {
    if (ASKED.embed) return '';
    if (!S.chatOpen) {
      var n = agentUnread();
      return '<aside class="chat" aria-label="' + esc(t('chat_label')) + '"><button class="chat-pill" data-act="chat" aria-expanded="false" title="' + esc(t('chat_message_title')) + '">' +
        esc(t('chat_message')) + (n ? '<i class="dot" title="' + esc(t('chat_unread', { n: n })) + '"></i>' : '') + '</button></aside>';
    }
    var now = turn();
    return '<aside class="chat open" aria-label="' + esc(t('chat_label')) + '"><section class="chat-panel">' +
      '<div class="chat-head"><b>' + esc(t('chat_message')) + '</b><span>' + esc(now.text) + '</span><button class="btn" data-act="chat" title="' + esc(t('chat_close_title')) + '">' + esc(t('close')) + '</button></div>' +
      '<ol class="chat-thread" aria-live="polite">' + chatThreadHtml() + '</ol>' +
      '<div class="chat-compose"><textarea data-field="note" rows="2" placeholder="' + esc(t('chat_placeholder')) + '" aria-label="' + esc(t('chat_placeholder')) + '">' + esc(D.note || '') + '</textarea>' +
      '<button class="send" data-act="chat-send" title="' + esc(t(B.live ? 'chat_send_title' : 'chat_add_title')) + '">' + esc(t('chat_post')) + '</button></div>' +
      '<p class="chat-hint">' + esc(t(B.live ? 'chat_hint_live' : 'chat_hint_static')) + '</p>' +
      '</section></aside>';
  }
  function scrollThread() { var th = $('.chat-thread'); if (th) th.scrollTop = th.scrollHeight; }
  function markChatSeen() {
    var last = (B.chat || []).filter(function (m) { return m.who === 'agent'; }).pop();
    if (last && last.at > chatSeen) { chatSeen = last.at; save('chatSeen', chatSeen); }
  }
  function renderChat() {
    var dock = $('.chat');
    var ta = $('.chat textarea');
    var typing = ta && document.activeElement === ta;
    // While you type, only the thread changes, so the draft and the caret stay.
    if (S.chatOpen && typing) { $('.chat-thread').innerHTML = chatThreadHtml(); scrollThread(); markChatSeen(); return; }
    if (dock) dock.outerHTML = chatHtml();
    if (S.chatOpen) { scrollThread(); markChatSeen(); }
  }
  function toggleChat(open) {
    S.chatOpen = open === undefined ? !S.chatOpen : open;
    renderChat();
    if (S.chatOpen) { var t = $('.chat textarea'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
    else { var pill = $('.chat-pill'); if (pill) pill.focus({ preventScroll: true }); }
  }
  function chatSend() {
    var text = (D.note || '').trim();
    if (!text || pendingChat) return;
    // No server: the comment waits in this browser and goes with Send, with your card answers.
    if (!B.live) {
      D.comments = (D.comments || []).concat([{ at: new Date().toISOString(), text: text }]);
      D.note = '';
      touchDrafts();
      renderChat();
      applyView();
      var box = $('.chat textarea');
      if (box) { box.value = ''; box.focus(); }
      return;
    }
    // Undo over confirmation, as with Send: the message leaves after a short hold.
    pendingChat = { text: text, timer: setTimeout(postChat, UNDO_MS) };
    D.note = '';
    saveDrafts();
    renderChat();
    var ta = $('.chat textarea');
    if (ta) { ta.value = ''; ta.focus(); }
  }
  function removeComment(k) {
    if (!D.comments || !D.comments[k]) return;
    D.comments.splice(k, 1);
    touchDrafts();
    renderChat();
    applyView();
  }
  function chatUndo() {
    if (!pendingChat) return;
    clearTimeout(pendingChat.timer);
    D.note = pendingChat.text + (D.note ? '\n' + D.note : '');
    pendingChat = null;
    saveDrafts();
    S.chatOpen = true;
    renderChat();
    var ta = $('.chat textarea');
    if (ta) { ta.value = D.note; ta.focus(); }
  }
  function postChat() {
    var p = pendingChat;
    if (!p) return;
    fetch('/api/' + encodeURIComponent(ID) + '/send', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: B.token, rev: B.board.rev, items: [{ kind: 'note', text: p.text }] }),
    }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; });
    }).then(function () {
      pendingChat = null;
      renderChat();
      return refresh();
    }).catch(function (e) {
      pendingChat = null;
      D.note = p.text + (D.note ? '\n' + D.note : '');
      saveDrafts();
      renderChat();
      toast(t('chat_not_sent', { error: e.message }));
    });
  }

  function refreshCard(id) {
    var el = cardEl(id);
    if (!el) return;
    var s = B.sections.filter(function (x) { return x.id === B.cards[id].section; })[0];
    var keys = s && s.layout === 'compare' ? factKeys(s.cards) : null;
    var wasFocus = document.activeElement === el;
    // The control you just used is drawn again with the card: find it again, so
    // the keyboard stays where it was and Tab goes on from there.
    var act = el.contains(document.activeElement) ? document.activeElement : null;
    var again = !act || act === el ? null
      : act.matches('[data-opt]') ? 'input[data-opt][value="' + String(act.value).replace(/["\\]/g, '\\$&') + '"]'
      : act.dataset.approve ? '[data-approve="' + act.dataset.approve + '"]'
      : act.dataset.done ? '[data-done="' + act.dataset.done + '"]'
      : act.dataset.mark ? '[data-mark="' + act.dataset.mark + '"]'
      : act.dataset.act ? '[data-act="' + act.dataset.act + '"]' : null;
    el.outerHTML = cardHtml(B.cards[id], keys);
    if (B.cards[id].ask) refreshGated(id);
    applyView();
    watchSizes();
    var back = again && cardEl(id).querySelector(again);
    if (back && !back.disabled) back.focus({ preventScroll: true });
    else if (wasFocus || act) cardEl(id).focus({ preventScroll: true });
  }
  // An answer on one ask opens, locks or holds the asks that need it: draw
  // those again. A card you are typing in is left alone.
  function refreshGated(except) {
    cards().forEach(function (c) {
      var el = cardEl(c.id);
      if (c.id === except || !isOpenAsk(c) || !c.needs.length || !el || el.contains(document.activeElement) && typingTarget(document.activeElement)) return;
      var s = B.sections.filter(function (x) { return x.id === c.section; })[0];
      el.outerHTML = cardHtml(c, s && s.layout === 'compare' ? factKeys(s.cards) : null);
    });
  }

  // ---------- the bar: the menu of boards, About, the stepper ----------

  function toggleSwitcher(open) {
    var btn = $('[data-act="switch"]');
    var menu = $('#switch-menu');
    if (!btn || !menu) return;
    var on = open === undefined ? menu.hidden : open;
    menu.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    if (on) {
      var here = menu.querySelector('[aria-current="page"]') || menu.querySelector('[role="menuitem"]');
      (menu.querySelector('a[role="menuitem"]') || here).focus();
      if (here && here.scrollIntoView) here.scrollIntoView({ block: 'nearest' });
    }
  }
  function closeSwitcher() {
    var menu = $('#switch-menu');
    if (menu && !menu.hidden) toggleSwitcher(false);
  }
  // About: what the board is about. Under the bar on the rack; behind this button on the desk.
  function toggleInfo() {
    S.info = !S.info;
    var intro = $('#intro');
    if (intro) intro.classList.toggle('open', S.info);
    var b = $('[data-act="info"]');
    if (b) b.setAttribute('aria-expanded', String(S.info));
  }
  // The stepper says which card is in focus, of the cards shown: "12 · 4 of 25".
  function stepLabel() {
    var el = $('.step-now');
    if (!el) return;
    var list = visibleCards();
    var k = list.findIndex(function (c) { return c.dataset.id === S.focus; });
    var c = S.focus && B.cards[S.focus];
    el.textContent = k >= 0 ? t('step_at', { k: k + 1, n: list.length }) : t('step_none', { n: list.length });
    el.title = c ? (MAP ? c.n : '#' + c.n) + ' ' + c.title_text : '';
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
    if (deskOn()) reveal(id);
    else if (opts.scroll !== false) el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    if (history.replaceState) history.replaceState(null, '', '#c-' + id);
  }
  function clearFocus() {
    S.focus = null;
    applyView();
    goBack();
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
  }
  function visibleCards() { return $$('.card:not([hidden])', app); }
  function step(dir) {
    var list = visibleCards();
    if (!list.length) return;
    var k = list.findIndex(function (el) { return el.dataset.id === S.focus; });
    var next = list[k < 0 ? (dir > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, k + dir))];
    focusCard(next.dataset.id);
  }
  function nextWaiting() {
    var list = $$('.card', app).filter(function (el) { return unsent(B.cards[el.dataset.id]) && !hasDraftAnswer(B.cards[el.dataset.id]); });
    if (!list.length) { toast(t('empty_yours')); return; }
    var k = list.findIndex(function (el) { return el.dataset.id === S.focus; });
    focusCard(list[(k + 1) % list.length].dataset.id, { open: true });
  }

  // ---------- mutations ----------

  function setMark(id, m) {
    var d = draft(id);
    d.mark = d.mark === m ? undefined : m;
    touchDrafts();
    $$('[data-mark]', cardEl(id)).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mark === d.mark)); });
    cardEl(id).querySelector('.stamp').textContent = d.mark ? t(MARK_STAMP[d.mark]) : '';
    applyView();
  }
  function setAside(id) {
    var d = draft(id);
    if (d.aside) delete d.aside;
    else { d.aside = true; delete d.choice; delete d.approve; delete d.done; }
    touchDrafts();
    refreshCard(id);
    refreshGated(id);
  }
  // Every ask that waits on you, at once: for a board whose session ended. Undo puts them back.
  function setAsideAll() {
    var list = cards().filter(function (c) { return unsent(c) && !hasDraftAnswer(c); });
    if (!list.length) return;
    var before = JSON.stringify(D.cards);
    list.forEach(function (c) { draft(c.id).aside = true; });
    touchDrafts();
    render();
    toast(t('aside_all_done', { n: list.length }), t('undo'), function () { D.cards = JSON.parse(before); touchDrafts(); render(); }, 8000);
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
    if (S.sort !== 'board') { toast(t('move_needs_board_order')); return; }
    var el = cardEl(id);
    var sib = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    if (!sib) return;
    el.parentElement.insertBefore(el, dir < 0 ? sib : sib.nextElementSibling);
    commitOrder(el.parentElement);
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }
  function commitOrder(slots) {
    var sh = slots.closest('.shelf');
    // The order of the whole section: its sheets and its cards.
    D.order[sh.dataset.section] = $$('.card', sh).map(function (el) { return el.dataset.id; });
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
    if (!B.live) {
      var batch = { board: { id: ID, title: B.board.title, path: B.board.path }, rev: B.board.rev, at: new Date().toISOString(), items: buildItems(true), pasted: !B.public };
      batch.key = window.cardsReplyKey(batch);
      openCopy(window.cardsDigest(batch, cardIndex()), null, null, batch.key);
      return;
    }
    // Undo over confirmation: the round leaves after a short hold.
    var back = document.activeElement;
    pendingSend = setTimeout(function () { post(); restoreFocus(back); }, UNDO_MS);
    $('[data-act="send"]').disabled = true;
    $('[data-act="send"]').textContent = t('send_sending');
    toast(t('send_round', { round: B.sends.length + 1 }), t('undo'), function () { undoSend(); restoreFocus(back); }, UNDO_MS);
    var u = $('.toast button');
    if (u) u.focus();
  }

  function undoSend() {
    if (!pendingSend) return;
    clearTimeout(pendingSend);
    pendingSend = null;
    toast(t('send_undone'));
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
      toast(t('send_sent', { round: j.round }));
      return refresh();
    }).catch(function (e) {
      toast(t('send_failed', { error: e.message }));
      applyView();
    });
  }

  function openCopy(text, after, title, key) {
    var dlg = document.createElement('dialog');
    dlg.innerHTML = '<h2>' + esc(title || t('send_copy_title')) + '</h2><p>' + (ASKED.fresh ? esc(t('send_copy_body_sample')) : B.public ? esc(t('send_copy_body_public')) : tHtml('send_copy_body', { ingest: '<code>cards ingest ' + esc(ID) + '</code>', serve: '<code>cards serve</code>' })) + '</p>' +
      '<textarea readonly aria-label="' + esc(t('send_copy_label')) + '">' + esc(text) + '</textarea>' +
      '<div class="row"><button class="btn" data-close>' + esc(t('close')) + '</button><button class="send" data-copy>' + esc(t('copy')) + '</button></div>';
    document.body.appendChild(dlg);
    var ta = dlg.querySelector('textarea');
    function done(msg) {
      dlg.close();
      if (after) { after(msg); return; }
      D.sentRev = B.board.rev;
      D.sentKey = key || '';
      // The board comments went with this reply: they are copied, not waiting, from now on.
      if (D.comments && D.comments.length) {
        D.chatCopied = (D.chatCopied || []).concat(D.comments.map(function (m) { return { at: m.at, text: m.text, key: key || '' }; })).slice(-20);
        D.comments = [];
      }
      renderChat();
      saveDrafts();
      applyView();
      toast(msg);
    }
    function copy() {
      var fallback = function () { ta.select(); try { document.execCommand('copy'); done(t('send_copy_done')); } catch (e) { toast(t('send_copy_failed')); } };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(t('send_copy_done')); }, fallback);
      else fallback();
    }
    dlg.querySelector('[data-copy]').addEventListener('click', copy);
    dlg.querySelector('[data-close]').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('close', function () { dlg.remove(); });
    dlg.showModal();
    ta.select();
  }

  function openHelp() {
    // [the key, as typed; what it does]. Key names stay literal; 'Alt + arrows' names keys in words, so it translates.
    var keys = MAP ? [['j / k', t('keys_step')], ['Enter', t('keys_open_board')], ['Esc', t('keys_clear')], ['n', t('keys_next_waiting')],
      ['1 2 3', t('keys_alt')], ['d', t('keys_desk')], ['Shift + F', t('keys_screen')], ['z', t('keys_zoom')], ['[  ]  0', t('keys_width')], [t('keys_alt_arrows'), t('keys_move')],
      ['/', t('find')], ['f', t('keys_filter')], ['s', t('keys_sort')], ['b', t('keys_boards')]]
      : [['j / k', t('keys_step')], ['Enter', t('keys_open')], ['Esc', t('keys_clear')], ['n', t('keys_next_waiting')],
      ['1 2 3', t('keys_alt')], ['d', t('keys_desk')], ['Shift + F', t('keys_screen')], ['z', t('keys_zoom')], ['[  ]  0', t('keys_width')], ['c', t('chat_message')], ['=  -  m', t('keys_marks')], ['r', t('keys_reply')], [t('keys_alt_arrows'), t('keys_move')],
      ['/', t('find')], ['f', t('keys_filter')], ['s', t('keys_sort')], ['b', t('keys_boards')], ['Ctrl + Enter', t('send')], ['Esc', t('keys_undo_send')]];
    var dlg = document.createElement('dialog');
    var made = B.build ? '<a class="made" href="' + esc(B.build.home) + '" target="_blank" rel="noopener noreferrer">' + esc(t('mark_title', { version: B.build.version })) + '</a>' : '';
    dlg.innerHTML = '<h2>' + esc(t('keys_title')) + '</h2><dl class="keys">' + keys.map(function (k) { return '<dt>' + esc(k[0]) + '</dt><dd>' + esc(k[1]) + '</dd>'; }).join('') + '</dl>' +
      '<div class="row">' + made + '<button class="btn" data-close>' + esc(t('close')) + '</button></div>';
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
        if (r.status === 409) { notice(t('notice_error', { line: j.errors[0].line, msg: j.errors[0].msg, rev: B.board.rev })); return; }
        if (!r.ok) throw new Error(r.status);
        var same = j.board.rev === B.board.rev && j.sends.length === B.sends.length && j.read === B.read;
        var chatMoved = (j.chat || []).length !== (B.chat || []).length;
        if (same && chatMoved) { B.chat = j.chat; renderChat(); notice(''); return; }
        if (same) { notice(''); return; }
        // Never swap data under a card's text box: the DOM would point at cards the
        // data no longer has. The chat box is safe: its draft lives in D.note.
        var act = document.activeElement;
        var typing = act && act.tagName === 'TEXTAREA' && !act.closest('.chat');
        if (typing) { pendingData = j; notice(t('notice_pending')); return; }
        applyData(j);
      });
    }).catch(function () { /* the server went away; the page keeps working as a static board */ });
  }
  function applyData(next) {
    var before = B;
    B = next;
    document.documentElement.lang = B.board.lang || 'en';
    pendingData = null;
    var moved = [];
    Object.keys(B.cards).forEach(function (id) {
      if (!before.cards[id] || before.cards[id].v !== B.cards[id].v) { changed.add(id); moved.push(id); }
    });
    changed.forEach(function (id) { if (!B.cards[id]) changed.delete(id); });
    saveSeen();
    if (D.sentRev && arrived(D.sentKey)) D = emptyDrafts();
    reconcileDrafts();
    notice('');
    rerender(moved);
  }

  function rerender(moved) {
    var y = window.scrollY;
    var chatTa = document.activeElement && document.activeElement.closest && document.activeElement.closest('.chat') && document.activeElement;
    var caret = chatTa ? [chatTa.selectionStart, chatTa.selectionEnd] : null;
    var box = deskBox();
    var at = box ? [box.scrollLeft, box.scrollTop] : null;
    var focus = S.focus;
    if (focus && !B.cards[focus]) S.focus = null;
    render();
    window.scrollTo(0, y);
    if (at && deskBox()) { deskBox().scrollLeft = at[0]; deskBox().scrollTop = at[1]; }
    (moved || []).forEach(function (id) { var el = cardEl(id); if (el && !reduced) el.classList.add('flash'); });
    if (caret && $('.chat textarea')) {
      var ta = $('.chat textarea');
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(caret[0], caret[1]);
      scrollThread();
    } else if (S.focus && cardEl(S.focus)) cardEl(S.focus).focus({ preventScroll: true });
  }

  // ---------- events ----------

  function typingTarget(t) { return t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT'); }
  var INTERACTIVE = 'a, button, input, textarea, select, label, summary, details';

  // ---- an image at full size: a dialog in the page ----
  // The image fits the window; a click on it shows its real pixels and the
  // view scrolls; a click beside it, Close or Esc goes back to the card.
  function openImage(btn) {
    var img = btn.querySelector('img');
    var fig = btn.closest('figure');
    if (!img) return;
    var dlg = document.createElement('dialog');
    dlg.className = 'lightbox';
    dlg.setAttribute('aria-label', img.alt);
    dlg.innerHTML = '<div class="lightbox-frame"><div class="lightbox-view"></div>' +
      '<div class="lightbox-bar"><span class="lightbox-cap"></span>' +
      '<button type="button" data-close>' + esc(t('lightbox_close')) + '</button></div></div>';
    var big = document.createElement('img');
    big.src = img.src;
    big.alt = img.alt;
    big.title = t('lightbox_actual');
    // Real pixels are CSS pixels: an @2x image shows at the size its card gives it, unscaled.
    var cssW = img.getAttribute('width');
    var cardId = btn.closest('.card') ? btn.closest('.card').dataset.id : null;
    $('.lightbox-view', dlg).appendChild(big);
    var cap = fig && fig.querySelector('figcaption');
    if (cap) $('.lightbox-cap', dlg).innerHTML = cap.innerHTML;
    dlg.addEventListener('click', function (e) {
      if (e.target === big) {
        var actual = dlg.classList.toggle('actual');
        big.style.width = actual && cssW ? cssW + 'px' : '';
        big.title = t(actual ? 'lightbox_fit' : 'lightbox_actual');
        return;
      }
      if (e.target.closest('[data-close]') || e.target.classList.contains('lightbox-view')) dlg.close();
    });
    dlg.addEventListener('close', function () {
      dlg.remove();
      // A live update may have redrawn the card while the image was open.
      var back = document.contains(btn) ? btn : cardId && cardEl(cardId);
      if (back) back.focus({ preventScroll: true });
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    $('[data-close]', dlg).focus();
  }

  app.addEventListener('click', function (e) {
    var t = e.target;
    if (swallow) { swallow = false; return; }
    // A click outside the open menu of boards closes it.
    if (!t.closest('.switcher')) closeSwitcher();
    var ls = t.closest('[data-lsort]');
    if (ls) { sortList(ls.dataset.lsort); return; }
    var zb = t.closest('[data-zoom]');
    if (zb) { setZoom(zb.dataset.zoom === 'fit' ? 'fit' : +zb.dataset.zoom); return; }
    var fz = t.closest('.fig-zoom');
    if (fz) {
      // On a desk zoomed out below reading size, a click reads the card first, as anywhere on a card.
      var fc = fz.closest('.card');
      if (fc && deskOn() && S.scale < 0.75) { focusCard(fc.dataset.id, { open: true, scroll: false }); return; }
      openImage(fz);
      return;
    }
    var go = t.closest('[data-goto]');
    if (go) { focusCard(go.dataset.goto, { open: go.hasAttribute('data-open') }); return; }
    var ref = t.closest('a.ref[data-ref]');
    if (ref) { e.preventDefault(); focusCard(ref.dataset.ref); return; }
    // A numeral on a part of a sheet is the card pinned there.
    var pin = t.closest('.pin[data-card]');
    if (pin && B.cards[pin.dataset.card]) { focusCard(pin.dataset.card); return; }
    var card = t.closest('.card');
    var mark = t.closest('[data-mark]');
    if (mark && card) { setMark(card.dataset.id, mark.dataset.mark); return; }
    var ap = t.closest('[data-approve]');
    if (ap && card) {
      var d = draft(card.dataset.id);
      d.approve = d.approve === ap.dataset.approve ? undefined : ap.dataset.approve;
      delete d.aside;
      touchDrafts();
      refreshCard(card.dataset.id);
      return;
    }
    var dn = t.closest('[data-done]');
    if (dn && card) {
      var dd = draft(card.dataset.id);
      dd.done = dd.done === dn.dataset.done ? undefined : dn.dataset.done;
      delete dd.aside;
      touchDrafts();
      refreshCard(card.dataset.id);
      return;
    }
    var gt = t.closest('[data-act="anyway"], [data-act="hold"]');
    if (gt && card) {
      draft(card.dataset.id).anyway = gt.dataset.act === 'anyway' ? true : undefined;
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
      else if (a === 'aside' && card) setAside(card.dataset.id);
      else if (a === 'aside-all') setAsideAll();
      else if (a === 'chat-remove') removeComment(+act.dataset.k);
      else if (a === 'desk') { if (!MAP || S.view !== 'desk') toggleDesk(); }
      else if (a === 'list') { if (S.view !== 'rack') toggleDesk(); }
      else if (a === 'screen') setScreen(!S.screen);
      else if (a === 'arrange') arrange();
      else if (a === 'new-group') newGroup();
      else if (a === 'switch') toggleSwitcher();
      else if (a === 'info') toggleInfo();
      else if (a === 'step-prev') step(-1);
      else if (a === 'step-next') step(1);
      else if (a === 'frame-remove') removeFrame(act.closest('.frame').dataset.frame);
      else if (a === 'chat') toggleChat();
      else if (a === 'chat-send') chatSend();
      else if (a === 'chat-undo') chatUndo();
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
      if (vals.length) delete draft(c.id).aside;
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
      var cc = B.cards[cardNode.dataset.id];
      if (!cc) return;
      var had = hasDraftAnswer(cc);
      draft(cc.id)[field] = t.value;
      if (field === 'answer' && t.value.trim() && draft(cc.id).aside) {
        delete draft(cc.id).aside;
        var row = cardNode.querySelector('.aside-row');
        if (row) row.outerHTML = asideHtml(cc, draft(cc.id));
        refreshGated(cc.id);
      }
      // The first character of a text answer is an answer: the asks that wait for it open.
      if (field === 'answer' && had !== hasDraftAnswer(cc)) refreshGated(cc.id);
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
    if (!g || g.disabled || e.button !== 0 || S.view === 'desk' || MAP) return;
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
    packRack();
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
    wantPeek(card && e.pointerType !== 'touch' ? card.dataset.id : null);
    // In a flow figure, the box under the pointer darkens its own arrows.
    var fn = e.target.closest && e.target.closest('svg.flow .fn');
    var svg = e.target.closest && e.target.closest('svg.flow');
    if (svg) $$('.fe', svg).forEach(function (g) { g.classList.toggle('hot', !!fn && (g.dataset.a === fn.dataset.n || g.dataset.b === fn.dataset.n)); });
  });
  app.addEventListener('pointerleave', function () { setHover(null); hidePeek(); });

  // Drag the empty desk to pan, as you would slide paper on a table. Drag a
  // card by its top strip (or its grip) to place it; a click is not a drag.
  var pan = null;
  // ---- the width of a card on the desk: drag its right edge, or [ and ] on the card in focus ----
  var MIN_W = GRID * 10;   // 240px
  var MAX_W = GRID * 40;   // 960px
  function ownWidth(el) {
    // The width the layout gives the card: its section's column at this level.
    var sh = el.closest('.shelf');
    var cs = sh ? getComputedStyle(sh) : null;
    var num = function (name) { return cs ? parseFloat(cs.getPropertyValue(name)) || 0 : 0; };
    if (el.classList.contains('sheet')) return sheetWidth(el);
    if (S.alt === 'claim') return 288;
    return Math.max(288, num('--col-w'), S.alt === 'full' ? num('--col-wf') : 0);
  }
  // The card you just sized lies on top, as a card you put down does: its edge stays in reach
  // where it now covers a neighbour. The order of PLACE.cards is the stacking order.
  function raise(id) {
    var keep = PLACE.cards[id];
    delete PLACE.cards[id];
    PLACE.cards[id] = keep;
  }
  // done: the drag or the key press is over (the width goes on the grid, and is kept).
  // exact: the width is the layout's own, which need not lie on the grid.
  function setWidth(id, w, done, exact) {
    var el = cardEl(id);
    if (!el || S.view !== 'desk') return;
    if (!PLACE) freeze();
    var p = PLACE.cards[id];
    if (!p) return;
    p[2] = exact ? w : clamp(done ? snap(w) : w, MIN_W, el.classList.contains('sheet') ? Math.max(MAX_W, sheetWidth(el)) : MAX_W);
    setBox(el, p);
    if (done) { raise(id); savePlace(); layoutDesk(); } else scheduleWires();
  }
  function nudgeWidth(id, steps) {
    var el = cardEl(id);
    if (!el || S.view !== 'desk') return;
    setWidth(id, el.offsetWidth + steps * GRID * 2, true);
    reveal(id);
  }
  function resetWidth(id) {
    var el = cardEl(id);
    // On the layout's own places every card has its own width already.
    if (!el || S.view !== 'desk' || !PLACE) return;
    setWidth(id, ownWidth(el), true, true);
  }
  // A drag that just ended is followed by a click where the pointer is, when the pointer is a
  // mouse; that click must do nothing. A touch drag is followed by none, so the mark runs out
  // by itself and the next tap counts.
  var swallowTimer = 0;
  function swallowClick() {
    swallow = true;
    clearTimeout(swallowTimer);
    swallowTimer = setTimeout(function () { swallow = false; }, 350);
  }
  var size = null;
  app.addEventListener('pointerdown', function (e) {
    var h = e.target.closest('.widen');
    if (!h || S.view !== 'desk' || e.button !== 0) return;
    var card = h.closest('.card');
    // off: from the pointer to the card's right edge, on the screen. The edge keeps that distance.
    size = { el: card, id: card.dataset.id, x: e.clientX, off: e.clientX - card.getBoundingClientRect().right, moved: false, pid: e.pointerId, handle: h };
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // The handle is not part of the card for a click: it does not focus, open or close it.
  // (The click that ends a drag lands here, on the handle that holds the pointer: the mark for it is used up.)
  app.addEventListener('click', function (e) { if (e.target.closest('.widen')) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
  window.addEventListener('pointermove', function (e) {
    if (!size) return;
    if (!size.moved && Math.abs(e.clientX - size.x) < 3) return;
    if (!size.moved) {
      size.moved = true;
      // While you drag, the table keeps its scale and its size: a card that grows would
      // else shrink a fitted desk, or shift a centred one, away from under the pointer.
      S.holding = true;
      var pl = $('.plane');
      if (pl && !pl.style.width) { pl.style.width = pl.offsetWidth + 'px'; pl.style.height = pl.offsetHeight + 'px'; }
      if (!PLACE) freeze();
      size.el.style.zIndex = '999';
      size.el.classList.add('sizing');
      document.documentElement.classList.add('sizing');
      try { size.handle.setPointerCapture(size.pid); } catch (err) { /* the pointer left already */ }
    }
    setWidth(size.id, (e.clientX - size.off - size.el.getBoundingClientRect().left) / S.scale, false);
    e.preventDefault();
  });
  function endSize() {
    if (!size) return;
    var s0 = size;
    size = null;
    document.documentElement.classList.remove('sizing');
    s0.el.classList.remove('sizing');
    if (!s0.moved) return;
    S.holding = false;
    setWidth(s0.id, s0.el.offsetWidth, true);
    swallowClick();
  }
  window.addEventListener('pointerup', endSize);
  window.addEventListener('pointercancel', endSize);
  window.addEventListener('pointercancel', function () { endFrame(); });
  app.addEventListener('dblclick', function (e) {
    var fn = MAP && e.target.closest('.frame-head');
    if (fn && !e.target.closest('button, input')) { renameFrame(fn.closest('.frame').dataset.frame); e.preventDefault(); return; }
    var h = e.target.closest('.widen');
    if (!h || S.view !== 'desk') return;
    resetWidth(h.closest('.card').dataset.id);
    e.preventDefault();
  });

  var move = null;
  var swallow = false;
  app.addEventListener('pointerdown', function (e) {
    if (S.view !== 'desk' || e.button !== 0) return;
    if (startFrame(e)) return;
    var t = e.target;
    var card = t.closest('.card');
    var handle = card && t.closest('.addr, .tab, .grip');
    if (handle && !t.closest('a, input, textarea, select, label, button:not(.grip)') && (e.pointerType !== 'touch' || t.closest('.grip'))) {
      move = { el: card, id: card.dataset.id, x: e.clientX, y: e.clientY, moved: false, pid: e.pointerId, handle: handle };
      return;
    }
    if (e.pointerType !== 'mouse' || !t.closest('.shelves') || card || t.closest(INTERACTIVE)) return;
    pan = { x: e.clientX, y: e.clientY, moved: 0, box: t.closest('.shelves') };
  });
  window.addEventListener('pointermove', function (e) {
    if (fdrag) { moveFrame(e); return; }
    if (move) {
      var dx = e.clientX - move.x;
      var dy = e.clientY - move.y;
      if (!move.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      if (!move.moved) {
        move.moved = true;
        if (!PLACE) freeze();
        move.start = PLACE.cards[move.id].slice();
        move.el.classList.add('moving');
        try { move.handle.setPointerCapture(move.pid); } catch (err) { /* the pointer left already */ }
      }
      var p = PLACE.cards[move.id];
      p[0] = Math.max(0, move.start[0] + dx / S.scale);
      p[1] = Math.max(GRID, move.start[1] + dy / S.scale);
      setBox(move.el, p);
      scheduleWires();
      e.preventDefault();
      return;
    }
    if (!pan) return;
    var px = e.clientX - pan.x;
    var py = e.clientY - pan.y;
    pan.x = e.clientX;
    pan.y = e.clientY;
    pan.moved += Math.abs(px) + Math.abs(py);
    if (pan.moved > 4) {
      document.documentElement.classList.add('panning');
      pan.box.scrollLeft -= px;
      pan.box.scrollTop -= py;
    }
  });
  window.addEventListener('pointerup', function () {
    if (fdrag) { endFrame(); return; }
    if (move) {
      if (move.moved) {
        var p = PLACE.cards[move.id];
        p[0] = snap(p[0]);
        p[1] = Math.max(GRID, snap(p[1]));
        move.el.classList.remove('moving');
        // The card you put down lies on top; the order of PLACE.cards is the stacking order.
        var keep = PLACE.cards[move.id];
        delete PLACE.cards[move.id];
        PLACE.cards[move.id] = keep;
        savePlace();
        layoutDesk();
        swallowClick();
      }
      move = null;
      return;
    }
    if (!pan) return;
    swallow = pan.moved > 4;
    pan = null;
    document.documentElement.classList.remove('panning');
  });

  // Ctrl or Cmd with the wheel, or a trackpad pinch, zooms the desk at the pointer.
  app.addEventListener('wheel', function (e) {
    if (S.view !== 'desk' || !(e.ctrlKey || e.metaKey) || !e.target.closest('.shelves')) return;
    e.preventDefault();
    var box = deskBox();
    var r = box.getBoundingClientRect();
    S.back = null;
    var z = clamp(S.scale * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)), 0.15, 2);
    S.zoom = z;
    save('zoom', z);
    setScale(z, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  document.addEventListener('keydown', function (e) {
    var target = e.target;
    // In the chat box, Enter sends the message; Shift + Enter makes a new line.
    if (target.matches && target.matches('.chat textarea') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); chatSend(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { if (!MAP) { e.preventDefault(); send(); } return; }
    // A frame's name: Enter or F2 renames the group.
    if (MAP && target.classList && target.classList.contains('frame-head') && (e.key === 'Enter' || e.key === 'F2')) { e.preventDefault(); renameFrame(target.closest('.frame').dataset.frame); return; }
    var menu = $('#switch-menu');
    if (menu && !menu.hidden) {
      var items = $$('[role="menuitem"]', menu).filter(function (x) { return x.tagName === 'A'; });
      var at = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); toggleSwitcher(false); $('[data-act="switch"]').focus(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); var nx = items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]; if (nx) nx.focus(); return; }
      if (e.key === 'Tab') toggleSwitcher(false);
    }
    if (e.key === 'Escape') {
      if (document.querySelector('dialog[open]')) return;
      if (pendingSend) { e.preventDefault(); undoSend(); return; }
      if (pendingChat) { e.preventDefault(); chatUndo(); return; }
      if (S.info && S.view === 'desk') { toggleInfo(); return; }
      if (target.closest && target.closest('.chat')) { toggleChat(false); return; }
      if (typingTarget(target)) { target.blur(); if (S.focus && cardEl(S.focus)) cardEl(S.focus).focus({ preventScroll: true }); return; }
      if (S.focus) { S.open.delete(S.focus); clearFocus(); return; }
      // Last: a board that fills its window without the browser's full screen leaves it.
      if (S.screen && !document.fullscreenElement) setScreen(false);
      return;
    }
    // "[" and "]" are typed with AltGr (Ctrl + Alt) or Option on many keyboards: they pass.
    var bracket = e.key === '[' || e.key === ']';
    if (typingTarget(target) || ((e.metaKey || e.ctrlKey) && !bracket) || document.querySelector('dialog[open]')) return;
    var tc = target.closest && target.closest('.card');
    var id = tc ? tc.dataset.id : S.focus;
    if (bracket) { if (deskOn() && id) { e.preventDefault(); nudgeWidth(id, e.key === '[' ? -1 : 1); } return; }
    if (e.altKey && id && /^Arrow/.test(e.key)) {
      e.preventDefault();
      // On a desk you arranged, Alt + arrows move the card one grid step. On the
      // rule layout, Up and Down reorder it in its section; Left and Right do nothing.
      // The map has no order of yours to send: there Alt + arrows always move the board.
      if (MAP) { if (S.view === 'desk') { if (!PLACE) freeze(); nudge(id, e.key); } return; }
      if (S.view === 'desk' && PLACE) { nudge(id, e.key); return; }
      if (S.view === 'desk' && /Left|Right/.test(e.key)) { toast(t('desk_alt_left_right')); return; }
      moveCard(id, e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (e.altKey) return;
    switch (e.key) {
      case 'j': case 'ArrowDown': e.preventDefault(); step(1); break;
      case 'k': case 'ArrowUp': e.preventDefault(); step(-1); break;
      case 'Enter': case 'o':
        // Enter on a button, a link or a summary inside a card is that control's own.
        if (e.key === 'Enter' && target !== cardEl(id) && target.closest && target.closest(INTERACTIVE)) break;
        if (id && (target === cardEl(id) || target === document.body || tc)) {
          e.preventDefault();
          // On the map, Enter opens the board.
          if (MAP) { if (B.cards[id].map.href) location.href = B.cards[id].map.href; break; }
          if (S.open.has(id)) S.open.delete(id); else S.open.add(id);
          applyView();
        }
        break;
      case '1': setAlt('claim'); break;
      case '2': setAlt('gist'); break;
      case '3': setAlt('full'); break;
      case '=': case '+': if (id && !MAP) setMark(id, 'keep'); break;
      case '-': if (id && !MAP) setMark(id, 'drop'); break;
      case 'm': if (id && !MAP) setMark(id, 'more'); break;
      case 'r': if (id && !MAP) { e.preventDefault(); toggleReply(id, true); } break;
      case 'n': nextWaiting(); break;
      case 'd': toggleDesk(); break;
      case 'b': if ($('[data-act="switch"]')) { e.preventDefault(); toggleSwitcher(true); } break;
      // Shift + F; a capital F from Caps Lock alone does nothing, as before.
      case 'F': if (e.shiftKey && screenAllowed()) setScreen(!S.screen); break;
      case 'z': if (deskOn()) cycleZoom(); break;
      case '0': if (deskOn() && id) resetWidth(id); break;
      case 'c': if (!ASKED.embed && !MAP) { e.preventDefault(); toggleChat(true); } break;
      // In a frame the filter, the order, the search and the help have no control on the page: no key for them either.
      case 'f': if (!ASKED.embed) { S.filter = { all: 'yours', yours: 'changed', changed: 'all' }[S.filter]; applyView(); } break;
      case 's': if (ASKED.embed) break; S.sort = { board: 'waiting', waiting: 'recent', recent: 'board' }[S.sort]; render(); toast(t('sort_toast', { order: $('[data-sort] option[value="' + S.sort + '"]').textContent })); break;
      case '/': if (!ASKED.embed) { e.preventDefault(); $('[data-search]').focus(); } break;
      case '?': if (!ASKED.embed) openHelp(); break;
    }
  });

  // ---------- boot ----------

  render();
  firstView();
  var resizeTimer;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { alignCompare(); watchSizes(); scheduleWires(); }, 120); });
  var hash = location.hash.replace(/^#c-/, '');
  if (hash && B.cards[hash]) focusCard(hash, { open: true });
  if (B.live && window.EventSource) {
    var es = new EventSource('/api/' + encodeURIComponent(ID) + '/events');
    es.addEventListener('change', refresh);
    // Catch anything that changed between this page's render and the stream opening.
    es.addEventListener('hello', refresh);
  }
})();
