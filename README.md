# card-skill

An agent-native card system. The agent answers with a board of cards. You
judge the cards one by one and send one batch back. The agent reads your
batch as data and revises the board.

A card is the smallest unit you can judge and point at: one claim, at most
one ask. Most agent replies should stay prose. Cards are for several separate
judgments, a decision only you can make, or work that spans turns.

## What you see

Open a board. The top line says whose turn it is: "Your turn, 3 waiting on
you". Below it, sections of cards. Each heading is a claim, so a scan of the
headings is a scan of the conclusions.

- A yellow-red tab stands up on each card that waits on you: Choose,
  Approve?, or Answer. The agent's recommendation shows as "Suggested". It
  does not count until you pick it.
- Every card takes Keep, Drop, More, and a reply. More means "go deeper".
- Click a card to open it. Related cards stay lit and say how they relate
  ("Source", "Option", "Waits on this"); the rest dims. Nothing is drawn.
- The toolbar: All / Yours / Changed, then Claim / Gist / Full (how much of
  each card shows), order, find, and Send.
- Drag a card by its grip to reorder it. The order goes back as your priority.
- Send. With `cards serve`, the reply is written to disk for the agent. With
  a plain file, Send copies the reply for you to paste.

Keys: `j`/`k` move, `Enter` opens, `n` jumps to the next ask, `1 2 3` set the
detail, `= - m` mark Keep / Drop / More, `r` replies, `/` finds,
`Ctrl+Enter` sends, `?` lists all.

## Try it

```
node skill/bin/cards.mjs render design-review
```

Open the printed `file://` link. That board is this project's design,
waiting on your decisions. To send replies straight to disk:

```
node skill/bin/cards.mjs serve        # then open http://127.0.0.1:4747/b/design-review
node skill/bin/cards.mjs inbox        # what the agent reads
```

## Install as a skill

```
cp -r skill ~/.claude/skills/card-skill
```

The agent reads `skill/SKILL.md`: when to use a board, how to write one, and
the loop. Node 18 or later. No dependencies.

## How it works

```
agent writes            cards render                 you open
.cards/<b>/board.md --> parse, check, diff --> .cards/<b>/board.html
                              |                        |
                        .cards/<b>/log.jsonl <---- Send (served) or Copy (file)
                              |
agent reads <---- cards wait / cards inbox
```

- `board.md` is the source of truth: markdown, one H2 per card. Spec:
  `skill/reference/format.md`.
- `log.jsonl` is append-only memory: card versions, your sends, the agent's
  reads. Revisions are derived, so the agent cannot forget history.
- `board.html` is one self-contained file. Delete it any time.

## Repo

```
skill/                the installable skill
  SKILL.md            the policy: when, how, the loop
  reference/format.md the board.md spec
  bin/cards.mjs       CLI: new check render show ls serve wait inbox
  lib/                parser, lint, markdown subset, log, compiler, server
  runtime/            the page: board.html, board.css, board.js, digest.js
  templates/          five working boards: decide review plan brief status
test/                 node --test: kernel + browser end-to-end
.cards/design-review/ the design proposal, as a board
docs/STATUS.md        where the work is and what is next
docs/DECISIONS.md     every design decision, with its reason and alternatives
docs/research/        the research behind the decisions
DESIGN.md, TASTE.md   the visual material and its rulings
vault/                Karpathy's posts on agent output (verbatim sources)
```

## Test

```
npm test                    # or: node --test 'test/*.test.mjs'
```

The browser tests need Playwright with Chromium. They skip without it.
