---
name: card-skill
description: Answer with an interactive card board when the human must judge several separate things, make a decision only they can make, or follow work across turns. You write board.org (Org mode; one claim per card, at most one ask); `cards` compiles a self-contained HTML board with a desk view that draws the links; the human marks, chooses, approves, answers and sends; replies come back to you as files. Use for a comparison that ends in a decision, review findings with an approval gate, a plan with dependencies, status of long work, or a brief the human will mark up; when the report is a picture (a system, a flow of calls, a data model, numbers over time), the board draws it from text as a sheet and pins each finding on the part it is about. Not for one answer, one explanation, or chat.
license: MIT
metadata:
  version: "0.5.0"
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

This is cards 0.5.0. `cards render` ends with the version of the build
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

Before you ask, decide what you can. Ask only what only the human knows,
and only when it is real and essential (section 3). Five open asks is the
ceiling; `cards check` warns past it.

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
| review | findings need a go/no-go | a sheet of what was reviewed, a `:list:` of findings pinned on its parts, worst first, one `:ASK: approve` |
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
The stakes, in one paragraph: what each answer changes, and what a wrong
one costs.

- [X] [[#nats]]
- [ ] [[#kafka]]
```

Writing rules. `cards check` enforces the mechanical ones.

- The heading is the claim, not the topic. "NATS covers the peak", not "NATS".
- Every card needs a `:CUSTOM_ID:`. Give a short one by hand to a card that
  other cards point at. For the rest you may leave the drawer out and run
  `node <skill>/bin/cards.mjs ids <board>`: it writes an id made from the
  claim into `board.org`, once. Never change an id afterwards.
- The first paragraph is the gist. Everything else is depth.
- Write near ASD-STE100 (`reference/writing.md`): one fact per sentence,
  25 words at most, active verbs in the present tense, the same word for the
  same thing, and plain words ("use", not "utilize" or "leverage").
- Show, then tell. When a claim is about a shape (a layout, a view, a flow,
  a structure, an order of calls, a set of numbers), draw it under the gist.
  When the drawing is what several cards talk about, make it a sheet. See
  "Draw it", at the end of this section.
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
- A table takes a head row, and its first column names the row. In a narrow
  card the page shows each row as a block, with every field under the name
  of its column.
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

### Draw it

A drawing is text in a block, under `#+caption:`. Pick the kind by what the
claim is about:

| The claim is about | Block | You write |
|---|---|---|
| a layout, a screen | `sketch` | text characters, as the screen looks |
| what feeds what: a system, a pipeline, a loop | `flow` | `a -> b: label`; `group Cloud: a, b` frames boxes that belong together; `store: a` is a box that holds data |
| who calls whom, in time order | `sequence` | `a -> b: call`, `b --> a: reply` |
| classes, records, types: what owns, holds, extends or refers to what | `class` | Mermaid's `classDiagram` lines: `class Order { +id: str }`, `Base <\|-- Order`, `Order *-- Line`, `Order --> Customer : label`, `"1" o-- "0..*"` |
| numbers: a comparison, a change over time | `chart` | an Org table; names in the first column give bars, numbers or dates give a line |

The compiler places, routes and scales everything. A decision about a view
or a UI shows each option as a figure; numbers that decide something go in
a chart, not only in prose. Do not draw a single fact.

A figure in a card shares a narrow column with the card's words: 12 boxes,
502 px. When the drawing is the point of a section (the system a review
covers, the numbers a decision rests on, the flow a plan changes), make it
a sheet: tag the card `:sheet:`. A sheet is one drawing on the board, at the
width it needs (24 boxes, 20 classes, 1120 px). Its claim says what the drawing shows,
its first paragraph what to look at; the drawing needs no caption. It leads
its section: on the desk it lies beside the section's cards.

```org
** Every upload passes one queue before it is stored  :sheet:
:PROPERTIES:
:CUSTOM_ID: system
:BASIS: fact
:END:
Read from the deploy files on 2026-10-15.

#+begin_src flow
  group Cloud: api, queue, resizer
  app -> api: HTTPS
  api -> queue: job
  queue -> resizer
#+end_src
```

Pin each card that is about a part of the drawing on that part:
`:ON: system/queue` (the sheet's id, a slash, the part's name in lower
case, with a dash for each space: `web app` is `web-app`). A part is a box or a group of a flow, a class or a namespace of a class diagram, a part of a sequence, a
row of a bar chart, a line or a point on x of a line chart. The part then
shows the card's numeral, and focus on either one lights the other. So a
review pins each finding on the box it is about, and an incident pins each
cause on the day in the chart. Pin what a card is about, not every box it
names.

Work on a drawing as on code that must pass a check:

1. Write the whole drawing at once, with no coordinates. One main path;
   side branches leave the box nearest to them. Cut a line before you add
   a group.
2. `cards check <board>`. Each drawing warning names the part (a label, an
   arrow, a frame) and the change that fixes it.
3. Make that one change and check again. Fix the drawing's own faults
   first (a line through a box, a frame around a stranger), then labels.
   Shorten a label before you drop it; drop it only when the two boxes
   already say it.
4. Stop when the drawing is clean. If two rounds in a row do not lower the
   number of warnings, stop and say in the card's depth what is left.
5. Look at it: `cards shot <board>`. A check sees geometry, not sense.

## 3. Ask only what is real and essential

An ask stops your work and takes the human's attention. Write one only when
all four hold:

1. **Only they can supply it.** It is their preference, their authority,
   their money or risk, a fact outside your reach, or a step only they can
   take (a login, a payment). If you can read, run or measure it, do that.
2. **The answer changes what you do.** Each answer leads to other work. If
   every answer leads to the same next step, it is not a decision.
3. **A wrong answer costs something.** It touches money, data, security, a
   public surface (a release, a push, an API, a message that others read),
   the architecture, or work that someone else owns. A cheap choice that
   you can undo is yours.
4. **It is due.** You did the homework: the options are checked, and you
   have a pick. The work waits on the answer now. A question for later is a
   step in a plan, not an ask.

Triage every round, before you write an ask:

1. List the open questions.
2. Find out what you can. Each answer is a fact card.
3. Decide each question that fails test 2 or 3. Put the decision on the
   board as a card in a section such as "Decided; say if not": the claim
   says what you chose, the gist says why and how to undo it. It is not an
   ask, so nothing waits on it; the human can Drop it or Reply.
4. What is left is an ask. Usually one to three.

The ask card:

- The claim states the decision and your pick: "Pick NATS unless replay
  beyond 7 days matters", not "Which queue?". An `answer` ask may be a
  question when you cannot pick.
- The first paragraph is the stakes: what each answer changes, and what a
  wrong one costs.
- Each option says where it leads: `- [ ] kafka :: Kafka: a cluster to run,
  months of replay`.
- The cards that wait on the answer say so with `:NEEDS:`. Say in the depth
  what you do while no answer comes.

Not an ask, and what to do instead:

| You are about to ask | Do this |
|---|---|
| "Shall I proceed?", "Is this OK?", "Any thoughts?" | If you can undo the step, take it and report it on a card. If you cannot, name that step and what is at stake, and ask `approve` on it. |
| approval of work you already did and can undo | report it on a card; the human can Drop it |
| a fact you can check (a version, a file, a setting) | check it |
| two decisions in one card | two asks, or decide one of them |
| a menu with no pick, when you have a view | mark your pick with `[X]` |
| taste on a detail inside the work (a name in the code, a log format) | decide |
| what the human already decided | quote their words, and act |

`cards check` warns on an ask that asks for permission or feedback with
nothing named, on a choice whose claim is a question although you suggest
an option, on a choice with one option, and on an ask with no stakes in its
first paragraph.

## 4. Render and hand over

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

## 5. Get the reply

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

In Claude Code a hook can do that for you: with it, unread replies arrive
with the human's next message. `node <skill>/bin/cards.mjs hook` prints the
lines for `.claude/settings.json`. Show them to the human and let them
decide; do not change their settings yourself.

## 6. Act on the reply, then revise

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
| order | the human's priority for a section | apply it: `cards move <board> <the ids in that order> --to <section>`; the reply names the section after `§` (`--to §` on a board with no sections) |
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

Two more revisions have a command, so you do not match text in `board.org`
by hand. `set` writes the TODO keyword. `move` puts cards, in the order you
name them, at the end of a section or next to another card; a move is not
a revision, so no card says "Changed".

```
node <skill>/bin/cards.mjs set <board> <id ...> --status doing|blocked|done|todo|none
node <skill>/bin/cards.mjs move <board> <id ...> --to <section> | --before <id> | --after <id>
```

Then render again. The human sees "Changed" on every card you touched.

## 7. Answer in the chat

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

## 8. Resume

`node <skill>/bin/cards.mjs ls` lists boards; `.cards/index.html` is the
same list as a page, with the open asks of each board, and every board
links to it. `show <board>` prints the outline;
`show <board> <id|n>` prints one card with the human's past responses. The
human may name a card by its numeral ("12 is wrong"): `show <board> 12`.

## 9. Share a board

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
