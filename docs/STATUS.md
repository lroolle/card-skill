# Status

Last update: 2026-10-09. Read this first when you resume.

## Where we are

v0 works end to end. On 2026-10-09 the human asked for three changes before
they review: figures in cards, a canvas view with visible links, and writing
near ASD-STE100. All three are built (D13, D14, D15). The design proposal is
a board, `.cards/design-review/board.md` (rev 5, 24 cards), with 5 asks
waiting on the human. Three decisions stay Proposed until those asks come
back: D15 connection model (supersedes D5), D8 return path, D11 visual
direction.

## What works, verified

Each line names its check. `npm test` runs 52 tests.

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
crosses a column is a broken line there. A second pass by the same reviewer
found 9 of 13 resolved, the rest P2, and one new P1 (selecting text opened or
closed the card), now fixed with a test. Its verdict: ship after that fix.
Open P2s from round 3: a few flow labels still touch a line; four arrowheads
crowd one numeral when four lines meet one card; on a phone, a wide figure
scrolls inside its frame with only a faint shade as the hint. Do not call the
design shipped until a human approves `ask-visual`.

Open P2s: no skip link to the toolbar; the Yours filter keeps answered-but-
unsent asks while its badge counts only unanswered ones (on purpose; see the
comment in `board.js`).

## Not verified

- A real Mac and a real phone. Captures came from headless Chromium in the
  container, with Inter standing in for SF Pro.
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
- The desk opens on the rack until the human rules on `ask-connection`.

## Next, in order

1. Read the human's replies to `.cards/design-review` (`cards inbox`, or the
   pasted text), record rulings in `docs/DECISIONS.md` (D15, D8, D11), revise
   the board. If they pick the desk as the first view or free placement,
   that is the next build.
2. Build the first real board on the task the human names (`ask-dogfood`).
3. Install step: copy `skill/` to `~/.claude/skills/card-skill`; optional
   `UserPromptSubmit` hook running `cards inbox --quiet`.
4. A capability URL for `cards serve`, if the human wants the served loop
   from inside a container.
5. The next build item the human picks on `ask-next`.

## How to resume

```
npm test
node skill/bin/cards.mjs ls
node skill/bin/cards.mjs inbox --peek
node skill/bin/cards.mjs render design-review
```
