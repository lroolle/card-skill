# board.md format

A board is a directory with one `board.md`. The file is markdown with three
extra rules: H1 starts a section, H2 starts a card, and `{...}` at the end of
a heading holds its attributes. `cards check` validates everything below and
prints a corrected example for each error.

## Frontmatter

```
---
title: Pick a queue for the ingest service    required
lang: en                                      optional; zh-Hans, ja, ... sets the page language
---
```

Text between the frontmatter and the first heading is the lede: one or two
sentences under the title.

## Sections

```
# Options {compare}
```

| Attribute | Meaning |
|---|---|
| (none) | grid: cards side by side, as many columns as fit |
| `compare` | equal columns; claims, gists and `facts` rows line up across cards |
| `list` | one column, for findings and steps read in order |
| `#id` | section id; default is the title as a slug. Used for reorder replies. |

Text between a section heading and its first card is the section note.
Cards before any H1 go into an untitled section.

## Cards

```
## NATS covers the peak with one binary {#nats basis=inference from=need-peak .ops}
```

| Attribute | Values | Meaning |
|---|---|---|
| `#id` | lowercase letters, digits, dashes; max 48 | required; stable across revisions |
| `ask=` | `choose`, `approve`, `answer` | what the card asks of the human; at most one |
| `multi` | flag | with `ask=choose`: any number of options |
| `status=` | `open` (default), `doing`, `blocked`, `done` | done cards recede |
| `basis=` | `fact`, `inference`, `guess` | how you know the claim |
| `from=` | ids, comma-separated | this card exists because of those cards |
| `needs=` | ids, comma-separated | this card waits on those cards |
| `progress=` | `done/total`, e.g. `3/7` | a thin meter under the claim |
| `.tag` | lowercase slug | free label; searchable |

Unknown keys and flags are errors, so a typo cannot silently do nothing.

## Card anatomy

The renderer reads the body by position. No extra fields are needed for the
three altitudes.

| Part | Source | Altitude |
|---|---|---|
| claim | the heading text | Claim, Gist, Full |
| gist | the first paragraph | Gist, Full |
| figure | the first ```` ```sketch ```` or ```` ```flow ```` block | Gist, Full |
| facts | the first ```` ```facts ```` block | Gist, Full |
| options | the first task list, on `ask=choose` | Gist, Full |
| depth | every other block | Full, or when the card is opened |

## Asks

```
## Pick NATS unless replay beyond 7 days matters {#pick ask=choose from=nats,kafka}
NATS meets both needs at the lowest cost.

- [x] [[nats]]
- [ ] [[kafka]] if replay matters
- [ ] Wait for the load test
```

- `choose`: options are the first task list. `- [x]` marks your
  recommendation, shown as "Suggested". It is not selected until the human
  picks it. An option written as `[[id]]` shows that card's numeral and claim,
  and its value is the id. Single choice allows one `[x]`; add `multi` for more.
- `approve`: Approve and Reject buttons. The claim is the question.
- `answer`: a text box. The gist says what you need and why only the human knows it.

Every card, ask or not, also takes Keep, Drop, More and a free reply.

## Links

- `from=a,b`: lineage. Focus on this card lights a and b as "Source", and lights
  this card on theirs as "Follows from this".
- `needs=a`: dependency. "Needed first" / "Waits on this".
- `[[id]]` in any text: a mention. It renders as the card's numeral and claim,
  and follows on click. Inside backticks it is plain text.
- An option `[[id]]` on a choose card: "Option" / "Decides this".

When two cards link in more than one way, the most specific name wins.

On the desk view, `from=`, `needs=` and option refs draw a line between the
two cards. A line means "feeds into" and points from the source, the needed
card, or the option toward the card that uses it. A mention draws a dashed
line only while one of its two cards is in focus. The layout is a rule: one
column for each section, in board order. You do not place cards.

## Widgets

Fenced blocks with these info strings render as widgets. `sketch` and `flow` are figures (next section). Any other fence is code.

````
```facts
peak: 120k msg/s on 3 nodes
cost: about $40 a month
```

```tradeoffs
+ Smallest operating surface
- Replay window is 7 days
```

```diff
- old line
+ new line
```
````

## Figures

A card shows the shape it talks about. When a claim is about a layout, a
view, a flow or a structure, draw it. The text after the fence name is the
caption.

````
```sketch Rack view: card 6 in focus
┌─ 6 ──────────┐  ┌─ 7 ──────────┐
│ in focus     │  │ Source of 6  │
└──────────────┘  └──────────────┘
```

```flow The loop
**board.md** -> cards render: agent writes
cards render -> board.html
board.html -> you --> agent
```
````

- `sketch`: a drawing in text characters, shown exactly as written in a
  monospace face. Use box characters (`┌─┐│└┘├┤┬┴►`). 72 columns at most.
  CJK characters do not keep the columns; use Latin labels in a sketch.
- `flow`: one arrow per line. `a -> b` is an arrow, `a --> b` is dashed (a
  later, optional or weak step), `a -> b: label` labels the arrow, `a -> b
  -> c` is a chain (a label goes on the last hop), `**a**` is a bold box for
  the part under discussion, a line with one name adds a box, and
  `direction: right` lays it out left to right (the default is down). The
  compiler places every box. 12 boxes at most.
- Figures are numbered per card in source order: Fig. 12.1 is the first
  figure on card 12.
- The first figure shows under the gist. Later figures are depth.
- A figure wider than about 330px makes its card two columns wide on the
  rack, and widens its column on the desk.
- In a `{compare}` section, draw every option or none.
- Figures belong in cards, not in the lede or a section note.

Neither block can carry colors, styles or markup. A sketch is escaped text;
a flow becomes SVG that the compiler writes.

## Markdown subset

Paragraphs, `###` subheadings inside a card, lists (nested by indent), task
lists, block quotes, fenced code, GFM tables, `---`, `**bold**`, `*em*`,
`~~strike~~`, `` `code` ``, `[text](url)`, and bare `https://` links. Raw HTML
is always shown as text. Links other than http, https, mailto and relative
paths render as text.

## Lint warnings

A warning does not stop a render. Each one is a writing rule:

- A claim over 110 characters, or under 3 words on a card with no ask.
- A body that does not start with a one-paragraph gist; a gist over 60 words.
- A choose card with no `[x]` recommendation.
- A figure with no caption; a sketch over 72 columns; a flow over 12 boxes;
  a flow line that points a box at itself; a figure in the lede or a note;
  a `{compare}` section where only some options have a figure.
- English boards only (see `writing.md`): a sentence over 25 words, a
  paragraph over 6 sentences, a word from the word list.
- An ask on a `done` card.
- More than 7 cards in a section, more than 30 on a board, more than 5 open asks.

## Files and history

| File | Written by | Notes |
|---|---|---|
| `board.md` | you | the only file you edit |
| `log.jsonl` | the CLI and the server | append-only; one JSON event per line |
| `board.html` | `cards render` | self-contained; safe to delete |

Each render compares every card's source with its last recorded version. A
changed card gets a new version, keeps its numeral, and its old versions show
under "Earlier versions". A removed card is recorded as gone; its numeral is
never reused. The board's `rev` goes up by one per render that changed anything.

Log events:

```
{"t":"card","id":"nats","n":3,"v":2,"rev":4,"at":"...","hash":"...","src":"## ..."}
{"t":"gone","id":"sqs","rev":4,"at":"..."}
{"t":"rev","rev":4,"at":"...","hash":"..."}
{"t":"send","round":2,"rev":4,"at":"...","via":"board","items":[...]}
{"t":"read","round":2,"at":"..."}
```

Send items: `mark` (keep, drop, more), `choose` (value, default, state:
confirmed, changed or untouched), `approve` (approve, reject or untouched),
`answer`, `reply`, `order` (section, value), `note`. Each card item carries
the card version `v` the human saw.
