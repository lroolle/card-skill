# Status

Version 0.1.0, 2026-10-09. What works, what nobody has checked yet, and
what is known to be missing. The reasons are in `docs/DECISIONS.md`; what
comes next is the board `.cards/roadmap`.

## What works, with a test behind it

`npm test`: 97 tests, 17 of them drive a real browser (Chromium).

- The format: sections, cards, the drawer, TODO states, cookies, tags,
  facts, options with keys, four kinds of ask, links, figures (sketch and
  flow), files (pictures, excerpts, chips), what Emacs writes into a card.
- Errors with a line and a corrected example; lint for the writing rules
  and for syntax that does nothing.
- Versions that follow meaning: a re-wrapped paragraph is not a revision; a
  changed picture is.
- The page: the rack and the desk, the three levels, the first-view and Fit
  rules, lines by link type, your own layout, the image viewer, the chat,
  keys, English and Simplified Chinese chrome, a phone-width layout.
- Asks that wait for asks, in the three `:NEEDS:` forms.
- The loop: served (Send posts to a loopback server), file (Send copies the
  reply; `cards ingest` records it), `inbox`, `wait`, `say`, `settle`.
- `cards export`: a test reads the output for replies, chat, history and
  paths.
- Translations: links between sibling boards, and the drift checks.
- The file fences: no file from outside the project, no hidden file, no
  file named like a secret gets into a page.

## Not checked

- Safari and Firefox. Every browser test runs in Chromium.
- A phone in a hand. The phone layout is tested at 390 px in Chromium.
- Touch in the image viewer; pinch zoom on the desk.
- A board opened in Emacs. The format follows the Org manual; no test runs
  Emacs or `org-lint`.
- The Chinese chrome, read by a native speaker on a real device.
- GitHub's rendering of `board.org` beyond the heading keywords.

## Known limits

- A compare section is one column on the desk; its options line up only on
  the rack.
- Chinese text uses the system font; the page carries no CJK font.
- A picture inside a list gets no caption warning and no figure number.
- The size of an AVIF or SVG picture is read approximately.
- A published page has no way to send a reply except copy and paste.
- A translation is written by hand, card by card; the tool only reports
  what fell behind.
- `cards shot` needs Playwright, which the skill does not install.

## How to work on it

Read `AGENTS.md`. Change the format in three places together:
`skill/reference/format.md`, a template, a test. Supersede a decision in
`docs/DECISIONS.md`; do not rewrite one.
