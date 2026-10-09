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
