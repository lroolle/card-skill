# board.org format

A board is a directory with one `board.org`. The file is plain Org: `*`
starts a section, `**` starts a card, and a property drawer under a card
holds its attributes. Nothing is invented on top of Org; the board reads
correctly in Emacs, on GitHub and in any text editor. `cards check`
validates everything below and prints a corrected example for each error.

An older `board.md` (the markdown dialect) still renders; new boards are Org.

## File keywords

```
#+title: Pick a queue for the ingest service      required
#+language: en                                    optional; zh-Hans, ja, ... sets the page language
```

Text between the keywords and the first heading is the lede: one or two
sentences under the title.

## Sections

```
* Options  :compare:
```

| Part | Meaning |
|---|---|
| no tag | grid: cards side by side, as many columns as fit |
| `:compare:` | equal columns; claims, gists and facts rows line up across cards |
| `:list:` | one column, for findings and steps read in order |
| `:CUSTOM_ID:` in a drawer | section id; default is the title as a slug. Used for reorder replies. |

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
| `:ASK:` | `choose`, `approve`, `answer` | what the card asks of the human; at most one |
| `:MULTI:` | `t` | with `choose`: any number of options |
| `:BASIS:` | `fact`, `inference`, `guess` | how you know the claim |
| `:FROM:` | ids, space-separated | this card exists because of those cards |
| `:NEEDS:` | ids, space-separated | this card waits on those cards |

The drawer comes right after the heading. Unknown properties are errors, so
a typo cannot silently do nothing. `:ID:` (an Emacs org-id) is allowed and
ignored. A third-level heading (`***`) inside a card is a subheading in its
depth.

## Card anatomy

The renderer reads the body by position. No extra fields are needed for the
three levels.

| Part | Source | Level |
|---|---|---|
| claim | the heading text | Claim, Gist, Full |
| gist | the first paragraph | Gist, Full |
| figure | the first `sketch` or `flow` block | Gist, Full |
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
  picks it. An option that starts with `[[#id]]` shows that card's numeral
  and claim, and its value is the id. Single choice allows one `[X]`; add
  `:MULTI: t` for more.
- `approve`: Approve and Reject buttons. The claim is the question.
- `answer`: a text box. The gist says what you need and why only the human
  knows it.

Every card, ask or not, also takes Keep, Drop, More and a free reply.

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
- A choose card with no `[X]` recommendation.
- An ask on a `DONE` card.
- More than 7 cards in a section, more than 30 on a board, more than 5 open asks.
- A figure with no caption; a sketch over 72 columns; a flow over 12 boxes;
  a flow line that points a box at itself; a figure in the lede or a note;
  a `:compare:` section where only some options have a figure.
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
{"t":"gone","id":"sqs","rev":4,"at":"..."}
{"t":"rev","rev":4,"at":"...","hash":"..."}
{"t":"send","round":2,"rev":4,"at":"...","via":"board","items":[...]}
{"t":"read","round":2,"at":"..."}
```

Send items: `mark` (keep, drop, more), `choose` (value, default, state:
confirmed, changed or untouched), `approve` (approve, reject or untouched),
`answer`, `reply`, `order` (section, value), `note`. Each card item carries
the card version `v` the human saw.

## The older markdown dialect

`board.md` boards still render: `---\ntitle:\n---` frontmatter, `#` sections
with `{compare}`, `##` cards with `{#id ask=choose basis=fact from=a,b
needs=c status=doing progress=3/7 .tag}`, ```` ```facts ```` blocks,
```` ```sketch Caption ```` and ```` ```flow Caption ```` fences, and
`[[id]]` references. Write new boards in Org.
