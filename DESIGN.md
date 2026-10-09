# DESIGN.md -- the material

Read this before touching `skill/runtime/`. `TASTE.md` holds prior rulings;
this file holds the material. The one-line test for any UI change: **a change
that makes the surface prettier and the task harder must fail.** After every
edit, check two things: every color, size and radius in `board.css` is a
token from its first block, and the runtime holds no raw color
([design-skill](https://github.com/lroolle/design-skill) does it:
`kit/check.sh --tokens skill/runtime/board.css skill/runtime`). Before a
release, look at a rendered board at 390, 768 and 1440 px, in both themes.

## Direction

World: **candidate: Toyota kanban signal cards**, fused, on no kit (the board
is a generated single file; it carries its own tokens). Roll key `f3a39d30`;
pool 7 (our 7, no deck card matched the subject "agent card board:
addressable units of judgment, human marks, answers and queries, revisions,
lineage, whose turn"); assigned candidate #7; chosen 2026-10-08 because a
kanban card is a signal to act, and the board's whole job is to show which
cards wait on the human.

Hand rejected, each kept as a raise:
- Patent drawing sheets: competitive. Raise: reference numerals as card
  addresses; one highlight tint for the card under discussion. Since
  2026-10-09 also figure numbers (Fig. 12.1) and lead lines: on the desk,
  a line meets a card at its numeral.
- Munich 1972 pictogram program: declined as a world. Raise: one color per
  role, nothing colored without a role.
- Bamboo-slip scroll: declined. Raise: a superseded version is struck
  through, not deleted.

The promise is the first comment in `skill/runtime/board.html`.

The desk (the first view since D15/D17) is the same cards taken off the rack
and laid on a table: the steel world's work surface. It adds two line colors
with one role each (red: needs; violet: an option) and no new device.

Scene: a developer at a desk mid-session, a terminal on one half of the
screen and the board on the other, in daylight or late at night.
Mode: operate (with read). Protected functions: reading claims, answering
asks, Send, keyboard navigation, no loss of unsent drafts.

## Palette: provenance

Materials, not a seed: a galvanized steel rack (cool grey, hue 245), card
stock with a faint warm cast (hue 95), one printed ink (blue-black, hue 260),
and the JIS Z 9103 safety colors found on factory floors, used for meaning only:
yellow-red (hue 55) = the agent waits on you; blue (hue 258) = your own act and
your focus. The irregularity kept: warm card on cool steel, so a card reads as
an object on a rack. Strategy: restrained. Dark theme: the night shift, the
same rack under low light; cards are lighter than the rack.

## The material

Tokens are the `:root` block of `skill/runtime/board.css`. Everything else
uses tokens only.

| Dimension | Value | Law |
|---|---|---|
| Faces | system-ui stack with PingFang SC / Hiragino / YaHei / Noto CJK fallbacks; mono for paths and code | one family; no webfont, so the file stays offline |
| Scale | 12 / 13 / 15 / 17 / 20 / 28 px; weights 400 and 600; the phone title uses 20 | six sizes, two weights |
| Leading | 1.55 body, 1.35 claims, 1.75 under `:lang(zh, ja)` | |
| Measure | 68ch for lede and notes; cards are min 300px wide | |
| Radius | `--r` 6px; `--r-in` 4px nested inside `--r` (concentric); `--r-s` 3px for marks smaller than text | one corner language, derived |
| Surfaces | a card is card stock on the rack: a firm 1px edge (`--card-line`) and the shadow of a sheet that lies flat (`--card-shadow`: a 1px contact line and 6px of soft fall). Under the pointer or in focus it lifts a little (`--card-lift`). A DONE card and a card outside what you focus lie back: inset stock, a faint or dashed edge, no shadow. Everything inside a card is still 1px rules. At night the edge carries the card and the shadow only seats it | ruled by the human on 2026-10-09 ("better card details like border and shadow"); before that: no shadow at all |
| Tables | 13px, 1px rules between rows, head in `--fg-3`; words stay whole, a column of numbers is set to the right in tabular figures. A table that does not fit its card shows each row as a block: the first field in 600 as the row's name, the other fields under the names of their columns in 12px `--fg-3`, wrapping. A table with no head row scrolls | a column one letter wide is not a column |
| Inline code | 0.86em mono on `--surface-2` with a 1px `--line` inset edge, 3px of side padding | without the edge the padding read as a space before a comma |
| Density | Gist (default): claim + gist + facts + ask. Claim: a ruled ledger, one row per card, about 25 per viewport. Full: everything | never delete information to breathe |
| Motion | 140ms ease-out for focus and dimming; a 1.2s fade-out ring on live-changed cards; nothing else moves | reduced motion removes all of it |
| Icons | two: grip and search, 1.5px stroke, inline SVG | text labels everywhere else |
| Figures | a drawing panel on the card: 1px `--line` frame, `--r-in`, 12px mono; a sketch in `--fg`; flow boxes stroked `--fg-3` (bold box `--fg` 2px), arrows `--fg-3`, labels `--fg-2` with a card-stock halo; caption "Fig. n.k" in 12px | the card's one ink; no color in a figure, so the role colors keep their meaning |
| Files | an image is a figure with no padding: the frame clips it, `--surface-2` behind it, the file name and pixel size in 12px mono `--fg-3` after the caption. An excerpt is a `pre` with its path in mono `--fg`, its range in `--fg-3`, line numbers in a `--fg-3` gutter that copy does not take; 12 lines show, a `summary` opens the rest. A chip is a `--surface-2` pill: type in strong `--fg-2`, name in mono, size in `--fg-3`. The viewer is a `dialog` on an opaque `--bg`, the image with the card shadow, a bar with the caption and a 44px Close | an image keeps its own colors: it is evidence, not our drawing. This is the one exception to "no color in a figure"; a screenshot of a board shows its tabs and lines, and the caption names it as a picture |
| Width | on the desk the right edge of a card is a handle: a 3px `--accent` bar shows under the pointer; drag sets the width on the 24px grid, between 240 and 960px; double-click gives the layout's width back; `[` and `]` do the same from the keyboard for the card in focus; Arrange resets all. A column is 288px, wider for a figure, and at Full for a table (up to 560px) | the human's place and width are theirs: kept in this browser, never sent |
| Desk | the page is the window: header, the desk bar (line key, zoom, Arrange), then the table, which pans and zooms inside itself. `--desk-col` 288px columns (wider to fit a figure, up to 560px), `--desk-gutter` 96px; a 24px dot grid on the plane, so the grid zooms with the cards and a moved card snaps to it | opens at Fit; one column per section until you move a card; lines run under the cards and cross a column only in a gap |
| Lines | source `--fg-3` with an open arrow; needs `--danger` with a filled arrow (red already meant blocked); option `--link-option` (violet, new, one meaning) with a hollow diamond at the decision; mention dashed 4-3 with a dot, focus only. 1.25px; under the pointer 2px; in focus 2.25px and the rest fade to 22% | the end shape and the dash carry the type without color |
| Chat | a "Message the agent" pill in the bottom-right corner; open, a 380 x 460px panel: header with whose turn it is, the thread, a composer with Send. Your messages in `--accent-soft` (your own act), the agent's on card stock, revisions as quiet centered lines; an unread agent message puts a `--signal` dot on the pill (it waits on you). Above the toolbar when open, and when the toolbar reaches the corner | one conversation about the board, in reach in both views; card answers stay in the batch |
| zh mode | `lang:` in frontmatter sets `<html lang>`; leading rises; no embedded CJK face yet | see WARN below |

## Signature moves and device ration

Signature: 1. the signal tab, standing up from each card that waits on
you and repeated as the andon rail under the title, one jump per open ask;
an answered tab turns to a blue outline in the past tense (Chosen, Approved);
2. the andon line, which states whose turn it is; 3. focus light, which
names each relation on the related card with the focused card's numeral
("Source of 8") and dims the rest; on the desk it also thickens that card's
lines and fades the others. These and no others. Figures and the desk are
material, not signatures: they use the card's ink, two role colors for
lines, and the existing focus grammar.

Marks (Keep, Drop, More, Reply, and the drag grip) sit in an overlay on the
card's address line and appear with the card under the pointer or focus; on
touch, on the selected card. A chosen mark prints as a stamp (Kept, Dropped,
More asked). One masthead device (the andon line and rail); one
section-label device (the shelf label on a rule).

## Voice

Plain and short, near ASD-STE100. Verbs on buttons (Keep, Drop, More, Reply,
Approve, Reject, Send). Sentence case. No fake names or numbers in the
runtime; template content says it is illustrative.

## Check

`kit/check.sh` on `skill/runtime`: 0 FAIL, 0 WARN. Run it on the source, not
on a compiled `board.html`: the compiled file inlines the token file, so every
token reads as a raw color there.

`kit/render-check.mjs` on a rendered board: 0 FAIL. WARNs, with reasons:
- `target` at 390px: the "All" filter button (40x30). render-check emulates
  a narrow viewport, not a touch pointer. Under `@media (pointer: coarse)`
  every target is at least 44x44 (segment buttons get `min-width: 44px`).
  Captures with touch emulated (`scripts/shoot.mjs --touch`) show it.
- `ration`: three radii (6, 4, 3). The 4px radius is the concentric inner
  corner of a 6px control with 2px padding; 3px is for marks smaller than
  text. One language, derived.

Known gap: a Chinese board falls back to the system CJK face. The skill's zh
rule wants a self-hosted face; for an offline single file that means
embedding a subset per board. Deferred; it is an option on the
design-review board.

## The landing page

`site/index.html`, built by `scripts/site.mjs`. Mode: persuade. It is a new
surface in the same world: it takes its tokens from `board.css` at build
time and adds no color, no face and no radius.

Composition: **first viewport is the product running** (dealt first of
three at surface scope; roll key `503b4783`; the other two, "sponsor seats
as a numbered plate" and "pricing as one slider", have nothing to stand on:
no sponsors, no price). The live sample board owns the first viewport at
working size. The offer, one action (Install) and three steps to try stand
beside it. The sample opens in the reading view (see the second review, below). On a phone the sentence
comes first, then the board in its phone form, then the steps; Install
stays in the top bar. Below: the loop, two claims shown on real cards, four
boards, the install lines, three limits. The promise is the first comment
in the page's body.

Rules that the first review set (2026-10-09, a reviewer who did not build
the page; disposition: rebuild the first viewport, fix the rest):
- The signal color is on an ask and nowhere else. The page has no lamp of
  its own and its caption on the frame is paper, not signal. The brand mark
  is ink.
- No dot grid on the page: on the desk it is a snap grid; here nothing snaps.
- No grid of claims. A claim the sample cannot show is shown on a real card
  of a real board, cropped at reading size, by day and by night.
- What the page quotes from the product is taken from the product at build
  time: the reply text, the colors, the count of cards.
- Pictures are taken on a machine whose `system-ui` is a real sans face.
  The first set was set in a monospace fallback and misrepresented the page.
- The sample keeps nothing between visits (`?fresh`), so the page around it
  never contradicts it.

The page exists twice: `site/index.html` and `site/zh/index.html`, written
by hand in each language over one stylesheet (`site/landing.css`). The
Chinese page frames the Chinese sample, sets its text at a leading of 1.75
and a measure of 34 em, breaks its headline between its two clauses, and
carries a subset of Noto Sans CJK SC made at build time, as a Chinese board
does.

Check: `kit/check.sh --no-zh --tokens skill/runtime/board.css site/index.html`
runs clean (`--no-zh`: the English page carries one Chinese word, the link
to the other page). For the Chinese page the check runs on the built file,
because its font is put in at build time:
`kit/check.sh --zh --tokens _site/zh/index.html _site/zh`, also clean.
`kit/render-check.mjs` on the served page: no fail, one warning with its
reason: three corner radii. They are the board's own concentric set (6 for
cards and controls, 4 nested inside them, 3 for marks smaller than text),
used here for the same three things. Type: six sizes (12, 13, 15, 17, 20,
30).

Rules that the second review set (2026-10-09, another reviewer; its
disposition: fix):
- Working size means the text of the sample at its real size. In the frame
  the sample opens in the reading view: with gists from 880 px of frame
  width, as a list of claims below. The desk is one press away, and the
  steps say so; a desk fitted into the frame was a map at 59 to 77%.
- Under 1100 px the steps sit below the frame, so the caption on the frame
  gives the first one.
- The sample stays a sample across its own language link, and says so when
  you send.
- Every number about a board (cards, revision, open asks) is read from the
  board at build time. Two were typed by hand and were wrong.
- A tile's picture starts at the head of the section its caption names.
- On a phone the two "shown" cards are separate pictures taken at phone
  width, not the desktop pictures at 27%.

Done from the second review's last point: under the first viewport the
page no longer restates the loop in three boxes. It shows one card of the
sample in its three forms: its source in `board.org` (read from the file at
build time), the card as the page draws it (a picture of the real card), and
the reply. After the visitor presses Send in the sample, the third form is
their own reply, read from the frame; it does not leave the page.
Not seen on a real device.
