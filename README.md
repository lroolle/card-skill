# card-skill

An agent-native card system. The agent answers with a board of cards. You
judge the cards one by one and send one batch back. The agent reads your
batch as data and revises the board.

A card is the smallest unit you can judge and point at: one claim, at most
one ask. Most agent replies should stay prose. Cards are for several separate
judgments, a decision only you can make, or work that spans turns.

## What you see

Open a board. The top line says whose turn it is: "Your turn, 3 waiting on
you". Below it, the desk: one column per section, lines between linked cards,
zoomed to fit the whole board. Each heading is a claim, so a scan of the
headings is a scan of the conclusions.

- A yellow-red tab stands up on each card that waits on you: Choose,
  Approve?, or Answer. The agent's recommendation shows as "Suggested". It
  does not count until you pick it.
- Every card takes Keep, Drop, More, and a reply. More means "go deeper".
- A card about a shape shows it: a sketch or a box-and-arrow figure under
  the gist, numbered like the card ("Fig. 12.1").
- A card shows its evidence itself: a screenshot (click for full size), an
  excerpt of a file with its line numbers, or a chip for any other file.
  The page carries them; it stays one file.
- The buttons and help speak the board's language (`#+language:`): English
  and Simplified Chinese ship.
- Click a card to open it. Related cards stay lit and say how they relate
  ("Source of 8", "Option of 17", "Needs 4"); the rest dims.
- The desk: grey lines are sources, red lines are needs, violet lines with a
  diamond are the options of a decision; the key at the top names them.
  Fit, 50% and 100% zoom (`z`); click a card to zoom to it, Esc to go back.
  Drag a card by its top strip to place it yourself; Arrange puts every card
  back in its section. `D` switches to the rack, a reading view.
- The toolbar: All / Yours / Changed, then Claim / Gist / Full (how much of
  each card shows), Desk, order, find, and Send. Send carries your card
  answers in one batch.
- The chat box in the bottom-right corner (`c`) talks to the agent about the
  whole board. Enter sends a message now, apart from your card answers; the
  agent answers with `cards say`, and a yellow-red dot on the closed box
  means it wrote.
- Drag a card by its grip to reorder it. The order goes back as your priority.
- Send. With `cards serve`, the reply is written to disk for the agent. With
  a plain file, Send copies the reply for you to paste.

Keys: `j`/`k` move, `Enter` opens, `n` jumps to the next ask, `1 2 3` set the
detail, `d` toggles desk and rack, `z` zooms, `c` opens the chat, `= - m` mark Keep / Drop / More, `r` replies, `/` finds,
`Ctrl+Enter` sends, `?` lists all.

## Try it

Open `.cards/design-review/board.html` in a browser. It is the built-in
example: this project's own design, written as a board, with its history in
`log.jsonl` (rev 11, two review rounds answered). To render it again, or to
send replies straight to disk:

```
node skill/bin/cards.mjs render design-review
node skill/bin/cards.mjs serve        # then open http://127.0.0.1:4747/b/design-review
node skill/bin/cards.mjs inbox        # what the agent reads
node skill/bin/cards.mjs say design-review "Got it."   # the agent's answer in the chat box
```

## Install as a skill

```
cp -R skill ~/.claude/skills/card-skill
```

A real copy, not a link. The copy does not follow the repo: after an update,
remove it and copy again. The agent reads `SKILL.md`: when to use a board,
how to write one in Org, and the loop. Node 18 or later. No dependencies.

## How it works

```
agent writes            cards render                 you open
.cards/<b>/board.org -> parse, check, diff --> .cards/<b>/board.html
                              |                        |
                        .cards/<b>/log.jsonl <---- Send (served) or Copy (file)
                              |
agent reads <---- cards wait / cards inbox
```

- `board.org` is the source of truth: plain Org mode, one `**` heading per
  card. Spec: `skill/reference/format.md`. An older `board.md` still renders.
- `log.jsonl` is append-only memory: card versions, your sends, the agent's
  reads. Revisions are derived, so the agent cannot forget history.
- `board.html` is one self-contained file. Delete it any time.

## Repo

```
skill/                the installable skill
  SKILL.md            the policy: when, how, the loop
  reference/format.md the board.org spec, figures included
  reference/writing.md the writing profile, near ASD-STE100
  bin/cards.mjs       CLI: new check render show ls serve wait inbox say
  lib/                parsers (Org, markdown), lint, figures, log, compiler, server
  runtime/            the page: board.html, board.css, board.js, digest.js
  templates/          five working Org boards: decide review plan brief status
test/                 node --test: kernel, figures, browser end-to-end
.cards/design-review/ the design proposal, as a board
docs/STATUS.md        where the work is and what is next
docs/DECISIONS.md     every design decision, with its reason and alternatives
docs/research/        the research behind the decisions
DESIGN.md, TASTE.md   the visual material and its rulings
```

## Test

```
npm test                    # or: node --test 'test/*.test.mjs'
```

The browser tests need Playwright with Chromium. They skip without it.
