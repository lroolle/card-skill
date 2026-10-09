// `cards ids` against the parser, on generated boards.
// The command writes into the user's source file, and it was wrong twice where
// it had a rule of its own for "where is the drawer". This holds it to the
// parser's reading on every shape a heading, a planning line and a drawer take.
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, addIds } from '../skill/lib/board.mjs';

const TITLES = ['Ship the release', 'NATS covers the peak', '选一个队列', 'A [x] (y) $1 ^claim', 'Kafka pays off', 'Ship the release', 'x', 'DEADLINE: is a word here'];
const PLAN = ['DEADLINE: <2026-10-15 Thu>', 'CLOSED: [2026-10-09 Fri 10:00]', 'SCHEDULED: <2026-10-09 Fri +1w>', 'DEADLINE: 2026-10-15', 'SCHEDULED: <%%(diary-float t 4 2)>', 'DEADLINE: Friday is the day we ship.', 'CLOSED: [2026-10-09 Fri] DEADLINE: <2026-10-10 Sat>'];

// One generator per seed: the same boards on every run.
function generator(seed0) {
  let seed = seed0;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const maybe = (p) => rnd() < p;
  let nid = 0;
  let written = []; // per card: the id that stands in the file, or null
  const card = () => {
    const out = [`** ${maybe(0.3) ? pick(['TODO ', 'DOING ', 'DONE ', 'BLOCKED ']) : ''}${pick(TITLES)}${maybe(0.2) ? ' [1/2]' : ''}${maybe(0.2) ? '  :risk:' : ''}`];
    if (maybe(0.25)) out.push('');
    if (maybe(0.3)) out.push(pick(PLAN));
    // An id written in the file is c<number>; "open" has no :END:, "two" has two ids, "empty" has one with no value.
    const kind = pick(['none', 'none', 'id', 'id', 'noid', 'empty', 'open', 'two']);
    written.push(kind === 'id' ? `c${nid + 1}` : kind === 'two' ? `c${nid + 2}` : null); // of two ids the last one counts
    if (kind !== 'none') {
      out.push(':PROPERTIES:');
      if (kind === 'id') out.push(`:CUSTOM_ID: c${++nid}`);
      if (kind === 'two') out.push(`:CUSTOM_ID: c${++nid}`, `:CUSTOM_ID: c${++nid}`);
      if (kind === 'empty') out.push(':CUSTOM_ID:');
      if (maybe(0.5)) out.push(':BASIS: fact');
      if (kind !== 'open') out.push(':END:');
    }
    if (maybe(0.7)) out.push('Gist line.');
    if (maybe(0.2)) out.push('', '#+begin_src sketch', '** not a card', ':PROPERTIES:', ':CUSTOM_ID: fake', ':END:', '#+end_src');
    if (maybe(0.15)) out.push('*** a sub heading', 'more');
    if (maybe(0.8)) out.push('');
    return out;
  };
  return () => {
    nid = 0;
    written = [];
    const L = ['#+title: T', ''];
    if (maybe(0.3)) L.push(...card());
    for (let s = 1 + Math.floor(rnd() * 3); s > 0; s--) {
      L.push(pick(['* One', '* Two', '* ', '* 三', '* One']), '');
      for (let c = Math.floor(rnd() * 4); c > 0; c--) L.push(...card());
    }
    const eol = pick(['\n', '\n', '\r\n', '\r']);
    return { src: L.join(eol) + (maybe(0.5) ? eol : ''), written };
  };
}

test('ids: on 6,000 generated boards a card that has an id keeps it, every card gets one, and nothing else changes', () => {
  const lines = (s) => s.split(/\r\n|\r|\n/).filter((l) => l.trim() && !/^:(PROPERTIES|END|CUSTOM_ID):/.test(l));
  const text = (c) => c.body.replace(/\s+/g, ' ').trim();
  for (const seed of [7, 11, 2026]) {
    const board = generator(seed);
    for (let k = 0; k < 2000; k++) {
      const { src, written } = board();
      const where = `seed ${seed}, board ${k}:\n${JSON.stringify(src)}`;
      const before = parseBoard(src, { fmt: 'org' });
      const r = addIds(src);
      const after = parseBoard(r.src, { fmt: 'org' });
      assert.equal(before.cards.length, written.length, `the parser sees other cards than were written. ${where}`);
      assert.equal(after.cards.length, before.cards.length, where);
      before.cards.forEach((c, i) => {
        // The id that stands in the file is the card's id, before the command and after it.
        if (written[i]) assert.deepEqual([c.id, after.cards[i].id], [written[i], written[i]], `a card lost the id that was written for it. ${where}`);
        assert.ok(after.cards[i].id, `a card has no id. ${where}`);
        assert.equal(after.cards[i].title, c.title, where);
        assert.equal(text(after.cards[i]), text(c), `the text of a card changed. ${where}`);
      });
      assert.ok(!after.errors.some((e) => /card has no id/.test(e.msg)), `check still asks for an id. ${where}`);
      const dup = (b) => b.errors.filter((e) => /duplicate/.test(e.msg)).length;
      assert.ok(dup(after) <= dup(before), `a duplicate id was made. ${where}`);
      assert.deepEqual(lines(r.src), lines(src), `a line that is not of a drawer changed. ${where}`);
      const again = addIds(r.src);
      assert.equal(again.src, r.src, `a second run changed the file. ${where}`);
      assert.deepEqual(again.added, [], where);
    }
  }
});
