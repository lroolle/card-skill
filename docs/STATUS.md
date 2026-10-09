# Status

Last update: 2026-10-08. Read this first when you resume.

## Where we are

v0 works end to end and has been through one code review and two design
review rounds. The design proposal is a board, `.cards/design-review/board.md`,
with 5 asks waiting on the human. Three decisions in `docs/DECISIONS.md` stay
Proposed until those asks come back: D5 connection model, D8 return path,
D11 visual direction.

## What works, verified

Each line names its check. `npm test` runs 34 tests.

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
Round 3 has not run. Do not call the design shipped until a human approves
`ask-visual` or a fresh review passes.

Open P2s: no skip link to the toolbar; the Yours filter keeps answered-but-
unsent asks while its badge counts only unanswered ones (on purpose; see the
comment in `board.js`).

## Not verified

- A real Mac and a real phone. Captures came from headless Chromium in the
  container, with Inter standing in for SF Pro.
- Safari and Firefox.
- A real agent session over several turns with a human answering.
- Boards past 30 cards, and Chinese boards.

## Known limits

- Inside a container, `cards serve` cannot be reached from the host browser:
  it binds to loopback only (D12). Use the `file://` page and Copy.
- `cards render` and a running `cards serve` can both sync the log at the
  same moment; a card change could be recorded twice. No lock yet.
- Unsent drafts are per browser (`localStorage`).
- The markdown subset has no images, no HTML, no footnotes, no diagrams.

## Next, in order

1. Read the human's replies to `.cards/design-review` (`cards inbox`, or the
   pasted text), record rulings in `docs/DECISIONS.md`, revise the board.
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
