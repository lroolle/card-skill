# TASTE.md -- scars

Rulings this project made on evidence. Each carries its why. Delete a scar
when its expiry condition arrives. Material lives in DESIGN.md.

## 2026-10-08 rejected: Send scrolled out of reach on a phone

Why: the toolbar scrolled sideways as one strip; at 390px Send sat past the
right edge, so the one action that ends the human's turn was hidden.
Where: capture of the decide board at 390px, first build.
Landed: `.send` sits outside `.tools`; on phones the bar is two rows with Send on the first (board.css).
Reuse: the primary action never shares a scroll container with secondary tools.
Expires: never (behavioral).

## 2026-10-08 rejected: ghost marks on every card

Why: Keep / Drop / More / Reply at 45% opacity on 21 cards: 84 labels at
1.9:1 contrast, a third of each card's height. Prettier at a glance, harder
to use: costume.
Where: design review round 1, captures of the design-review board.
Landed: `.acts` is an overlay on the address line, shown under pointer or
focus; a chosen mark prints as a stamp (board.css, board.js).
Reuse: never lower a control's contrast to quiet it; show it when it is
relevant instead.
Expires: never (perceptual).

## 2026-10-08 rejected: blue on the agent's state

Why: blue means the human's own act and focus. "Changed" and the agent's
turn lamp in blue told the reader they had done something they had not.
Where: design review round 1.
Landed: `.chg` in ink; the agent lamp is an outline in `--fg-3`.
Reuse: a color with a role is never used for another role.
Expires: never (behavioral).

## 2026-10-08 rejected: a suggested option shown as already chosen

Why: a pre-selected default reads as the human's answer, and an untouched
ask would be reported as agreement.
Where: design of the choose card, from the answer-me-with-html teardown.
Landed: `.opt.suggested` is a dashed ring, filled only when picked; the
digest reports `untouched (suggestion kept; not consent)`.
Reuse: the page never shows the agent's choice as the human's.
Expires: never (behavioral).

## 2026-10-09 rejected: the desk made the page wider than the phone

Why: the first desk let the page scroll sideways. A mobile browser then
widens its layout viewport to the page, and the fixed toolbar moved with it:
Send sat at y=2446 on an 844px screen. The scar from 2026-10-08 came back
through a new view.
Where: desk view at 390px with touch emulated, before the fix.
Landed: `.view-desk .shelves` scrolls sideways inside itself; the page never
gets wider than the window (board.css). The test "desk on a phone" in
`test/e2e.test.mjs` pins it.
Reuse: a wide surface scrolls inside its own container, never the page.
Expires: never (behavioral).

## 2026-10-09 rejected: a line that passes behind a card

Why: a line from column 1 to column 3 ran behind a card in column 2, and it
looked like it ended on that card. A line that implies a link that does not
exist is a false statement.
Where: the first desk build, design-review board, card 22 to card 17.
Landed: lines cross a column only in a gap between cards (`crossing()` in
board.js); `test/e2e.test.mjs` samples the path and fails if it enters a card.
Reuse: a drawn relation must not touch anything it does not relate.
Expires: never (perceptual).

## 2026-10-09 rejected: a dash that meant two things

Why: to show that a desk line passes a column without touching it, the
crossing run was drawn dotted, then dashed. A dash already meant a mention
(and a weak arrow in a flow figure). On a real Mac at 1x the reviewer read a
source line as a mention.
Where: the desk, card 22 to card 17, in a review on a Mac.
Landed: the crossing run is solid; it lies in a gap, so it touches no card.
Mentions are dashed 4-3, the same dash as a weak arrow in a flow.
Reuse: a line style with a meaning is never used for another meaning, as
with color.
Expires: never (perceptual).

## 2026-10-09 rejected: a column one letter wide

Why: text in a card broke "anywhere" so that nothing could stick out. A table
then set "faceup" as "faceu / p", and a fact with a long key left its value
one letter per line. The human: "narrow cards are like bad in rendering the
table".
Where: the progress board, the names table and the facts of card 36, on the
desk at 288px and in the reading view.
Landed: words stay whole in tables and facts. A fact's key takes at most two
fifths of the row. A table that cannot fit shows each row as a block with
named fields; on the desk the column widens for it at Full, and the human
can set a card's width.
Reuse: never buy a narrow column by breaking words; change the layout of
the thing instead (stack it, widen it, or let it scroll).
Expires: never (perceptual).

## 2026-10-09 rejected: cards with no edge to speak of

Why: a card was a 1px rule in `--line` on the rack, with no shadow ("structure
before shadow"). The human asked for "better card details like border and
shadow". On a light rack the cards did not read as sheets you can pick up,
and on the desk they are exactly that.
Where: every card, both views.
Landed: a firmer edge and the shadow of a sheet that lies flat; a small lift
under the pointer and in focus; DONE and dimmed cards lie back with none.
Reuse: shadow is allowed for the one thing that is an object in the world of
the page (the card). Nothing inside a card gets one.
Expires: when the human rules again.

