# What changed

For the agent that writes boards. Newest first. Each line says what is
different for you, not how it was built. `cards --version` names this build;
`cards check` says when a board was last rendered by another one.

## 0.7.0

New
- One bar at the top of every board, that stays while the page scrolls:
  Boards (a menu of the project's boards by group, the map first; `b`), the
  title, whose turn it is, the ask tabs, a stepper from card to card, the
  languages, and About. The lede, the neighbours, the revision and the path
  stand under the bar in the reading view, and open from About on the desk.
- Set aside: the human may set aside one ask, or all of them, when no
  session will read the answer. It reaches you as the state `aside`
  (`set aside` in the reply). The ask waits no more, on the board and on the
  map, and `cards settle` closes it. SKILL.md, section 6: what to do with
  it, and to leave no ask behind when your work on a board stops.
- On a desk zoomed out, the card under the pointer shows beside itself at
  reading size.
- The map has a list view: one row per board, sortable by each column.

Changed
- The chat is now the board's Comments, and a card's Reply is its Comment.
  The reply format is the same (`note`, `reply`). On a page opened as a
  file, a comment goes with Send, with the card answers, instead of on its
  own.
- A board in other languages shows them as short marks: EN, 中.
- The desk and the map run down the page: each section (on the map, each
  group) is a band, its cards across the columns that fit the window, at a
  size that reads, and the desk scrolls down. Across, a column per section,
  is a switch in the desk bar, or `?flow=across`.
- The mark at the top left leads home: from a board to the map of the
  project's boards, and on the map back to its first view. A published copy
  goes to its `--home` page, or to the project's page as before.
- Send's dialog, with no server, names `cards ingest <board>`: the one
  command that keeps a reply on disk when no agent session will read it.
- `cards settle <board>` closes answered asks and leaves set-aside asks
  open, and says so: closing one releases the asks that need it, so you
  close it by name.

Fixed
- The line that says no card matches, or that a board has no cards, had
  lost its spacing since 0.4.0: a stray brace in the stylesheet dropped it.

## 0.6.0

New
- The map of a project's boards: `.cards/index.html` is now one table with
  every board on it, where it was a list. Each board is a tile with its
  title, its description, its first sheet and its open asks; each ask opens
  its card. A board names its group with `#+category:`, the boards it
  continues with `#+from:`, and the boards it waits on with `#+needs:`. The
  map frames each group and draws those lines. The human may drag a board
  into another group, move a group with its boards, or make a new one; that
  stays in their browser.
- A link to a card on another board: `[[file:../plan/board.org::#step-3]]`,
  Org's own link. The page shows that board's name and the card's numeral,
  and a click opens the card there. `[[file:../plan/board.org][the plan]]`
  links the board. `cards export` shows such a link as text, and names no
  other board: they may not be published.
- A board page names, under its title, its group and the boards it comes
  from, waits on, leads to and links to.
- `cards new <board> --category <group> --from <board> --needs <board>`
  writes those lines. `cards ls` prints the boards by group, with their
  links. SKILL.md, "Many boards: one map": when to open a board, how to
  group and connect it, when to split it.
- `cards check` says where a link names no board or no card, where another
  board is named as `=code=` instead of linked (`=release-2=`, not `=plan=`),
  and where a board has no `#+category:` while the other boards of the
  project name theirs. A `#+from:` or `#+needs:` that was a free sentence
  before this version is now a warning; the board still renders.

Fixed
- A board under `.cards/` that is a link to another directory was missing
  from the list of boards, from `cards ls` and from its translations.

## 0.5.0

New
- A `class` drawing: classes, records or types, and how they relate. Write
  the lines of Mermaid's `classDiagram`: `class Order { +id: str }`,
  `Base <|-- Order`, `Order *-- Line`, `Order o-- Coupon`,
  `Order --> Customer : placed by`, `Order "1" *-- "1..*" Line`,
  `namespace Billing { ... }`, `direction LR`. Mermaid itself does not run:
  the compiler draws the lines, `cards check` reads the drawing, and a sheet
  pins cards on its classes and namespaces. Do not draw a class diagram in
  a sketch any more.
- `cards check` says when a `mermaid` block holds a `classDiagram`: the
  same lines draw in a `class` block. Mermaid's styles, notes, front
  matter and `accTitle` in a `class` block are said, not drawn, and so is
  a line it cannot read, such as `A<|--B` with no spaces.
- The plan pattern shows the record a step copies as a class figure.

Changed
- A sheet is drawn on the board itself, not on a card: no card stock, edge
  or shadow until the pointer or focus is on it. Nothing changes in what
  you write.

## 0.4.0

New
- A sheet: a card tagged `:sheet:` is one drawing on the board, at the
  size it needs, with room for 24 boxes. It leads its section; on the desk
  it lies beside the section's cards.
- `:ON: system/api` pins a card on a part of a sheet: a box or group of a
  flow, a part of a sequence, a row, line or point of a chart. The part
  shows the card's numeral; focus lights both.
- SKILL.md "Draw it": which drawing for which claim, when to make a sheet,
  and how to work a drawing until `cards check` is clean.
- The review pattern opens with a sheet, its findings pinned on it.

Changed
- A group's name no longer sits on a line that enters the group. Where
  one would, the frame grows to make room beside its first box.
- Labels keep clear of lines that pass by. `cards check` counts a line
  within 1px of a label as on it, so an old board may get a new warning.
- A line chart's names on x no longer run into each other, also where the
  dates skip days.
- `:sheet:` is no longer a free tag: a card tagged so becomes a sheet.

## 0.3.0

New
- Two more figures. `sequence` shows who calls whom, in order:
  `a -> b: call`, `b --> a: reply`. `chart` draws an Org table: names in
  the first column give bars, numbers or dates give a line.
- In a flow, `group Cloud: a, b` frames boxes that belong together, and
  `store: a` draws a box that holds data as a cylinder.
- `cards check` reads each drawing and says what a reader would misread,
  with the fix: a label on a line, a line through a box, two arrows on one
  run, a frame around a box that is not in it, a drawing too wide for a card.
- SKILL.md section 3: ask only what is real and essential. Four tests, a
  short triage each round, and what to do instead of "Shall I proceed?".
  `cards check` warns on the usual non-asks. Later sections are renumbered.
- Full screen: Shift + F, or the button next to Desk.

Changed
- Flow arrows run at right angles, each on its own track. A flow you wrote
  before keeps its meaning and its version.
- The reading view packs a section's cards into columns, so a short or a
  wide card leaves no hole.
- The sample board picks a coffee machine for the team, in English and
  Chinese.

## 0.2.0

New
- `cards ids <board>` writes a `:CUSTOM_ID:` for every card that has none,
  so you can write a card as a heading and its text. The id is written
  once; it stays when the claim changes.
- `cards set <board> <id ...> --status doing|blocked|done|todo|none` writes
  the TODO keyword of cards. `cards move <board> <id ...> --to <section>`
  (or `--before <id>`, `--after <id>`) moves cards in `board.org`, in the
  order given. Use them in place of a text replace.
- Each render writes `.cards/index.html`, the list of the project's boards
  with their open asks; every board links back to it. It never replaces an
  `index.html` that it did not write (`CARDS_ROOT` may name such a folder).
- `cards hook` prints the lines for a Claude Code hook that hands you unread
  replies with the human's next message. Show them; do not install them
  yourself. The hook reads the boards of the project, wherever the session
  stands at that moment.
- `cards export --home <url>` gives a published copy a "Back" link. The
  address is relative or http(s).
- A Chinese, Japanese or Korean board carries a subset of an open font in
  the page, when the machine has one and has fonttools. `cards render`
  says once whether it does.
- A page takes `?view=`, `?level=`, `?embed` (in a frame) and `?fresh` (a
  sample; nothing is kept) in its address.
- SKILL.md: when a board is in use, ask on the board and nowhere else; the
  link is the hand-over.

The page
- A table keeps its words whole. Where a card is too narrow for it, each
  row is shown as a block, with the fields under the names of their columns:
  give a table a head row. A column of numbers is set to the right; a row
  `| <l> | <c> | <r> |` says otherwise. `#+caption:` above a table shows.
- A fact with a long key no longer leaves its value one letter wide, and a
  key shows its markup (`=code=`) as other text does.
- More of Org is shown as Org means it: lines that start with `: ` are code,
  `#+begin_verse` keeps its lines, `#+begin_center` is set in the middle,
  `[@10]` sets the number of a list item, `[-]` is a task partly done,
  `x^{2}` and `a_{ij}` go above and below the line, `\\` at the end of a
  line breaks it, `<2026-10-09 Fri>` reads as a date, `<https://...>` is a
  link. Code in a line has an edge, so a comma after it reads as following
  it.
- A card has a firmer edge and a shadow. On the desk the human can set the
  width of a card: drag its right edge (double-click puts it back), or `[`
  and `]` on the card in focus. At Full the desk gives a section with a
  wide table a wider column.

Changed
- Figures are numbered in the order of the source, also a picture inside a
  list or a quote. `cards check` warns when such a picture has no caption.
- The size of an AVIF or SVG picture is read exactly.
- A render of a board that did not change writes the same page, byte for
  byte. The page no longer carries the time of the render, so a board kept
  in git shows a change only when it changed.

Fixed
- A first line of a card that starts with `DEADLINE: `, `SCHEDULED: ` or
  `CLOSED: ` and has no timestamp was dropped from the page. It is text
  of the card now, unless the drawer stands directly under it; a planning
  line as Emacs writes it is left out as before. The same holds for the
  note of a section, so such a section shows one more line after the
  update. Where a line with no timestamp is still left out, `cards check`
  says so.
- A card whose `:PROPERTIES:` drawer stands lower than Org reads it (under
  a second planning line, or under a `:LOGBOOK:`) had the plain error
  "card has no id". The error now names the drawer, and `cards ids` leaves
  such a card alone.
- A line of `log.jsonl` that is JSON but not an event stopped the render.
  It is skipped, as a torn line is.
- A keyword with a hyphen, such as `#+translation-of:`, was shown as text of
  the lede with no warning. `cards check` now names it, and for this one it
  names the right spelling: `#+translation_of:`.
- On a touch screen, the reading view at Claim set each claim one letter
  per line.
- `cards shot` warned that the text may show as boxes on every board that
  is not English. It says so now only when the page does not carry its own
  font.
- The Chinese buttons: 49 strings corrected by a second reader.

Checked against Org itself
- Every template passes `org-lint` in Emacs, and Emacs reads the same
  cards from a board as `cards` does. The tests run both.

## 0.1.0

The first public version. If you wrote boards with an earlier copy, these
are the changes that matter:

Changed
- A picture is a link, not a block: `[[file:shot.png]]` alone on a line,
  with `#+caption:` above it. `#+begin_src image` is shown as code, and
  `cards check` now says so.
- A board says its TODO keywords, so Emacs and GitHub read them:
  `#+todo: TODO DOING BLOCKED | DONE` under the title.
- `DONE` on a card with `:ASK:` is no longer a warning. It is how an ask is
  closed: the card keeps the ask and its options as the record.
- The human's text in a reply is a JSON string: quotes and line breaks are
  escaped, nothing is cut.
- A link to another page of the same work (a relative link) opens in the
  same tab. A link to another site opens beside the board.

New
- `:ASK: do`: an action only the human can take outside the board. They
  answer Done or I cannot.
- `:SUGGEST: none` on a choose card: only the human knows; no `[X]`, no
  warning, and the reply says `chosen`.
- Option keys: `- [ ] small :: S/M, 140 to 180 mm`. The reply names the key.
- An ask that `:NEEDS:` another open ask waits for it. If the human changes
  the first answer from your suggestion, the second comes back `held`:
  ask it again. `:NEEDS: a=link` writes an ask for one answer only;
  `:NEEDS: a=*` waits for any answer.
- `cards render` ends with the version of the build, so you can tell when
  the SKILL.md in your context is older than the code.
- `cards ingest`: records a reply the human pasted, so the board shows the
  answers. `cards settle`: marks the answered asks DONE.
- `cards export <board> --out <dir>`: a copy to publish, with no replies,
  no history and no local path.
- `cards shot`: a picture of the page as the human sees it.
- `#+author:` and `#+description:` show in the page and in link previews.
- `#+translation_of: <board>` links a board to the same board in another
  language; `cards check` says where the translation fell behind.
- `#+language:` picks the language of the buttons (English, Simplified
  Chinese).
- Files in cards: `[[file:...]]` for a picture or any file,
  `#+include: "f" src js :lines "10-40"` for an excerpt.
- `cards check` warns about a `#+keyword:` or a block type this build does
  nothing with.

The page
- The desk opens at the most detail that fits the window at a readable size,
  and a picture shows at every level. Fit never shrinks the board below a
  readable size; a tall board fits the width and scrolls.
- The browser tab shows how many asks wait, and the icon lights up.
