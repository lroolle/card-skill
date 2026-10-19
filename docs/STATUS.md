# Status

Version 0.7.0, open, not tagged: one bar, set aside, comments, peek, the
map as a list (D46). Version 0.6.0 is built and not tagged: the map of a
project's boards (D45).
Version 0.5.0 is built and not tagged: class diagrams from Mermaid's lines
(D43), and sheets drawn on the board (D44).
0.4.0 was tagged and released on 2026-10-15: sheets and pins (D42).
What works, what nobody has checked yet, and what is known to be missing.
The reasons are in `docs/DECISIONS.md`; what comes next is the board
`.cards/roadmap`.

## What works, with a test behind it

`npm test`: 191 tests. 32 of them drive a real browser; on GitHub they run
in Chromium, Firefox and WebKit, each one required. 3 run a real Emacs.
The site at https://lroolle.github.io/card-skill/ is built on each push
from `site/` and the boards under `.cards/`.

- The format: sections, cards, the drawer, TODO states, cookies, tags,
  facts, options with keys, four kinds of ask, links, figures (sketch and
  flow), files (pictures, excerpts, chips), what Emacs writes into a card.
- Org itself: every template and shown board passes `org-lint`, and Emacs
  reads the same cards from them as our parser. On GitHub the source of
  the sample and of the design review renders with its drawers hidden (read
  through GitHub's API on 2026-10-09; no test repeats this).
- Errors with a line and a corrected example; lint for the writing rules
  and for syntax that does nothing.
- Versions that follow meaning: a re-wrapped paragraph is not a revision; a
  changed picture is.
- Figures: sketch, flow (right angles, groups, stores), sequence and chart,
  with the checks that `cards check` runs on each drawing's geometry. 2000
  generated flows of real shape, with labels and groups: 94.1% with no
  fault the checks know, against 92.9% for 0.3.0 under its looser check.
  The rest have a label on a line.
- Class diagrams (D43): Mermaid's `classDiagram` lines, drawn by the
  compiler with the flow's layout and checks; pins on classes and
  namespaces. Generated diagrams of real shape, six seeds of 2000: 98.8%
  to 99.2% with no fault the checks know; the rest are a label among many
  lines. Looked at in Chromium; the browser test runs in all three.
- A sheet lies on the board (D44): no card stock, edge or shadow at rest;
  an edge under the pointer, the ring in focus. Tested in Chromium,
  Firefox and WebKit.
- Sheets and pins (D42): a drawing that leads its section on both views, at
  the room of a sheet, and the numerals of the cards pinned on its parts,
  with focus both ways. Tested in Chromium, Firefox and WebKit.
- Full screen (Shift + F), and a reading view that packs its cards into
  columns without moving the page under a click.
- Asks: the lint tells of an ask that is not a real decision.
- The page: the rack and the desk, the three levels, the first-view and Fit
  rules, lines by link type, your own layout, the image viewer, the chat,
  keys, a phone-width layout, a board in a frame (`?embed`, `?fresh`).
- Two languages of chrome, English and Simplified Chinese; a Chinese,
  Japanese or Korean board carries a subset of an open font.
- Asks that wait for asks, in the three `:NEEDS:` forms.
- The loop: served (Send posts to a loopback server), file (Send copies the
  reply; `cards ingest` records it), `inbox`, `wait`, `say`, `settle`.
- `cards export`: a test reads the output for replies, chat, history and
  paths.
- Translations: links between sibling boards, and the drift checks.
- The page as a report you work through (D46): one bar at the top with the
  menu of boards, the turn, the asks, a stepper, the languages, About; set
  aside per ask or for all; comments on a card and on the board; a peek on a
  zoomed-out desk; the map as a sortable list. Tested in Chromium, Firefox
  and WebKit.
- The map of a project's boards (D45): a tile per board in the frame of
  its group, lines from `#+from:`, `#+needs:` and links between boards,
  every open ask; the human's own grouping by drag, kept in the browser. A
  link to a card on another board; the boards a board connects to, under
  its title. Tested in Chromium, Firefox and WebKit.
- The list of a project's boards (`.cards/index.html`, now the map), and `cards hook`
  for replies that arrive with the human's next message. The hook was run
  in a real Claude Code session (2.1.295): the reply reached the agent
  with the next message and was marked read.
- The file fences: no file from outside the project, no hidden file, no
  file named like a secret gets into a page.

## Not checked

- The new figures, full screen and packing on a real Mac screen, at 2x, and
  in Safari itself. They were looked at in Chromium at 1440 px in both
  themes, and tested in all three engines on Linux.
- Safari itself, and a phone in a hand. WebKit and Firefox run the browser
  tests on Linux; the phone layout is tested at 390 px.
- Pinch zoom on the desk. (Taps are tested on a touch screen of phone size
  in Chromium and WebKit: answer, open a picture, send.)
- The Chinese chrome on a real device, by a human native reader. A second
  reader with a native register guide went through all 223 strings and the
  sample board; its 49 corrections are in.
- The Chinese landing page, by a human native reader. A second reader
  proofread it; its 19 corrections are in.
- Windows. Nothing here has run on it. The line that `cards hook` prints
  is a line of sh.
- `scripts/` and `site/` as code. The pages they build had two design
  reviews; the code of `skill/` had two code reviews (D37 is the second).
- A board in the older `board.md` format with the commands that edit a
  board: they refuse it and say so, and nothing more is tested there.

## Known limits

- A compare section is one column on the desk; its options line up only on
  the rack.
- The CJK font needs an open font and fonttools on the machine that
  renders; without them the page falls back to the system font and says so.
  Characters typed into a reply are not in the subset.
- A published page has no way to send a reply except copy and paste.
- A translation is written by hand, card by card; the tool only reports
  what fell behind.
- `cards shot` needs Playwright, which the skill does not install. Its
  pictures are only as true as the fonts of the machine that takes them.
- A flow label can still sit beside a crowded line (29 of 2000 generated
  flows of real shape); `cards check` says where. A group's name can still
  lie on a line: 54 of 2000 flows with a group, 37 of them running right. A flow drawn left to
  right is often wider than a card; the check names `direction: down`.
- Two groups whose boxes cross each other's ranks cannot both keep their
  frames apart; the boxes stay where the layout put them, and the check
  says so.
- A drawing does not open full size; it scrolls in its frame and zooms on
  the desk.
- The map: the human's regrouping stays in their browser and does not reach
  the agent; a frame cannot be moved with the keyboard; a frame's corner can
  lie under a tile. The map covers one `.cards/` directory, not every
  project on the machine.
- Focus on a card zooms the desk to that card; the part it is pinned on may
  then lie outside the window.

## How to work on it

Read `AGENTS.md`. Change the format in three places together:
`skill/reference/format.md`, a template, a test. Supersede a decision in
`docs/DECISIONS.md`; do not rewrite one.
