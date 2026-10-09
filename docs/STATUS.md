# Status

Last update: 2026-10-09. Read this first when you resume.

## Where we are

Round 1 of the design review is answered (pasted digest, 2026-10-09): D8,
D11 and D15 are accepted, with the board opening on the desk. The human then
asked for Org in place of markdown (D16) and a desk canvas (D17): zoom with
Fit, 50% and 100%, focus that zooms to a card, cards you can drag, Arrange,
typed lines, and the board note as a dock. All of it is built and tested.

The board `.cards/design-review/board.org` is rev 9 (27 cards). Two asks
wait: `ask-canvas` (approve four choices the agent made inside D17) and
`ask-dogfood` (a real task; the round-1 answer was a test).

## What works, verified

Each line names its check. `npm test` runs 60 tests.

- Figures: `sketch` and `flow` parse, lay out the same way every time, escape
  all agent text, number per card (Fig. 12.1), and widen a card when wide:
  `test/figure.test.mjs`.
- Writing checks near ASD-STE100: long sentences, long paragraphs, the word
  list; quotes and code exempt; non-English boards skipped:
  `test/figure.test.mjs`.
- The desk in Chromium: one column per section, a line per link, focus lights
  the lines, no line passes behind a card, lines follow a level change, the
  desk keeps its own level (Claim), the line layer shrinks back, and on a phone
  the page stays 390px wide with Send on screen: `test/e2e.test.mjs`.
- Selecting text in a card does not open or close it: `test/e2e.test.mjs`.
- Org boards: the reader, the board parser, errors with Org fixes, the five
  templates (Org only), and the SKILL.md example: `test/kernel.test.mjs`,
  `test/figure.test.mjs`. The full browser loop runs on an Org board,
  including the agent's revision of `board.org`: `test/e2e.test.mjs`.
- Meaning, not syntax, makes a version: the markdown and Org templates have
  equal `canonical()` forms card by card (checked by hand while converting),
  and the design-review conversion kept the versions of 10 unchanged cards
  (rev 7 in `log.jsonl`).
- The desk canvas: Fit by default, `z` presets, zoom to a card at 50% and
  back with Esc, Ctrl + wheel zoom, typed line classes and the key, drag to
  place with grid snap that survives a reload, Arrange and Undo, the note
  dock (`c`, Esc, draft dot): `test/e2e.test.mjs` "desk canvas".

- Parser, lint, markdown subset, log, compiler, digest: `test/kernel.test.mjs`.
- Every finding from the code review has a regression test: id-only routing,
  no script on the error page, Origin required, loopback-only bind, items
  checked by kind, NUL cannot forge markup, one fence rule, `C#` headings,
  unchanged cards that return keep their version, plain-text outline, CLI
  flags and `--title`: `test/review.test.mjs`.
- The full loop in Chromium: serve, the andon rail, focus naming relations
  ("Decides 3", "Decided in 6"), choose, stamp, reply, Send, Undo, Send, the
  round in `log.jsonl`, the agent edits board.md, live update with Changed and
  v2: `test/e2e.test.mjs`.
- `file://` mode copies the same digest; keyboard: j/k, 1/2/3, n, and Tab
  then `=`: `test/e2e.test.mjs`.
- All five templates and the SKILL.md example parse with no errors and no
  warnings: `test/kernel.test.mjs`.
- A cold-start agent given only SKILL.md produced a valid 14-card board with
  no errors on the first try. Its notes on unclear text are fixed in SKILL.md.
- Again in Org (2026-10-09): given only SKILL.md and format.md, a fresh agent
  wrote a 9-card Org board with a sketch, a flow, a compare section and two
  asks; no errors and no warnings on the first try. Its nine notes on unclear
  text are fixed in SKILL.md, format.md and writing.md. Lint warnings now
  point at the line with the problem: `test/org.test.mjs`.
- Design checks: `kit/check.sh` 0 fail 0 warn; `kit/render-check.mjs` 0 fail,
  2 warns with reasons in `DESIGN.md`. Contrast passes in both themes.

## Design review state

Round 1: "competent but forgettable"; 5 P0s. Round 2: 3 of those fixed, 2
half-fixed, 4 new P0s found with touch emulation. All round-2 P0s and P1s are
fixed and recaptured (rail on the rack rule, two-row toolbar to 900px, marks
as a footer on touch, 44px touch targets, Undo reachable by keyboard and Esc,
dimming by color instead of opacity, scroll padding under the toolbar).
Round 3 (2026-10-09, fresh context, figures and the desk): verdict "fix".
1 P0 (a 40px touch target), 7 P1s, 5 P2s. All are fixed except one part of a
P2: same-column arcs stay in the right gutter. The fixes: the desk opens at
Claim with its own level; the line layer no longer keeps the desk wide; the
phone desk snaps one column at a time; the three option figures draw one
graph; figures with no shape are cut; flow labels avoid lines; a line that
crosses a column runs through a gap between cards. A second pass by the same reviewer
found 9 of 13 resolved, the rest P2, and one new P1 (selecting text opened or
closed the card), now fixed with a test. Its verdict: ship after that fix.
Open P2s from round 3: a few flow labels still touch a line; four arrowheads
crowd one numeral when four lines meet one card; on a phone, a wide figure
scrolls inside its frame with only a faint shade as the hint. Do not call the
design shipped until a human approves `ask-visual`.

Mac check (2026-10-09, ego lite = Chromium 152 on macOS, through the
deva-ego bridge, on an isolated copy of the board): sketches stay exact in
Menlo (Chromium on a Mac does not use SF Mono); 3 P1s found and fixed: a flow
label on its own line, a dashed column crossing that read as a mention, and
the marks bar covering a link label on the desk. Report and 28 captures:
`.claude/review/` (not in git). Open P2s from it: compare fact rows can drift
when one value wraps; Esc on the desk keeps the card's focus ring; the rail
rule runs only under the last row of tabs at 390px.

Mac check 2 (rev 7, ego lite, the canvas): no P0; 6 P1s fixed in rev 9: the
desk header is compact (smaller title, one-line lede) so the table gets the
height; lines keep their screen width and their end shapes their size at any
zoom; on your own layout lines lie above cards, faint where they cross one;
Ctrl + wheel keeps the point under the pointer when the desk can scroll (it
cannot when the whole board fits); the open note clears the toolbar; a phone
opens on the rack. Also fixed: the stacking order of moved cards survives a
reload; the wheel stops at 15%; Arrange's Undo lasts 8 s. Open P2s: lines hug
card edges on the section layout; the Fit button keeps a focus ring after a
click; Esc keeps a card's focus ring. Report: `.claude/review/ego-review-2.md`.

Open P2s: no skip link to the toolbar; the Yours filter keeps answered-but-
unsent asks while its badge counts only unanswered ones (on purpose; see the
comment in `board.js`).

## Not verified

- A real phone. A real Mac was checked once, in ego lite (Chromium 152), for
  rev 6; the canvas was checked in ego lite for rev 7 (`.claude/review/ego-review-2.md`).
- Safari and Firefox. WebKit for Playwright downloads into
  `~/.cache/ms-playwright`, but it needs GTK4 and GStreamer system libraries
  (`playwright install-deps webkit`, an apt install) that are not in this
  container.
- A real agent session over several turns with a human answering.
- Boards past 30 cards, and Chinese boards.

## Known limits

- Inside a container, `cards serve` cannot be reached from the host browser:
  it binds to loopback only (D12). Use the `file://` page and Copy.
- `cards render` and a running `cards serve` can both sync the log at the
  same moment; a card change could be recorded twice. No lock yet.
- Unsent drafts are per browser (`localStorage`).
- The markdown subset has no images, no HTML, no footnotes. Diagrams are the
  two figure blocks only; there is no agent-written SVG (D13).
- A sketch with CJK characters loses its columns (fonts differ in width).
- On the desk, a long line may share a gap with other lines; with many long
  lines a gap gets crowded. Boards past 30 cards are not tested on the desk.
- On your own layout (after a drag), lines run straight between cards and
  may pass behind a card; only the section layout routes them through gaps.
- A pinch on a touch screen zooms the whole page, not the desk; use the zoom
  buttons on a phone.
- In a flow figure, the labels of return loops are not checked against other
  lines.
- Your desk layout is per browser, like drafts.

## Next, in order

1. Read the reply to rev 7 (`ask-canvas`, `ask-dogfood`). If the human names a
   real task, build the first real board on it.
2. Install step: copy `skill/` to `~/.claude/skills/card-skill`; a
   `UserPromptSubmit` hook running `cards inbox --quiet` (round 1 pick).
3. An embedded CJK font subset for Chinese boards (round 1 pick).
4. A project index that links boards to each other (round 1 pick).
5. A capability URL for `cards serve`, if the human wants the served loop
   from inside a container.

## How to resume

```
npm test
node skill/bin/cards.mjs ls
node skill/bin/cards.mjs inbox --peek
node skill/bin/cards.mjs render design-review
```
