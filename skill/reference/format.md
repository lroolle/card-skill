# board.org format

A board is a directory with one `board.org`. The file is plain Org: `*`
starts a section, `**` starts a card, and a property drawer under a card
holds its attributes. Every construct is Org's own syntax, so the file
opens as an outline in Emacs and renders on GitHub. Our parser reads the
subset below; it does not run Emacs. `cards check` validates everything
below and prints a corrected example for each error.

An older `board.md` (the markdown dialect) still renders; new boards are Org.

## File keywords

```
#+title: Pick a queue for the ingest service      required
#+todo: TODO DOING BLOCKED | DONE                 declares the card states to Emacs and GitHub
#+language: en                                    optional; zh-Hans, ja, ... sets the page language
#+author: Claude, for Eric                        optional; shown beside the revision
#+description: Three queues, one decision.        optional; the line a link preview shows
#+translation_of: pick-a-queue                    optional; this board is that board in another language
```

`#+todo:` changes nothing on the page: the four keywords are fixed. It is
there because Org knows only `TODO` and `DONE` by default; without the line,
Emacs and GitHub read `DOING` as the first word of the claim. `cards check`
asks for it when a card uses `DOING` or `BLOCKED`.

Org's own settings for Emacs (`#+startup:`, `#+options:`, `#+filetags:`,
`#+property:` and the like) pass without a word. Any other keyword before
the first heading gets a warning that it does nothing here.

`#+language:` names the language you write the board in, as a BCP 47 tag.
The page chrome (buttons, labels, help) follows it: `en` and `zh-Hans`
ship (`zh`, `zh-CN` and `zh-Hans-CN` use `zh-Hans`). Any other language
gets English chrome. Your text is never translated; write it in the
human's language. The reply that comes back to you stays English.

Text between the keywords and the first heading is the lede: one or two
sentences under the title.

`#+translation_of: <board>` names the board next to this one that it
translates. Keep the card ids and the option keys of the source. Both pages
then show a link to the other language, an answer names the same card and
key on either page, and `cards inbox <source>` also prints the replies sent
from a translation. `cards check` on a translation warns about a card that
the source does not have, a card of the source that is missing, an ask or
option keys that differ, and a card that the source changed later.

## Sections

```
* Options  :compare:
```

| Part | Meaning |
|---|---|
| no tag | grid: cards side by side, as many columns as fit |
| `:compare:` | equal columns; claims, gists and facts rows line up across cards |
| `:list:` | one column, for findings and steps read in order |
| `:CUSTOM_ID:` in a drawer | section id; default is the title as a slug, or `section-` and a short hash of the title when it has no Latin letters or digits. Used for reorder replies. |

Text between a section heading and its first card is the section note.
Cards before any section go into an untitled section.

## Cards

```
** DOING Backfill copies the old sessions [3/8]  :ops:
:PROPERTIES:
:CUSTOM_ID: backfill
:BASIS: inference
:NEEDS: dual-write
:END:
The gist: one paragraph, under 60 words.
```

| Part | Values | Meaning |
|---|---|---|
| heading text | one sentence | the claim |
| TODO keyword | `TODO` (or none), `DOING`, `BLOCKED`, `DONE` | the status; DONE cards recede |
| `[3/8]` or `[40%]` cookie | at the end of the heading | a thin progress meter |
| `:tag:` at the end | lowercase slug | free label; searchable |
| `:CUSTOM_ID:` | lowercase letters, digits, dashes; max 48 | required; stable across revisions |
| `:ASK:` | `choose`, `approve`, `answer`, `do` | what the card asks of the human; at most one |
| `:MULTI:` | `t` | with `choose`: any number of options |
| `:SUGGEST:` | `none` | with `choose`: only the human knows; you recommend no option |
| `:BASIS:` | `fact`, `inference`, `guess` | how you know the claim |
| `:FROM:` | ids, space-separated | this card exists because of those cards |
| `:NEEDS:` | ids, space-separated; on an ask also `id=value` or `id=*` | this card waits on those cards (see Asks for the forms with `=`) |

The drawer comes right after the heading, with no blank line between: that
is where Org reads it. A planning line that Emacs writes (`CLOSED:`,
`SCHEDULED:`, `DEADLINE:`) may stand between the two. Unknown properties
are errors, so a typo cannot silently do nothing; the properties Emacs
writes on its own (`:ID:`, `:VISIBILITY:`, `:ARCHIVE_TIME:`, ...) and a
`:LOGBOOK:` drawer are allowed and ignored. A third-level heading (`***`)
inside a card is a subheading in its depth.

## Card anatomy

The renderer reads the body by position. No extra fields are needed for the
three levels.

| Part | Source | Level |
|---|---|---|
| claim | the heading text | Claim, Gist, Full |
| gist | the first paragraph | Gist, Full |
| figure | the first `sketch` or `flow` block, or image | Gist, Full |
| facts | the first description list (`- key :: value`) | Gist, Full |
| options | the first checkbox list, on `:ASK: choose` | Gist, Full |
| depth | every other block | Full, or when the card is opened |

## Asks

```
** Pick NATS unless replay beyond 7 days matters
:PROPERTIES:
:CUSTOM_ID: pick
:ASK: choose
:FROM: nats kafka
:END:
NATS meets both needs at the lowest cost.

- [X] [[#nats]]
- [ ] [[#kafka]] if replay matters
- [ ] Wait for the load test
```

- `choose`: options are the first checkbox list. `[X]` marks your
  recommendation, shown as "Suggested". It is not selected until the human
  picks it. Single choice allows one `[X]`; add `:MULTI: t` for more. When
  only the human can know, mark none and add `:SUGGEST: none`; the reply
  then says `chosen`, not `confirmed` or `changed`.
- An option has a value, which is what the reply names:
  - `- [X] [[#nats]]` shows that card's numeral and claim; the value is the id.
  - `- [ ] small :: S/M, 140 to 180 mm` has the key `small`; the words after
    `::` are shown. The key stays when the words change or are translated.
  - `- [ ] Wait for the load test` has no key; the value is the sentence.
- `approve`: Approve and Reject buttons. The claim is the question.
- `answer`: a text box. The gist says what you need and why only the human
  knows it.
- `do`: an action only the human can take, away from the board (pass an
  identity check, pay, plug in a device). The claim says what to do. The
  buttons are Done and I cannot.

Every card, ask or not, also takes Keep, Drop, More and a free reply.

An ask that depends on another ask says so with `:NEEDS:`:

```
** Which size fits your wrist?
:PROPERTIES:
:CUSTOM_ID: pick-size
:ASK: choose
:SUGGEST: none
:NEEDS: pick-band
:END:
```

While `pick-band` has no answer, the page shows this ask with its controls
off ("Answer 1 first"). When the human answers `pick-band` as you
suggested, it opens. When they answer it another way, this ask was written
for a premise that no longer holds: the page holds it back, and the reply
says `held: #1 changed from your suggestion`. The human may press "Answer
anyway"; the answer then comes with `[answered after #1 changed]`. A held
ask is not an answer. Rewrite it for the new answer and ask again.

Two more forms say which answer the ask is written for:

- `:NEEDS: pick-band=link`: this ask applies only when `pick-band` is
  answered `link` (an option value; `approve` or `reject`; `done` or
  `cannot`). Write one ask for each answer that needs one. The page opens
  the one that fits and marks the others "Not needed"; the reply says
  `held: not needed`.
- `:NEEDS: pick-band=*`: this ask waits for `pick-band` and takes any
  answer. Use it for a gate at the end ("approve the order") that does not
  depend on which option won.

`DONE` on an ask card closes the ask. The card keeps its ask and options as
the record, and shows what the human answered. `cards settle <board>` sets
the keyword on every ask that has an answer on disk.

## Links

- `:FROM: a b`: lineage. On the desk, a grey line with an open arrow from
  each source. Focus lights the sources as "Source of N".
- `:NEEDS: a`: dependency. A red line with a filled arrow: "Needs" / "Blocks".
- An option `[[#id]]` on a choose card: a violet line ending in a diamond at
  the decision: "Option of N" / "Decides".
- `[[#id]]` in any text: a mention. It renders as the card's numeral and
  claim, and follows on click. `[[#id][words]]` shows your words instead of
  the claim. On the desk, a dashed line, shown only for the card in focus.
  Inside `=verbatim=` or `~code~` it is plain text.

When two cards link in more than one way, the most specific name wins.
A line always points toward the card that uses the other one. The desk lays
out one column per section, in board order, until the human moves a card.

## Blocks and widgets

````
- key :: value                  a description list. The first one is the facts;
                                in a :compare: section, use the same keys on
                                every card so the rows line up. "- :: value"
                                is a row with no key, under the row above.

#+begin_src tradeoffs           + and - lines: pros and cons
  + Smallest operating surface
  - Replay window is 7 days
#+end_src

#+begin_src diff                - and + lines
#+begin_src <language>          code
#+begin_example                 code with no language
#+begin_quote                   a quote
| a | b |                       a table; the first |---+---| rule ends the head
-----                           a rule
````

Indent the lines inside a block by two spaces, as Emacs does; the
indentation is removed. A line inside a block that starts with `*` or `#+`
takes a leading comma (`,*`), as in Org.

## Figures

A card shows the shape it talks about. When a claim is about a layout, a
view, a flow or a structure, draw it. `#+caption:` on the line above the
block names it.

```
#+caption: Rack view: card 6 in focus
#+begin_src sketch
  ┌─ 6 ──────────┐  ┌─ 7 ──────────┐
  │ in focus     │  │ Source of 6  │
  └──────────────┘  └──────────────┘
#+end_src

#+caption: The loop
#+begin_src flow
  *board.org* -> cards render: agent writes
  cards render -> board.html
  board.html -> you --> agent
#+end_src
```

- `sketch`: a drawing in text characters, shown exactly as written in a
  monospace face. Use box characters (`┌─┐│└┘├┤┬┴►`). 72 columns at most.
  CJK characters do not keep the columns; use Latin labels in a sketch.
- `flow`: one arrow per line. `a -> b` is an arrow, `a --> b` is dashed (a
  later, optional or weak step), `a -> b: label` labels the arrow, `a -> b
  -> c` is a chain (a label goes on the last hop), `*a*` (or `**a**`) is a
  bold box for the part under discussion (bold it once; every mention is the
  same box), a line with one name adds a box,
  and `direction: right` lays it out left to right (the default is down).
  The compiler places every box. 12 boxes at most.
- Figures are numbered per card in source order: Fig. 12.1 is the first
  figure on card 12.
- The first figure shows under the gist. Later figures are depth.
- A figure wider than about 330px makes its card two columns wide on the
  rack, and widens its column on the desk.
- In a `:compare:` section, draw every option or none.
- Figures belong in cards, not in the lede or a section note.

Neither block can carry colors, styles or markup. A sketch is escaped text;
a flow becomes SVG that the compiler writes.

## Files: images, excerpts, other files

A card can show a file from the project, so the human checks the thing
itself and does not leave the card. Paths are relative to `board.org`, as
in Org: from `.cards/<board>/`, the project root is `../../`.

```
#+caption: The desk at Fit, rev 7
[[file:../../shots/desk.png]]

#+caption: The parser's list rule
#+include: "../../skill/lib/org.mjs" src js :lines "120-150"

[[file:../../out/report.pdf]]
```

| You write | The card shows |
|---|---|
| `[[file:x.png]]` alone in a paragraph (png, jpg, gif, webp, avif, svg) | the image as a figure: numbered, captioned, at the card's width. A click opens it full size in the page; a second click shows its real pixels. |
| `#+include: "f" src lang :lines "a-b"` | an excerpt: the path, the range and line numbers. The first 12 lines show; the rest open in place. |
| `#+include: "f" example` (or no kind) | the same, with no language |
| `[[file:x.pdf]]` alone, any other file | a chip: type, name and size; a click opens the file from disk |
| `[[file:x.js::42][x.js:42]]` in a sentence | a link to the file |

- As in Org, `:lines "120-150"` is lines 120 to 149: the upper end is not
  included. `:lines "120-"` runs to the end of the file. The card shows the
  real range, so a wrong range is visible.
- The compiler reads each file at render and puts it into `board.html`.
  The page stays one file that works offline. The excerpt is a copy of the
  file at that render, not a live view.
- An image named `name@2x.png` shows at half its pixels, as on the web.
- A changed file is a new version of the card, as a changed sentence is.
  For an excerpt, only the lines it shows count.
- An image or a file chip needs no `#+begin_src` and takes no styles.
  Remote images (`[[https://...png]]`) stay links: the page fetches nothing.

These are errors, with a fix: a file that does not exist, an absolute
path, a file outside the project (the directory that holds `.cards`), a
file that may hold secrets (`.env`, keys, `.git/`), an excerpt of a binary
file, a range outside the file. These are warnings: an image over 1 MB,
files over 8 MB on one board, an excerpt over 120 lines, an image with no
caption.

## Inline markup

`*bold*`, `/italic/`, `_underline_`, `+strike+`, `=verbatim=`, `~code~`,
`[[https://example.com][text]]`, `[[file:docs/x.md][text]]`, bare
`https://` links, and card references `[[#id]]`. Org's emphasis rules
apply: a marker opens after a space or an opening bracket and closes before a
space or punctuation, so write paths and keys as `=docs/research/=` or
`~from=~`. Raw HTML is always shown as text. Links other than http, https,
mailto and relative paths render as text.

## Lint warnings

A warning does not stop a render. Each one is a writing rule:

- A claim over 110 characters, or under 3 words on a card with no ask.
- A body that does not start with a one-paragraph gist; a gist over 60 words.
- A choose card with no `[X]` recommendation and no `:SUGGEST: none`.
- An option whose `key ::` is not a slug.
- `DOING` or `BLOCKED` with no `#+todo:` line; a blank line before a
  `:PROPERTIES:` drawer.
- Syntax that does nothing here: a `#+keyword:` this build does not read; a
  block type with no look of its own; a `#+begin_src` language that names a
  drawing this build does not draw (`image`, `mermaid`, `chart`, ...).
- On a translation: the differences from its source (see File keywords).
- More than 7 cards in a section, more than 30 on a board, more than 5 open asks.
- A figure or an image with no caption; a sketch over 72 columns; a flow over 12 boxes;
  a flow line that points a box at itself; a figure in the lede or a note;
  a `:compare:` section where only some options have a figure.
- An image over 1 MB; files over 8 MB on one board; an excerpt over 120
  lines.
- English boards only (see `writing.md`): a sentence over 25 words, a
  paragraph over 6 sentences, a word from the word list.

## Files and history

| File | Written by | Notes |
|---|---|---|
| `board.org` | you | the only file you edit |
| `log.jsonl` | the CLI and the server | append-only; one JSON event per line |
| `board.html` | `cards render` | self-contained; safe to delete |

Each render compares the meaning of every card (its claim, attributes and
rendered body) with its last recorded version. A changed meaning gets a new
version; the card keeps its numeral, and its old versions show under
"Earlier versions". Re-wrapping a paragraph, or converting a board from
markdown to Org, is not a new version. A removed card is recorded as gone;
its numeral is never reused. The board's `rev` goes up by one per render
that changed anything.

Log events:

```
{"t":"card","id":"nats","n":3,"v":2,"rev":4,"at":"...","hash":"...","src":"** ...","fmt":"org"}
{"t":"card",...,"files":{"file:../../shots/desk.png":"9f2c..."}}   a card that shows files: their hashes
{"t":"gone","id":"sqs","rev":4,"at":"..."}
{"t":"rev","rev":4,"at":"...","hash":"..."}
{"t":"send","round":2,"rev":4,"at":"...","via":"board","items":[...]}
{"t":"send","round":3,...,"via":"paste","key":"3fa9c1d2","items":[...]}   recorded by cards ingest
{"t":"read","round":2,"at":"..."}
{"t":"say","at":"...","text":"Got it."}          the agent's chat message (cards say)
{"t":"build","v":"0.1.0","at":"..."}             the build that rendered the board last
```

Send items: `mark` (keep, drop, more), `choose` (value, default, state:
confirmed, changed or chosen), `approve` (approve, reject), `do` (done,
cannot), `answer`, `reply`, `order` (section, value), `note`. An ask item
with no answer has the state `untouched`, or `held` with `needs` (the asks
it waits for) and `why` (`open` or `changed`). An answer given after an ask
it needs changed carries `after`. Each card item carries the card version
`v` the human saw. A round with only a `note` was sent from the chat box;
the page shows the rounds, the `say` messages and each revision as one chat
thread.

## The reply as text

`cards inbox`, `cards wait` and the page's Send (when no server runs) print
the same text:

```
cards: reply from the board "Pick the band" (watch)
.cards/watch/board.org · rev 2 · 2026-10-09 04:00 · reply 3fa9c1d2

  #1 pick-band    choose   changed: link  (you suggested sport)
  #2 pick-size    choose   held: #1 changed from your suggestion; ...
  #4 verify       do       done
  #5 engraving    answer   "For \"E\"\nline two"
```

A line is the card, the kind, and the response. The human's words are JSON
strings: quotes and line breaks are escaped and nothing is cut. `reply
3fa9c1d2` is the key of a copied reply: `cards ingest` records the text as
a round once, however often it is pasted, and the page then knows its
copied answers arrived.

## A copy to publish

`cards export <board> --out <dir>` writes `<dir>/index.html` for a link or
a public page. The copy holds the board as it is now: no replies, no chat,
no past versions of cards, no path on your disk. A file shown as a chip is
copied to `<dir>/files/`. Boards that translate each other link as
`../<board>/index.html`: export each one into a folder with its own name,
side by side. The export records nothing in `log.jsonl`.

## The older markdown dialect

`board.md` boards still render: `---\ntitle:\n---` frontmatter, `#` sections
with `{compare}`, `##` cards with `{#id ask=choose basis=fact from=a,b
needs=c status=doing progress=3/7 .tag}`, ```` ```facts ```` blocks,
```` ```sketch Caption ```` and ```` ```flow Caption ```` fences, and
`[[id]]` references. Write new boards in Org.
