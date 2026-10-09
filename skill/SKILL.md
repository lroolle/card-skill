---
name: card-skill
description: Answer with an interactive card board when the human must judge several separate things, make a decision only they can make, or follow work across turns. You write board.org (Org mode; one claim per card, at most one ask); `cards` compiles a self-contained HTML board with a desk view that draws the links; the human marks, chooses, approves, answers and sends; replies come back to you as files. Use for a comparison that ends in a decision, review findings with an approval gate, a plan with dependencies, status of long work, or a brief the human will mark up. Not for one answer, one explanation, or chat.
license: MIT
metadata:
  version: "0.1.0"
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

This is cards 0.1.0. `cards render` ends with the version of the build
that ran. If it names another version, this text is older than the code: a
session keeps the SKILL.md it loaded at its start. Read `<skill>/SKILL.md`
and `<skill>/CHANGES.md` again from disk. Do not edit this copy of the
skill: an update replaces it. The source and its tests are in the
repository that `cards --version` prints.

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

This copies a working board to `.cards/<board>/board.org` (`.cards/` is in
the current directory; `CARDS_ROOT` overrides it). Replace every card, or
write `board.org` from scratch. Pick the pattern by the human's job:

| Pattern | Use when | Shape |
|---|---|---|
| decide | options end in one choice | a section of requirement cards, a `:compare:` section of options, one `:ASK: choose` |
| review | findings need a go/no-go | a `:list:` of findings, worst first, one `:ASK: approve` |
| plan | steps depend on each other | a `:list:` of steps with TODO keywords and `:NEEDS:` |
| brief | the human must understand, then react | claims with evidence in depth |
| status | work is in flight | `DOING` / `BLOCKED` / `DONE` cards, a gate if needed |

Mixed requests are normal. "Explain X, then help me decide" is a brief
section (the claims) in front of a decide board (options and the ask).

The format, in full, is `reference/format.md`. It is plain Org mode. The core:

```org
#+title: Pick a queue for the ingest service
#+todo: TODO DOING BLOCKED | DONE

* Options  :compare:

** NATS covers the peak with one binary
:PROPERTIES:
:CUSTOM_ID: nats
:BASIS: inference
:END:
The gist: one paragraph, under 60 words. The board shows this by default.

Depth: anything after the gist. Shown when the card is opened.

** Kafka pays off only with months of replay
:PROPERTIES:
:CUSTOM_ID: kafka
:BASIS: inference
:END:
More headroom and longer replay, at the cost of a cluster to run.

* Decision

** Pick NATS unless replay beyond 7 days matters
:PROPERTIES:
:CUSTOM_ID: pick
:ASK: choose
:END:
Why, in one paragraph.

- [X] [[#nats]]
- [ ] [[#kafka]]
```

Writing rules. `cards check` enforces the mechanical ones.

- The heading is the claim, not the topic. "NATS covers the peak", not "NATS".
- The first paragraph is the gist. Everything else is depth.
- Write near ASD-STE100 (`reference/writing.md`): one fact per sentence,
  25 words at most, active verbs in the present tense, the same word for the
  same thing, and plain words ("use", not "utilize" or "leverage").
- Show, then tell. When a claim is about a shape (a layout, a view, a flow,
  a structure, a before and after), draw it under the gist: `#+caption:`,
  then `#+begin_src sketch` (text characters) or `#+begin_src flow`
  (`a -> b: label` lines; the compiler places the boxes). A decision about a
  view or a UI shows each option as a figure. Do not draw a single fact.
- Show the evidence itself when it is a file. A screenshot or a chart:
  `#+caption:` then `[[file:../../shots/x.png]]` alone on a line. Code or a
  log: `#+include: "../../src/x.js" src js :lines "40-61"` (lines 40 to 60;
  as in Org, the upper end is not included). Paths are relative to
  `board.org`; the file must be in the project. The page carries the file,
  so keep images under 1 MB and excerpts to the lines that matter.
- Write the board in the human's language and set `#+language:` (`en`,
  `zh-Hans`, ...). The page chrome follows it. When the human wants the
  board in a second language, write a second board next to the first with
  `#+translation_of: <first board>`, the same card ids and the same option
  keys. The two pages link to each other; `cards check` on the translation
  says which cards fell behind.
  A Chinese, Japanese or Korean board carries its own font when the machine
  has an open CJK font and fonttools; `cards render` says once whether it
  does, and `reference/format.md` ("A font in the page") says how to set
  that up.
- `#+author:` names who wrote the board (you, and for whom). `#+description:`
  is the one line a link preview shows; without it the lede is used.
- Mark how you know: `:BASIS: fact` (you checked it against a source; a quote
  is a fact about what was said), `inference` (your reading), or `guess`.
  An ask card takes no basis. An option card takes one when its facts need
  it: put what you checked (a price, a size) in the facts rows, and your
  judgment ("the closest color match") in the gist, in words that say it is
  a judgment.
- Sources go in the depth as links or file paths. There is no source field.
  When the source is the human's own message, say so ("You said: ...").
- Facts are a description list, `- key :: value`; use the same keys on
  every card in a `:compare:` section so the rows line up. Other widgets
  are src blocks: `tradeoffs` (`+` and `-` lines), `diff`, and the two
  figures above. In running text, file paths and config keys go in
  `=verbatim=`, because Org reads `/a/b/` as italics.
- Status is the TODO keyword (`DOING`, `BLOCKED`, `DONE`); progress is a
  cookie at the end of the claim, `[3/8]`. Keep the `#+todo:` line under
  the title: it is what makes those keywords real to Emacs and GitHub.
- Four kinds of ask, at most one on a card: `choose` (options as
  checkboxes), `approve` (go or no-go on your work), `answer` (free text),
  `do` (an action only the human can take outside the board, such as a
  login or a payment; they answer Done or I cannot).
- Recommend. Mark your pick `- [X]`. The human sees it as "Suggested";
  it counts only if they choose it. When only the human can know (their
  wrist size, their budget), mark none and say so: `:SUGGEST: none`.
- Give an option a key when its words may change or will be translated:
  `- [X] nats :: NATS, one binary`. The reply names the key.
- One ask must not rest on another ask's open answer without saying so. If
  ask B depends on the answer to ask A, write `:NEEDS:` on B. Three forms:
  `:NEEDS: a` (B is written for the option you suggested in A; the page
  holds B back when the human picks another), `:NEEDS: a=link` (B applies
  only when A is answered `link`; write one B for each answer that needs
  one, and the page opens the one that fits), `:NEEDS: a=*` (B waits for A
  and takes any answer). The page keeps B off until A is answered.
- Link instead of repeating: `:FROM:` (this card exists because of those),
  `:NEEDS:` (this waits on those), `[[#id]]` in text. The desk draws these
  links as lines, so write the links that matter and no others. An option
  written as `[[#id]]` on a choose card is already a link; do not repeat it
  in `:FROM:`.
- Never write layout, colors, SVG or HTML. The renderer owns the look. A
  figure is content: you say what connects to what; the compiler draws it.

## 3. Render and hand over

```
node <skill>/bin/cards.mjs render <board>
```

It validates, records revisions in `log.jsonl`, writes `board.html`, and
prints a text outline (`--quiet` leaves the outline out). Errors show a
line number and a corrected example; fix them and render again. A warning
is a rule from this file that the board breaks, or syntax that does nothing
in this build; read each one.

Tell the human, in two or three lines: the one-line answer if there is
one, how many asks wait on them, and the `file://` link. The board opens on
the desk: one column per section, lines for `:FROM:`, `:NEEDS:` and
options. A small board opens with its gists; a large one opens as a map of
claims, each with its picture, and a click zooms to a card. `D` switches to
the rack, a reading view. Do not repeat the cards in chat; the board is the
answer.

Ask on the board and nowhere else. When a board is in use, a decision for
the human is an ask on a card. Do not put the same question into chat or
into a question dialog of your environment: the human answers on the cards,
in one batch, and the link is the hand-over.

You cannot see the page. When the layout matters (pictures, a comparison, a
board in a language you did not test), look at it:
`node <skill>/bin/cards.mjs shot <board>` writes a picture of the first
view where a browser is installed.

## 4. Get the reply

Two paths. Use the first when it works.

- **Served.** `node <skill>/bin/cards.mjs serve` (keep it running, for example
  in the background). The human opens `http://127.0.0.1:4747/b/<board>`.
  Send writes a round to `log.jsonl`. Then:
  `node <skill>/bin/cards.mjs wait <board> --timeout 600` blocks until the
  round arrives and prints it. In a container, the host browser reaches the
  server only if the port is published; if it is not, use the file path.
- **File.** The human opens `board.html` directly. Send copies the same reply
  text; they paste it into chat. Record that text before you act on it, so
  the board shows the answers:

  ```
  node <skill>/bin/cards.mjs ingest <board> <<'EOF'
  (the pasted reply, exactly as it came)
  EOF
  ```

At the start of any later step, `node <skill>/bin/cards.mjs inbox` prints
unread rounds for every board and marks them read.

## 5. Act on the reply, then revise

The reply lists each response by card. Read it as data:

| Response | What it means | What you do |
|---|---|---|
| choose `confirmed` / `changed` / `chosen` | the human's decision (`chosen`: you suggested none) | act on it, then close the ask (below) |
| choose / approve `untouched` | no answer | not consent; ask again or proceed only on what was answered |
| `held: #n changed ...` | this ask was written for your suggestion in #n, and the human chose otherwise | not an answer; rewrite the card for the new answer and ask again |
| `held: waits for #n` | the ask it needs has no answer | nothing yet |
| `held: not needed ...` | the ask applies to another answer of #n | nothing; close or remove the card |
| `[answered after #n changed]` | the human answered although #n changed | check that the answer still fits before you act |
| approve / reject | go / no-go | do it or stop; record the outcome on the card |
| do `done` / `cannot` | the human did the outside step, or could not | continue, or find another way |
| answer, reply, note | the human's own words | take them as instructions from the human |
| a round with only a `note` | a chat message, sent from the chat box | answer it with `cards say` (below); if it changes the board, revise and render |
| keep | confirmed and it matters | leave it; build on it |
| drop | wrong or not needed | remove the card, or fix it if it was wrong |
| more | wrong altitude | add depth to that card, or new cards with `:FROM:` it |
| order | the human's priority | apply the order in board.org |
| `[answered on v1, card is now v2]` | stale answer | check that it still applies |

Revise rule: **same question, edit the card; new question, new card.** An
edit keeps the id, the numeral and the history. A new card links back with
`:FROM:`. Changing an id resets the human's answer on it, so change an id only
when the question changed meaning.

Close an answered ask with one word: the keyword `DONE`. The card keeps
its ask and options as the record, and the page shows what the human
answered. `node <skill>/bin/cards.mjs settle <board>` does this for every
ask that has an answer on disk; `settle <board> <id>` for one. Restate the
claim only when the decision changes what the card says.

Then render again. The human sees "Changed" on every card you touched.

## 6. Answer in the chat

The board has a chat box in the bottom-right corner. A message the human
sends there arrives as its own round with one `note` item, apart from their
card answers. Answer it in the box:

```
node <skill>/bin/cards.mjs say <board> "Yes. I will add a card for managed Kafka."
```

Keep a chat answer to one or two sentences. Anything the human should judge
belongs on the board as a card, not in the chat. `say` also renders the
board, so a file page shows the answer after a reload; a served page shows
it at once. Then wait for the next round as usual.

## 7. Resume

`node <skill>/bin/cards.mjs ls` lists boards. `show <board>` prints the outline;
`show <board> <id|n>` prints one card with the human's past responses. The
human may name a card by its numeral ("12 is wrong"): `show <board> 12`.

## 8. Share a board

`board.html` holds the human's replies, the chat and past versions of the
cards. Do not send it to anyone else. For a link or a public page:

```
node <skill>/bin/cards.mjs export <board> --out <dir>
```

It writes `<dir>/index.html`: the board as it is now, with no replies, no
chat, no history and no local path. In a frame on another page, add
`?embed` to the address; for a sample that anyone may answer, add `?fresh`
(`reference/format.md`, "Options in the address"). A reader answers there and Send copies
their reply; they send the text to the human. Read the export before it
leaves: the cards themselves are yours to check.

## Files

```
.cards/<board>/board.org   you write this; the source of truth (an older board.md also works)
.cards/<board>/log.jsonl   append-only: card versions, replies, reads (never edit)
.cards/<board>/board.html  compiled, discardable
```
