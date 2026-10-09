# DESIGN.md -- the material

Read this before touching `skill/runtime/`. `TASTE.md` holds prior rulings;
this file holds the material. The one-line test for any UI change: **a change
that makes the surface prettier and the task harder must fail.** Run the
design-skill `kit/check.sh --tokens skill/runtime/board.css skill/runtime`
after every edit, and `kit/render-check.mjs` on a rendered board before a
release.

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
| Surfaces | 1px rules, card on rack; no shadow except the floating toolbar and dialogs | structure before shadow |
| Density | Gist (default): claim + gist + facts + ask. Claim: a ruled ledger, one row per card, about 25 per viewport. Full: everything | never delete information to breathe |
| Motion | 140ms ease-out for focus and dimming; a 1.2s fade-out ring on live-changed cards; nothing else moves | reduced motion removes all of it |
| Icons | two: grip and search, 1.5px stroke, inline SVG | text labels everywhere else |
| Figures | a drawing panel on the card: 1px `--line` frame, `--r-in`, 12px mono; a sketch in `--fg`; flow boxes stroked `--fg-3` (bold box `--fg` 2px), arrows `--fg-3`, labels `--fg-2` with a card-stock halo; caption "Fig. n.k" in 12px | the card's one ink; no color in a figure, so the role colors keep their meaning |
| Files | an image is a figure with no padding: the frame clips it, `--surface-2` behind it, the file name and pixel size in 12px mono `--fg-3` after the caption. An excerpt is a `pre` with its path in mono `--fg`, its range in `--fg-3`, line numbers in a `--fg-3` gutter that copy does not take; 12 lines show, a `summary` opens the rest. A chip is a `--surface-2` pill: type in strong `--fg-2`, name in mono, size in `--fg-3`. The viewer is a `dialog` on an opaque `--bg`, the image with the card shadow, a bar with the caption and a 44px Close | an image keeps its own colors: it is evidence, not our drawing. This is the one exception to "no color in a figure"; a screenshot of a board shows its tabs and lines, and the caption names it as a picture |
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
