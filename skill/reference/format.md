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
#+category: Ingest                                optional; the group this board lies in on the map
#+from: plan                                      optional; the boards this one continues, or was split from
#+needs: security-review                          optional; the boards whose answers this one waits on
```

`#+todo:` changes nothing on the page: the four keywords are fixed. It is
there because Org knows only `TODO` and `DONE` by default; without the line,
Emacs and GitHub read `DOING` as the first word of the claim. `cards check`
asks for it when a card uses `DOING` or `BLOCKED`.

On GitHub, `board.org` renders as a document: drawers are hidden, facts
are definition lists, figures are code blocks, options show as `[X]` and
`[ ]`. GitHub hides the card states unless the board says
`#+options: todo:t`; add that line when the source will be read there.

Org's own settings for Emacs (`#+startup:`, `#+options:`, `#+filetags:`,
`#+property:` and the like) pass without a word. `#+category:` is Org's own
too: Emacs groups a file's entries under it in the agenda, as the map
groups the boards. Any other keyword before
the first heading gets a warning that it does nothing here.

`#+language:` names the language you write the board in, as a BCP 47 tag.
The page chrome (buttons, labels, help) follows it: `en` and `zh-Hans`
ship (`zh`, `zh-CN` and `zh-Hans-CN` use `zh-Hans`). Any other language
gets English chrome. Your text is never translated; write it in the
human's language. The reply that comes back to you stays English.

Text between the keywords and the first heading is the lede: one or two
sentences under the title.

`#+category:`, `#+from:` and `#+needs:` place the board on the map of the
project (see "The map of a project's boards"). `#+from:` and `#+needs:`
take the names of other boards in the same directory, separated by spaces
or commas.

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
| `:tag:` at the end | lowercase slug | free label; searchable. `:sheet:` is not a label: it makes the card a sheet (see Sheets) |
| `:CUSTOM_ID:` | lowercase letters, digits, dashes; max 48 | required; stable across revisions |
| `:ASK:` | `choose`, `approve`, `answer`, `do` | what the card asks of the human; at most one |
| `:MULTI:` | `t` | with `choose`: any number of options |
| `:SUGGEST:` | `none` | with `choose`: only the human knows; you recommend no option |
| `:BASIS:` | `fact`, `inference`, `guess` | how you know the claim |
| `:FROM:` | ids, space-separated | this card exists because of those cards |
| `:NEEDS:` | ids, space-separated; on an ask also `id=value` or `id=*` | this card waits on those cards (see Asks for the forms with `=`) |
| `:ON:` | `sheet/part`, space-separated | this card is about that part of a sheet's drawing (see Sheets) |

You may write a card as a heading and its text, with no drawer.
`cards ids <board>` then gives every such card a `:CUSTOM_ID:` made from its
claim and writes the drawer into `board.org`. It does this once: when you
change the claim later, the id stays, and so do the card's history and the
human's answers. Name cards in `:NEEDS:`, `:FROM:` and `[[#id]]` by the ids
it prints. A card that other cards point at is better given a short id by
hand.

The drawer comes right after the heading, with no blank line between: that
is where Org reads it. A planning line that Emacs writes (`CLOSED:`,
`SCHEDULED:`, `DEADLINE:`, each with its timestamp) may stand between the
two. A line with one of these words and no timestamp is a planning line
only when the drawer stands directly under it (`cards check` then warns
that it is not shown); anywhere else it is text of the card. A drawer that
stands lower, under a second planning line or a `:LOGBOOK:`, is text to
Org and to `cards`, and the card then has no id. Unknown properties
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
| figure | the first `sketch`, `flow`, `sequence`, `class` or `chart` block, or image; on a sheet it comes before the gist and shows at every level | Gist, Full |
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
- `:ON: sheet/part`: a pin. No line: the part of the sheet's drawing shows
  the card's numeral. Focus lights the sheet as "N points here" and the
  pinned cards as "On N" (see Pins).
- `[[file:../plan/board.org::#step-3]]` in any text: a link to a card on
  another board of the project, in Org's own form (Emacs and GitHub follow
  it too). It renders as that board's name and the card's numeral, then the
  card's claim, or your words with `[[...][words]]`; a click opens the card
  on its board. `[[file:../plan/board.org][the plan]]` links the board, and
  reads as your words. A
  board or card that does not exist shows as text, and `cards check` names
  it. A published copy (`cards export`) shows the board's name, the card's
  numeral and your words, with no link and no claim of the other board:
  that board may not be published.

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
| a | b |                       a table; the first |---+---| rule ends the head.
                                A column of numbers is set to the right; a row
                                | <l> | <c> | <r> | says otherwise and is not shown.
                                #+caption: above a table is its caption
: fixed-width text              code, as in an example block (also what follows #+RESULTS:)
#+begin_verse ... #+end_verse   lines and indentation kept
#+begin_center ... #+end_center set in the middle
10. [@10] item                  an item that sets its number
- [-] task                      a task with some of its parts done
x^{2}  a_{ij}                   above and below the line; braces are required,
                                so snake_case_name stays as it is
\\ at the end of a line         a line break
<2026-10-09 Fri>                a date (also [2026-10-09 Fri 10:00]); shown without brackets
<https://example.org>           a link
-----                           a rule
````

Indent the lines inside a block by two spaces, as Emacs does; the
indentation is removed. A line inside a block that starts with `*` or `#+`
takes a leading comma (`,*`), as in Org.

A table is shown as a table where it fits its card; its words are never
broken to make a column narrow. In a card that is too narrow, each row
becomes a block: the first field is its name, and the other fields stand
under the names of their columns. So give a table a head row, and put what
names the row in the first column. On the desk the human can also set the
width of a card.

Shown as written, because a board is not typeset: entities (`\alpha`),
`--` and `---` (command flags look the same), footnotes (`[fn:1]`), LaTeX
and macros.

## Figures

A card shows the shape it talks about. When a claim is about a layout, a
view, a flow, a structure, an order of calls or a set of numbers, draw it.
`#+caption:` on the line above the block names it. Five kinds:

| Kind | Draw it when the claim is about | You write | The compiler |
|---|---|---|---|
| `sketch` | a layout, a screen, anything spatial | text characters | shows them as written |
| `flow` | what feeds what: a pipeline, an architecture, a loop | arrows, groups, stores | places every box and routes every arrow |
| `sequence` | who calls whom, in time order | one message per line | places the columns and rows |
| `class` | classes, records or types, and how they relate | Mermaid's `classDiagram` lines | places every class and routes every line |
| `chart` | numbers: a comparison, or a change over time | an Org table | picks bars or a line, the scale and the marks |

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
  store: board.org
#+end_src

#+caption: A web service in two zones
#+begin_src flow
  group Browser: web app
  group Cloud: api, worker, orders
  store: orders
  web app -> api: HTTPS
  api -> orders: write
  api -> worker: enqueue
  worker -> orders: update
#+end_src

#+caption: Placing an order
#+begin_src sequence
  client -> api: POST /order
  api -> api: check stock
  api -> db: insert
  db --> api: id 42
  api --> client: 201 Created
#+end_src

#+caption: An order owns its lines and refers to its customer
#+begin_src class
  class Order {
    +id: str
    +total() int
  }
  <<interface>> Store
  Order "1" *-- "1..*" Line
  Order --> Customer : placed by
  Store <|.. PgStore
#+end_src

#+caption: p95 latency by queue, in ms
#+begin_src chart
  | queue | p95 ms |
  |-------+--------|
  | NATS  |      4 |
  | Kafka |     11 |
  | SQS   |     38 |
#+end_src
```

- `sketch`: a drawing in text characters, shown exactly as written in a
  monospace face. Use box characters (`┌─┐│└┘├┤┬┴►`). 72 columns at most.
  CJK characters do not keep the columns; use Latin labels in a sketch.
- `flow`: one statement per line.
  - `a -> b` is an arrow, `a --> b` is dashed (a later, optional or weak
    step), `a -> b: label` labels the arrow, `a -> b -> c` is a chain (a
    label goes on the last hop).
  - `*a*` (or `**a**`) is a bold box for the part under discussion; bold it
    once, and every mention is the same box. A line with one name adds a box.
  - `group Cloud: api, worker` draws one frame, named Cloud, around those
    boxes, and keeps them next to each other. A box is in one group at most;
    4 groups at most.
  - `store: orders, log.jsonl` draws those boxes as cylinders: they hold
    data.
  - `direction: right` lays it out left to right (the default is down).
    Down fits a card better; use right for a short chain.

  The compiler places every box and routes every arrow at right angles, each
  on a track of its own; an arrow back up the flow goes around the side. 12
  boxes at most.
- `sequence`: one message per line, in time order from the top. `a -> b:
  what` is a call, `a --> b: what` is dashed (a reply, or a message that does
  not wait), `a -> a: what` is a call to itself, `*a*` is bold. The columns
  follow the order in which the names first appear; a line with one name
  fixes that order. 6 parts and 16 messages at most.
- `class`: the lines of Mermaid's `classDiagram`, a subset. Mermaid itself
  never runs: the compiler reads the lines and draws them like a flow.
  `classDiagram` may come first.
  - `class Order { ... }` declares a class with its members, one a line, then
    `}`. A member with a name and parentheses (`+total() int`) is a method;
    the rest are fields. `$` at the end of a member: static (underlined);
    `*` at the end: abstract (italic); either may also stand right after
    the parentheses (`+make()$ Order`). `class Order { +id: str }` on one
    line holds one member. `Order : +paid bool` adds a member
    outside the braces. `class Order` or a relation declares a class with no
    members. `class Order["Order v2"]` shows another name than the id;
    `Shape~T~` shows as `Shape<T>`, `List~List~int~~` as
    `List<List<int>>`. A class name is letters, digits, `_`, `.` and `-`.
  - `<<interface>> Store`, or `<<interface>>` inside the braces, puts an
    annotation over the name.
  - A relation is a line between two classes, with spaces around it:
    `A <|-- B` (B is a kind of A; also `B --|> A`), `A <|.. B` (B realizes
    A), `A *-- B` (A owns B), `A o-- B` (A holds B), `A --> B` (A refers to
    B), `A ..> B` (A uses or creates B), `A -- B` and `A .. B` (a link).
    `A "1" *-- "1..*" B` says how many at each end; `A --> B : label` labels
    the line. A relation written twice is one line; two relations between
    the same classes that say different things are two lines.
  - The parent and the whole stand above; an arrow runs down. `direction LR`
    lays it out left to right (`TB` is down, the default); a class with many
    parts reads better left to right, where its parts stand in a column.
    `BT` and `RL` are drawn as `TB` and `LR`, and `cards check` says so.
  - `namespace Billing { ... }` draws one frame, named Billing, around the
    classes declared inside it with `class`. A class that a relation inside
    it names stays where it is declared. A class is in one namespace at most.
  - Not drawn, and `cards check` says so: `note`, `style`, `classDef`,
    `cssClass`, `:::`, `click`, `link`, `callback`, front matter between
    `---` lines, `accTitle` and `accDescr`. Say a note in the card; the
    compiler owns the look. A line it cannot read, such as a relation with
    no spaces around it (`A<|--B`), is said too; it never becomes a class.

  6 classes at most. A class box is as wide as its longest member, and wider
  where several lines with a count leave it, so each count has a place.
- `chart`: an Org table. The first row names the columns, and a rule
  (`|---+---|`) goes under it. The first column names each row; every other
  column is a series of numbers, named by its head. Put the unit in the head
  (`p95 ms`), not in the cells; `1,200` and `12%` are numbers, an empty cell
  or `-` is no value. Names in the first column give horizontal bars, with
  each value printed; numbers or dates (`2026-10`, `2026-10-15`) give a line
  over x, each line named at its end. `type: bar` or `type: line` on a line
  of its own says otherwise. 4 series, 16 bars or 60 points at most.
- Figures are numbered per card in source order: Fig. 12.1 is the first
  figure on card 12.
- The first figure shows under the gist. Later figures are depth.
- A figure wider than its column makes its card two columns wide on the
  rack, and widens its column on the desk up to 560px. A wider drawing is a
  sheet.
- In a `:compare:` section, draw every option or none. A sheet in the
  section is not an option.
- Figures belong in cards, not in the lede or a section note. A drawing
  that stands on its own is a sheet.

None of these blocks can carry colors, styles or markup. A sketch is escaped
text; a flow, a sequence, a class diagram and a chart become SVG that the compiler writes, in
the card's one ink: series differ by tone and mark, never by color.

`cards check` reads each drawing as a reader would and says what is wrong in
it, by name, with the change that fixes it: a label or a count on a line or over a box
(a line within 1px of a label is on it), two labels on each other, a line
through a box, two arrows on one run, a frame that takes in a box that is not
in its group, a box name cut after three lines, and a drawing wider than the
502px a card on the desk shows (on a sheet: 1120px).

### Sheets

A sheet is a card that is one drawing: tag it `:sheet:`. Use it when the
drawing is what a section is about, and other cards talk about its parts:
the system a review covers, the numbers a decision rests on.

```
** Every upload passes one queue before it is stored  :sheet:
:PROPERTIES:
:CUSTOM_ID: system
:BASIS: fact
:END:
Read from the deploy files on 2026-10-15.

#+begin_src flow
  group Cloud: api, queue, resizer
  store: photos
  app -> api: HTTPS
  api -> queue: job
  api -> photos
  queue -> resizer
#+end_src
```

- The claim says what the drawing shows; the first paragraph says what to
  look at. The first figure is the drawing: it needs no `#+caption:`, and
  its number is the card's own (Fig. 1). Later figures are depth, as on a
  card.
- A sheet is as wide as its drawing. It has the room of a sheet: 24 boxes
  and 8 groups in a flow, 20 classes and 8 namespaces in a class diagram,
  10 parts and 32 messages in a sequence, 30 bars
  or 200 points in a chart, 160 columns in a sketch; up to 1120 px shows at
  full size. A chart on a sheet is drawn larger.
- It leads its section. On the rack the sheets stand side by side above
  the section's cards; on the desk each sheet is a column, and the
  section's cards lie in the lane beside them. A sheet shows its drawing at
  every level, Claim too. On a narrow screen the drawing scales down to
  three fifths and then scrolls inside the sheet.
- It is a card in every other way: it takes marks, a reply, an ask (approve
  the drawing), `:FROM:` and `:NEEDS:`, and it has versions.

### Pins

`:ON: system/queue` pins a card on a part of a sheet: the sheet's id, a
slash, and the part's name. A name is folded: lower case, and every run of
spaces and marks is one dash; letters, digits, `+`, `#`, `.` and the minus
of a number stay. `Web app` is `web-app`, `C++` is `c++`, `board.org` is
`board.org`, `POST /charges` is `post-charges`, `-1` is `-1`.
A card may be pinned on several parts: `:ON: system/queue latency/2026-10-12`.

| Drawing | A part is |
|---|---|
| `flow` | a box, or a group (its name) |
| `class` | a class (the name it shows), or a namespace |
| `sequence` | a part (a column) |
| `chart`, bars | a row (the name in the first column) |
| `chart`, line | a line (the head of its column), or a point on x (`2026-10-12`) |

The part shows the numeral of each card pinned on it, as a part of a patent
drawing shows its reference numeral: in a box after its name, on a group
after its name, after a bar's value, after a line's name, and above a point
on x with a rule across the chart. A click on a numeral goes to its card.
Focus on the card lights its part and its numeral; focus on the sheet
lights its cards. A pin draws no line on the desk: the numeral is the link.

A pin is part of the pinned card's meaning, not the sheet's: pinning a card
makes a new version of that card only. These are errors, with a fix: a pin
on a card that is not a sheet, on a sheet whose drawing has no parts (a
sketch, an image), on a part the drawing does not have (the fix lists the
parts), on a name two parts share once folded (`Web app` and `web-app`, or
a box and a group both named `api`: rename one), and on the card itself.

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
  drawing this build does not draw (`image`, `mermaid`, `plot`, ...). A
  `mermaid` block whose first line is `classDiagram` is told to be a `class`
  block: the same lines draw there.
- On a translation: the differences from its source (see File keywords).
- Between boards: a `#+from:` or `#+needs:` that names no board here, or a
  word that cannot be a board's name; a link to a board or to a card that
  does not exist; another board named as `=code=` instead of linked (only a
  name with a dash or a digit, such as `=release-2=`: `=plan=` may be code);
  an Org board with no `#+category:` where the other boards of the project
  name theirs.
- More than 7 cards in a section, more than 30 on a board, more than 5 open asks.
- An ask that is not a real decision (SKILL.md, section 3): it asks for
  permission or feedback with nothing named ("Shall I proceed?"); it is a
  choice whose claim is a question although you suggest an option; it is a
  choice with one option; its first paragraph does not give the stakes.
- A figure or an image with no caption (a sheet's drawing needs none); a sketch over 72
  columns; a flow over 12 boxes or 4 groups; a flow line that points a box at itself; a
  box in two groups; a class diagram over 6 classes or 4 namespaces, a class line it does not read, a
  Mermaid style or note in it; a sequence over 6 parts or 16 messages; a chart cell that is not a
  number; a figure in the lede or a note; a `:compare:` section where only some options
  have a figure. On a sheet the limits are the sheet's (see Sheets).
- A sheet with no drawing.
- A drawing a reader would misread (see Figures): each fault by name, with its fix.
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
| `../index.html` | `cards render` | the map of the project's boards, in `.cards/`; safe to delete |

## The map of a project's boards

Each render also writes `.cards/index.html`: the map of every board of the
project. A board page links to it ("All boards"); `cards serve` shows it at
`/`. A board outside a `.cards` directory gets no map. A directory under
`.cards/` that is a link to another directory counts as a board when it
holds one: a project can show the boards of one of its parts this way.

The map is a board page in its own mode. Each board is a tile: its name, its
revision, its title (a link that opens it), its description, a meter of its
cards done when it uses TODO states, its first sheet that is not done (the
drawing, scaled to the tile), and each ask that waits on the human as a
link to its card (an ask held by the ask it `:NEEDS:` waits, as on the
board). A board in more than one language (`#+translation_of:`, also a
translation of a translation) is one tile with a link to each language; a
`#+from:` or `#+needs:` that names a translation draws to that tile. A board
whose every card is `DONE` lies back. Groups whose names differ only in
case are one group.

| On the board | On the map |
|---|---|
| `#+category: Ingest` | the board lies in the frame "Ingest"; the oldest group comes first, a board after the boards it comes from |
| no `#+category:` | the board lies outside every frame, after the groups |
| `#+from: plan` | a grey line with an open arrow from `plan` |
| `#+needs: review` | a red line with a filled arrow from `review` |
| a link to a card or a board there | a dashed line, shown for the board in focus |
| an open ask | a tab on the tile ("2 asks"), a row on the tile, and a tab on the rail under the title |

The desk of the map works as the desk of a board: levels, focus (it names
each relation on the related tile), lines, zoom, full screen, Find, the
filters (Yours: boards with an open ask; Changed: boards that changed since
your last visit). Enter on a tile opens its board. Its other view is a list
(Map, List): one ruled row per board with its group, its asks that wait,
its cards done, when it changed and its revision, in the order of the map.
A click on a column's head sorts by it; a second click the other way; a
third goes back to the order of the map. The map has no Send and
no chat: it asks nothing itself. The human's own arrangement stays in their
browser: a tile dragged into a frame belongs to that group there, a frame
dragged by its name takes its boards along, its corner sizes it, New group
puts an empty frame beside the rest, and a double-click (or Enter) on a
name renames it. A board the agent adds later goes to the foot of its
group's frame, which grows, and what lies under the frame moves down by as
much; a board of a new group gets a new frame beside the rest. Arrange puts
every board back in the group it names. None of this reaches `board.org`,
and each project's map keeps its own arrangement.

A board page names, under its title, its group and the boards it connects
to: "Comes from", "Waits on", "Leads to" (the boards that come from it),
"Holds up" (the boards that wait on it), "Links to" and "Linked from". A
published copy names none of them.

`cards ls` prints the same map as text: each group, its boards, and what
each comes from, waits on and links to.

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
{"t":"say","at":"...","text":"Got it."}          the agent's answer to a comment (cards say)
{"t":"build","v":"0.1.0","at":"..."}             the build that rendered the board last
{"t":"font","v":"embedded","at":"..."}           the page carries its CJK font, or "system"
```

Send items: `mark` (keep, drop, more), `choose` (value, default, state:
confirmed, changed or chosen), `approve` (approve, reject), `do` (done,
cannot), `answer`, `reply` (a comment on a card), `order` (section, value),
`note` (a comment on the board). An ask item with no answer has the state
`untouched`, `aside` (set aside: the human will not answer it now; the
digest says `set aside`, and the ask no longer waits), or `held` with
`needs` (the asks it waits for) and `why` (`open` or `changed`). An answer
given after an ask it needs changed carries `after`. Each card item carries
the card version `v` the human saw. A round with only a `note` was a board
comment posted on a served board; the page shows the rounds, the `say`
messages and each revision as one thread in the Comments box.

## The page around the cards

The page a board renders to has one bar at the top that stays while the
page scrolls. Left to right: the mark, which leads home (from a board to
the map; on the map, back to its first view; on a published copy, to its
`--home` page or the project's page); Boards, a menu of the project's
boards by group (the map first, this board marked, each neighbour with what
it is to this one: "Comes from", "Leads to"; `b` opens it); the title;
whose turn it is; a tab for each open ask; a stepper from card to card (the
card in focus, of the cards shown; `j` and `k` do the same); the languages
of the board as short marks (EN, 中); About. The lede, the board's
neighbours, its revision and its path stand under the bar in the reading
view; on the desk they open from About. A published copy has no menu of
boards: its way back is `--home`.

On a desk zoomed out below reading size, the card under the pointer shows
beside itself at reading size, as at Gist (a peek; it takes no pointer, and
a click, the wheel or a key puts it away). A finger has no hover: a tap
reads the card, as before.

The human answers an ask, or sets it aside: "Set aside" under an ask, or
"Set aside all" in the bar, says that they will not answer it now (a board
whose session ended). It goes with Send as the state `aside`, and the ask
no longer waits, on the board and on the map. Any answer takes it back.
The human comments on a card ("Comment" on the card) or on the whole board
(the Comments box). On a served board a board comment posts at once; on a
file page every comment goes with Send. Send without a server copies the
reply; the dialog names the one command that keeps it on disk with no agent
session: `cards ingest <board>`, with the reply on stdin.

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
a public page. The copy holds the board as it is now: no replies, no comments,
no past versions of cards, no path on your disk. A file shown as a chip is
copied to `<dir>/files/`. Boards that translate each other link as
`../<board>/index.html`: export each one into a folder with its own name,
side by side. The export records nothing in `log.jsonl`. `--home <url>`
gives the copy a "Back" link to the page that links to it; without it a
copy has none.

## A font in the page

A board whose `#+language:` is Chinese, Japanese or Korean carries its own
font: a subset of an open font with only the characters the board uses, in
two weights, inside `board.html`, under the font's own name (for example
"Noto Sans CJK SC"). The page then looks the same on every
machine, and a machine with no CJK font shows no boxes. A Chinese sample
of 7 cards adds about 165 KB.

`cards render` does this when the machine has both of these, and says once
which way it went:

- an open CJK font: Noto Sans CJK or Source Han Sans (Debian and Ubuntu:
  `apt install fonts-noto-cjk`; macOS: put `NotoSansSC-Regular.otf` and
  `NotoSansSC-Bold.otf` into `~/Library/Fonts`). `CARDS_CJK_FONT` and
  `CARDS_CJK_FONT_BOLD` name the files directly.
- fonttools: `pyftsubset` on the PATH (`pipx install "fonttools[woff]"`), or
  `uv`, which runs it without an install.

Without them the page uses the reader's system font. A system font such as
PingFang or Microsoft YaHei is never put into a page: its license does not
allow it. `CARDS_CJK_FONT=none` turns the font off.

Characters the human types later (a reply in Chinese) that are not in the
subset show in the system font.

## Options in the address

A board page reads four options from its own address. None of them is saved.

| Option | Effect |
|---|---|
| `?view=desk` or `?view=rack` | open on that view |
| `?level=claim`, `gist` or `full` | open at that level |
| `?embed` | for a frame on another page: one row of tools (level, view, Send), no Comments box, and the wheel goes on to the page around the board at the board's edge |
| `?fresh` | for a sample anyone may answer: nothing is read from or kept in the browser, so each visit starts with the board as you wrote it |

`#c-<id>` at the end opens the page on that card.

## The older markdown dialect

`board.md` boards still render: `---\ntitle:\n---` frontmatter, `#` sections
with `{compare}`, `##` cards with `{#id ask=choose basis=fact from=a,b
needs=c status=doing progress=3/7 .tag}`, ```` ```facts ```` blocks,
```` ```sketch Caption ```` and ```` ```flow Caption ```` fences, and
`[[id]]` references. Write new boards in Org.
