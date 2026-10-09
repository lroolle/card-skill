# Status

Version 0.1.0, 2026-10-09. What works, what nobody has checked yet, and
what is known to be missing. The reasons are in `docs/DECISIONS.md`; what
comes next is the board `.cards/roadmap`.

## What works, with a test behind it

`npm test`: 106 tests. 19 of them drive a real browser; on GitHub they run
in Chromium, Firefox and WebKit, each one required. 3 run a real Emacs.
The site at https://lroolle.github.io/card-skill/ is built on each push
from `site/` and the boards under `.cards/`.

- The format: sections, cards, the drawer, TODO states, cookies, tags,
  facts, options with keys, four kinds of ask, links, figures (sketch and
  flow), files (pictures, excerpts, chips), what Emacs writes into a card.
- Org itself: every template and shown board passes `org-lint`, and Emacs
  reads the same cards from them as our parser.
- Errors with a line and a corrected example; lint for the writing rules
  and for syntax that does nothing.
- Versions that follow meaning: a re-wrapped paragraph is not a revision; a
  changed picture is.
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
- The file fences: no file from outside the project, no hidden file, no
  file named like a secret gets into a page.

## Not checked

- Safari itself, and a phone in a hand. WebKit and Firefox run the browser
  tests on Linux; the phone layout is tested at 390 px.
- Pinch zoom on the desk. (Taps are tested on a touch screen of phone size
  in Chromium and WebKit: answer, open a picture, send.)
- The Chinese chrome on a real device, by a human native reader. A second
  reader with a native register guide went through all 223 strings and the
  sample board; its 49 corrections are in.
- GitHub's rendering of `board.org` beyond the heading keywords.
- The landing page after its rebuild, by a reviewer who did not build it.

## Known limits

- A compare section is one column on the desk; its options line up only on
  the rack.
- The CJK font needs an open font and fonttools on the machine that
  renders; without them the page falls back to the system font and says so.
  Characters typed into a reply are not in the subset.
- No Chinese landing page.
- A picture inside a list gets no caption warning and no figure number.
- The size of an AVIF or SVG picture is read approximately.
- A published page has no way to send a reply except copy and paste.
- A translation is written by hand, card by card; the tool only reports
  what fell behind.
- `cards shot` needs Playwright, which the skill does not install. Its
  pictures are only as true as the fonts of the machine that takes them.

## How to work on it

Read `AGENTS.md`. Change the format in three places together:
`skill/reference/format.md`, a template, a test. Supersede a decision in
`docs/DECISIONS.md`; do not rewrite one.
