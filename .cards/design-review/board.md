---
title: card-skill, the design, for your decision
---

This board is the card-skill proposal, rendered by card-skill. Read the claims. Open a card for the reasons. Answer the flagged asks, then send. Sources are in `docs/research/` and `vault/`.

# The idea

## A card is the smallest unit you can judge and point at {#unit-of-judgment basis=inference}
Agents now produce more than people can read. The human job is to judge the output. You can only judge a wall of prose as a whole. You can keep, drop, answer or question a card on its own.

Karpathy names the job: "a lot more of our work will rise up the abstractions into oversight and understanding" (`vault/sources/x/karpathy-2026-10-02-understand-outputs.md`). In 2025 he said that generation got cheap and discrimination did not (`karpathy-2025-06-04-verification-gap.md`). In May 2026 he asked to "point and gesture at the screen" (`karpathy-2026-05-11-html-mind-meld.md`). A card is the unit you point at. Its numeral lets you point in words too: "card 12 is wrong".

## Each card asks for at most one thing, and the board shows whose turn it is {#one-ask basis=inference from=unit-of-judgment}
A card is either something to read or one of three asks: choose, approve, answer. The top line counts what waits on you, so you never search for the questions.

The turn line has five states: your turn, ready to send, the agent's turn, agent working, nothing waiting. This removes the human as the wait state: the agent batches its questions, and you answer them in one pass.

## Cards are earned; most agent replies stay prose {#cards-earned basis=inference}
Use a board for several separate judgments, for a decision only the human can make, or for work that spans turns. One explanation is a paragraph or a page, not a board.

The skill states the trigger as a rule and a counter-rule. answer-me-with-html says "use it proactively and liberally"; we do not (`docs/research/answer-me-with-html.md`). The lint warns at more than five open asks: decide more yourself, and ask only what only the human knows.

# Primitives

## Five primitives carry the whole system {#five-primitives basis=fact}
Board, section, card, link, response. A revision is not a primitive: the compiler derives revisions on every render.

```facts
board: one board.md, one log, one page
section: an ordered group: grid, compare or list
card: claim, gist, depth; at most one ask
link: `from=`, `needs=`, `[[id]]` in the text
response: keep, drop, more, choose, approve, answer, reply, order, note
```

The format is in `skill/reference/format.md`. For comparison, Adaptive Cards has 21 element types and A2UI's basic catalog has 18 components (`docs/research/agent-ui-protocols.md`).

## The heading is the claim, the first paragraph is the gist, the rest is depth {#altitude basis=inference}
Zoom changes altitude, not pixels: Claim, Gist, Full. The writing convention alone gives three levels, with no extra fields. More is the direct control for an answer at the wrong altitude.

The wrong-altitude failure is the sharpest complaint in the vault: an interactive page can still "explain at the wrong level of abstraction" (@eliebakouch, in `karpathy-2026-10-02-understand-outputs.md`). At Claim altitude a board reads as a list of conclusions. That is the scan.

## Meaning decides looks; the agent has no style controls {#no-knobs basis=inference}
The agent says what a card is: its ask, status and basis. The renderer decides how it looks. Every board looks like every other board, so people learn it once.

A2UI removed `theme` from its protocol "to separate layout from branding". An HN practitioner: "Generative UI is incompatible with learning" (`docs/research/agent-ui-protocols.md`). open-design says it plainly: "agent/plugin output is data; OD owns the renderer" (`docs/research/open-design.md`).

# Connected cards

## No canvas and no drawn edges: position, address and light {#no-canvas basis=inference}
Sections give reading order. Numerals give addresses. Focus lights the related cards, names each relation, and dims the rest. Nothing is drawn, so nothing tangles at 30 or 200 cards.

The prior-art study found that a canvas helps when the human places the cards, because the placing is what people remember. Here the agent places them, so a canvas would bring the cost without the benefit. Builders' verdicts include "bleeds to death from a whole bunch of paper cuts" and "descended into messy chaos no matter what you did" (`docs/research/connected-cards-prior-art.md`). Luhmann's Zettelkasten linked its cards by address and placement, not by lines.

## Two links carry lineage and dependency; mentions carry the rest {#links basis=inference from=no-canvas}
`from=` says this card exists because of that one. `needs=` says this card waits on that one. `[[id]]` mentions anything. Focus names each link on the related card, with the focused card's numeral: "Source of 8", "Blocks 8", "Mentions 8".

One vocabulary serves both views: the label on a lit card and the list on the focused card. When two cards connect in more than one way, the most specific name wins: a decision card that lists an option says "Decides 3", not "Follow-up of 3".

## Same question, revise the card; new question, new card {#revise-or-new basis=inference}
This rule tells the agent when to update and when to add. A revision keeps the numeral and puts the old version behind it. A new card links back with `from=`.

Slack Block Kit has the same rule: the same `block_id` keeps the user's input, and a new id resets it (`docs/research/agent-ui-protocols.md`). The compiler records versions itself, so the agent cannot forget history.

# The loop

## The agent writes board.md; the compiler owns the rest {#files-over-app basis=fact}
The source, the memory and the view are separate files. History survives because the compiler diffs board.md against the log on every render.

```facts
board.md: the agent's intent, readable in any editor
log.jsonl: append-only: card versions, sends, reads
board.html: compiled, self-contained, discardable
```

This follows Karpathy's file-over-app rule: memory that is "explicit, local, files" (`vault/sources/x/karpathy-2026-04-04-file-over-app.md`).

## Replies reach the agent as files, not as copy-paste {#return-channel basis=fact}
With `cards serve`, Send writes a round to `log.jsonl`, and `cards wait` wakes the agent. Without a server, Send copies the same text for you to paste. An untouched ask is reported as untouched, never as consent.

The end-to-end test runs this loop in a real browser: choose, mark, reply, send, undo, send, read, revise, live update (`test/e2e.test.mjs`). The server binds to loopback only, requires a per-run token and this server's Origin on every write, allows only its own Host names, takes board ids as slugs and never as paths, and checks every reply item by kind. A code review found three holes in the first version; each one now has a regression test (`test/review.test.mjs`).

## Every render also prints a text outline to the terminal {#outline-fallback basis=fact}
The terminal gets the board as text, so a turn is useful even if nobody opens the page.

# Design language

## Kanban signal cards on a steel rack {#signal-cards basis=inference}
Card stock on cool steel, in one ink. A yellow-red tab stands up only where the agent waits on you; the same tabs line up under the title as the andon rail. Blue marks only your own acts and focus. Two colors, one meaning each.

An answered tab turns to a blue outline that says what you did: Chosen, Approved, Answered.

The design roll (`f3a39d30`, pool of 7) assigned the Toyota kanban world. Three challengers each added one rule: reference numerals and a single highlight tint from patent drawings; one color per role from the Munich 1972 pictogram program; a struck line for a superseded version from bamboo-slip manuscripts. The colors come from the JIS Z 9103 safety colors used on factory floors. The full record is in `DESIGN.md`.

# What the research changed

## From answer-me-with-html: draft plus renderer, and errors that show the fix {#from-amwh basis=fact}
We took the split between a short markdown draft and a renderer, and errors that include a corrected example. We also took "no answer is not agreement". We fixed its weak point, the copy-paste return path, with stable ids, revisions, and files.

## From open-design: a fixed runtime and stable ids; we did not take the weight {#from-od basis=fact}
We took the ideas: the agent never writes the runtime, every element you can point at has a stable id, and answers are stored state. We left the 800k lines, the SQLite store, and the checks that are never called.

## From Flowith and the canvases: branching is a way out, not a view {#from-canvas basis=inference}
People want to branch to escape a messy thread, not to look at a tree. `from=` gives a branch a home without drawing one.

# Your decisions

## Keep the connection model: sections, numerals and focus light, with no edges? {#ask-connection ask=choose from=no-canvas,links}
This is the biggest bet. A spatial canvas is the main alternative. The research says a canvas costs arranging time and tangles past 30 cards.

- [x] Yes: no canvas and no edges
- [ ] Add a lineage view: one card's from= chain as a thread
- [ ] Add an optional spatial canvas view

## Make the local server the default return path? {#ask-server ask=choose from=return-channel}
The server closes the loop without copy-paste. It is one more process. It binds to loopback only, so a browser outside this container cannot reach it yet; that needs a capability URL (D12).

- [x] Server when reachable, copy as the fallback
- [ ] Copy-paste only, no server
- [ ] Both, plus a Claude Code hook that injects unread replies

## Approve the visual direction: kanban signal cards on a steel rack? {#ask-visual ask=approve from=signal-cards}
If you reject it, I roll the direction again and take your reason as the brief.

## What should the agent build next? {#ask-next ask=choose multi}
Pick any. The order on this card is my recommendation.

- [x] An install step and a Claude Code hook for unread replies
- [ ] A diagram card (sanitized SVG) for when the structure is the claim
- [ ] A lineage view for long from= chains
- [ ] An embedded CJK font subset for Chinese boards
- [ ] A project index that links boards to each other

## Name one real task from your week for the first real board {#ask-dogfood ask=answer}
Example content does not test anything. A real task tests the trigger rule, the patterns and the loop against reality.
