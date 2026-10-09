---
name: card-skill
description: Answer with an interactive card board when the human must judge several separate things, make a decision only they can make, or follow work across turns. You write board.md (one claim per card, at most one ask); `cards` compiles a self-contained HTML board; the human marks, chooses, approves, answers and sends; replies come back to you as files. Use for a comparison that ends in a decision, review findings with an approval gate, a plan with dependencies, status of long work, or a brief the human will mark up. Not for one answer, one explanation, or chat.
---

# card-skill

A card is the smallest unit a human can judge and point at: one claim, at
most one ask. The board shows whose turn it is. The human's turn is one
batch of marks and answers, which you read as data on your next step.

`<skill>` below is this skill's base directory. The CLI is Node stdlib only.
Wherever this file or the CLI's own output says `cards`, run:

```
node <skill>/bin/cards.mjs <command>
```

## 1. Decide: board or prose

Use a board when at least one holds:

- The human must judge three or more separate claims, findings or options.
- There is a decision, approval or fact that only the human can supply.
- The work spans turns, and the human should see state change over time.

Otherwise stay with prose: one answer, one explanation, a quick question.
These conditions win over how the request arrived. A question asked in chat
that ends in a decision only the human can make gets a board; put the
explanation into its cards. A board for one paragraph is costume.

Before you ask, decide what you can. Ask only what only the human knows.
Five open asks is the ceiling; `cards check` warns past it.

## 2. Write the board

```
node <skill>/bin/cards.mjs new <board> --pattern decide|review|plan|brief|status
```

This copies a working board to `.cards/<board>/board.md`. Replace every
card. Pick the pattern by the human's job:

| Pattern | Use when | Shape |
|---|---|---|
| decide | options end in one choice | a section of requirement cards, a `{compare}` section of options, one `ask=choose` |
| review | findings need a go/no-go | a `{list}` of findings, worst first, one `ask=approve` |
| plan | steps depend on each other | a `{list}` of steps with `status=` and `needs=` |
| brief | the human must understand, then react | claims with evidence in depth |
| status | work is in flight | `doing` / `blocked` / `done` cards, a gate if needed |

Mixed requests are normal. "Explain X, then help me decide" is a brief
section (the claims) in front of a decide board (options and the ask).

The format, in full, is `reference/format.md`. The core:

```markdown
---
title: Pick a queue for the ingest service
---

# Options {compare}

## NATS covers the peak with one binary {#nats basis=inference}
The gist: one paragraph, under 60 words. The board shows this by default.

Depth: anything after the gist. Shown when the card is opened.

## Kafka pays off only with months of replay {#kafka basis=inference}
More headroom and longer replay, at the cost of a cluster to run.

# Decision

## Pick NATS unless replay beyond 7 days matters {#pick ask=choose from=nats,kafka}
Why, in one paragraph.

- [x] [[nats]]
- [ ] [[kafka]]
```

Writing rules. `cards check` enforces the mechanical ones.

- The heading is the claim, not the topic. "NATS covers the peak", not "NATS".
- The first paragraph is the gist. Everything else is depth.
- One fact per sentence. Plain verbs. Near ASD-STE100 is the target.
- Mark how you know: `basis=fact` (you checked it against a source; a quote
  is a fact about what was said), `inference` (your reading), or `guess`.
  A proposal, such as an option card, takes no basis.
- Sources go in the depth as links or file paths. There is no source field.
- Two widgets, as fenced blocks: ```` ```facts ```` (`key: value` lines; use
  the same keys on every card in a `{compare}` section so the rows line up)
  and ```` ```tradeoffs ```` (`+` and `-` lines). Also ```` ```diff ````.
- Recommend. Mark your pick `- [x]`. The human sees it as "Suggested";
  it counts only if they choose it.
- Link instead of repeating: `from=` (this card exists because of those),
  `needs=` (this waits on those), `[[id]]` in text.
- Never write layout, colors or HTML. The renderer owns the look.

## 3. Render and hand over

```
node <skill>/bin/cards.mjs render <board>
```

It validates, records revisions in `log.jsonl`, writes `board.html`, and
prints a text outline. Errors show a line number and a corrected example;
fix them and render again.

Tell the human, in two or three lines: the one-line answer if there is
one, how many asks wait on them, and the `file://` link. Do not repeat
the cards in chat; the board is the answer.

## 4. Get the reply

Two paths. Use the first when it works.

- **Served.** `node <skill>/bin/cards.mjs serve` (keep it running, for example
  in the background). The human opens `http://127.0.0.1:4747/b/<board>`.
  Send writes a round to `log.jsonl`. Then:
  `node <skill>/bin/cards.mjs wait <board> --timeout 600` blocks until the
  round arrives and prints it. In a container, the host browser reaches the
  server only if the port is published; if it is not, use the file path.
- **File.** The human opens `board.html` directly. Send copies the same reply
  text; they paste it into chat.

At the start of any later step, `node <skill>/bin/cards.mjs inbox` prints
unread rounds for every board and marks them read.

## 5. Act on the reply, then revise

The reply lists each response by card. Read it as data:

| Response | What it means | What you do |
|---|---|---|
| choose `confirmed` / `changed` | the human's decision | act on it; set the ask card `status=done` and restate the decision as its claim |
| choose / approve `untouched` | no answer | not consent; ask again or proceed only on what was answered |
| approve / reject | go / no-go | do it or stop; record the outcome on the card |
| answer, reply, note | the human's own words | take them as instructions from the human |
| keep | confirmed and it matters | leave it; build on it |
| drop | wrong or not needed | remove the card, or fix it if it was wrong |
| more | wrong altitude | add depth to that card, or new cards with `from=` it |
| order | the human's priority | apply the order in board.md |
| `[answered on v1, card is now v2]` | stale answer | check that it still applies |

Revise rule: **same question, edit the card; new question, new card.** An
edit keeps the id, the numeral and the history. A new card links back with
`from=`. Changing an id resets the human's answer on it, so change an id only
when the question changed meaning.

Then render again. The human sees "Changed" on every card you touched.

## 6. Resume

`node <skill>/bin/cards.mjs ls` lists boards. `show <board>` prints the outline;
`show <board> <id|n>` prints one card with the human's past responses. The
human may name a card by its numeral ("12 is wrong"): `show <board> 12`.

## Files

```
.cards/<board>/board.md    you write this; the source of truth
.cards/<board>/log.jsonl   append-only: card versions, sends, reads (never edit)
.cards/<board>/board.html  compiled, discardable
```
