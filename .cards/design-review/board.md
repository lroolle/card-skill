---
title: card-skill design, five decisions for you
---

This board shows the card-skill design. Each part ends with a decision for you. Select **Desk** in the toolbar, or press **D**, to see the cards laid out with lines between them. Sources are in `docs/research/` and `vault/`.

# Links: what the old proposal missed

## The old proposal hid every line, so you could not see the structure {#rethink-lines basis=inference}
We rejected a canvas for one reason: a person remembers a layout only when they place the cards. Here the agent places the cards. That reason is about memory, not about structure. With no lines, you see the links of one card at a time.

```sketch Rack, card 6 in focus: you see the links of card 6 only
┌─ 5 ────────────┐  ┌─ 6 ────────────┐  ┌─ 7 ────────────┐
│ (dimmed)       │  │ IN FOCUS       │  │ Source of 6    │
│                │  │ Sources: 7     │  │                │
└────────────────┘  └────────────────┘  └────────────────┘
┌─ 8 ────────────┐  ┌─ 9 ────────────┐  ┌─ 10 ───────────┐
│ (dimmed)       │  │ Decides 6      │  │ (dimmed)       │
│ links to 5 and │  │                │  │ needs 8        │
│ 10: not shown  │  │                │  │ not shown      │
└────────────────┘  └────────────────┘  └────────────────┘
```

| The reason we gave | What it missed |
|---|---|
| A canvas helps only when the human places the cards. | A canvas also shows the structure. A layout by rule gives that, and nobody places a card. |
| Lines tangle past about 30 cards. | A board has 30 cards at most, and `cards check` warns past that. Only three link types draw lines. |
| Builders of canvases report "paper cuts" and mess. | Those canvases had free placement. A layout by rule has no placement to keep tidy. |
| An AI re-layout breaks your memory of the layout. | A layout by rule changes only when the board changes. Changed cards show "Changed". |
| Focus light still works at 200 cards. | Focus shows one card at a time. Our research named that cost: "there is no overview" (model C in `docs/research/connected-cards-prior-art.md`). |

## Luhmann never moved a card: he took cards out to use them and put each one back {#luhmann basis=fact}
Each card had a fixed address, because finding a card depended on it. A card in the wrong place got a link, not a new place. He took a card out to use it and put it back in the same place. We found no source that he spread cards on a desk to write.

```sketch The box keeps each card at its address; work uses a few cards
 THE BOX: one fixed address for each card
 ┌───────┬────────┬─────────┬───────┐
 │ 57/12 │ 57/12a │ 57/12a1 │ 57/13 │  ...  21/3d
 └───────┴─┬────▲─┴─────────┴───────┘
           │    │
  take out │    │ put back, same place
           ▼    │
 THE WORK: a few cards at a time
 ┌────────┐  ┌───────┐
 │ 57/12a │  │ 21/3d │   far link on 57/12a: "21/3d"
 └────────┘  └───────┘
```

```facts
cards: about 90,000, in two collections
address: fixed; 57/12 goes on as 57/13 or branches as 57/12a
wrong place: fixed by a link, never by a move
far links: about 50,000, written by hand on the cards
way in: a short index, 1 to 4 cards for each keyword
```

What this means for the board:

- The rack is the box. Each card keeps one numeral and one place in board.md.
- The desk is the work. It shows the same cards and moves none of them in board.md.
- His far links are our `from=`, `needs=` and `[[id]]`. He walked them by hand. The desk draws them.
- His editors drew an arc diagram of the links in one drawer to see where links are dense. The arcs in a desk column are the same kind of drawing.

The picture of Luhmann with cards spread across a desk is not in the sources we read. The closest source is his 1968 rule: "take it out when you use it, and put it back in exactly the same place". A 1987 interview, through Johannes Schmidt, calls his writing for one talk "a kind of collaging technique". So the desk is our design, not his method. The 1987 interview itself is unread. Sources and quotes are in `docs/research/luhmann-zettelkasten.md`.

# Links: three ways to show them {compare #link-options}

## Rack only: focus names the links, and no lines show {#opt-rack}
This is the old proposal. Sections give the order and numerals give addresses. Focus lights the related cards and names each link.

```sketch Rack only, card 7 in focus: 4 and 5 name their link, 1 and 2 do not
┌───────────┐ ┌───────────┐ ┌───────────┐
│ 1         │ │ 2         │ │ 4         │
│ (dimmed)  │ │ (dimmed)  │ │ Option    │
│           │ │           │ │ of 7      │
└───────────┘ └───────────┘ └───────────┘
┌───────────┐ ┌───────────┐
│ 5         │ │ 7  FOCUS  │
│ Option    │ │ Options:  │
│ of 7      │ │ 4, 5      │
└───────────┘ └───────────┘
```

```facts
lines: none
layout: sections, in board order
you see links: one card at a time
your cost: focus each card
agent cost: none
built: yes
```

## Rack to read, desk to see the links {#opt-desk from=luhmann}
Two views of one board. You read and answer on the rack. The desk puts each section in a column and draws lines between linked cards. A rule makes the layout, so nobody places a card.

```sketch Desk: the same five cards, a column per section
 A           B           C
┌───────┐   ┌───────┐
│ 1     ├──►│ 4     ├─┐
└───────┘   └───────┘ │  ┌───────┐
                      ├─►│ 7   ? │
┌───────┐   ┌───────┐ │  └───────┘
│ 2     ├──►│ 5     ├─┘
└───────┘   └───────┘
```

```facts
lines: on the desk, for from=, needs= and options
layout: by rule, a column per section
you see links: many at once; scroll sideways for more
your cost: one key (D)
agent cost: none
built: yes, press D
```

## Desk with free placement: you move the cards {#opt-free from=opt-desk}
The desk from the second option, and you can also drag a card to any place. Your layout stays until you reset it. People remember a layout that they make. The cost is the time to arrange it.

```sketch Free desk: the same five cards, where you put them
        ┌───────┐
        │ 2     ├──┐
        └───────┘  │
┌───────┐       ┌──▼────┐
│ 7   ? │◄──────┤ 5     │
└───▲───┘       └───────┘
    │   ┌───────┐   ┌───────┐
    └───┤ 4     │◄──┤ 1     │
        └───────┘   └───────┘
```

```facts
lines: as the second option
layout: you place cards; new cards go to an empty place
you see links: many at once, in your own layout
your cost: time to arrange; you keep it tidy
agent cost: none
built: no
```

In one study, the users of a canvas code editor spent over 8 minutes more to open and arrange code. The source is Patchworks, CHI 2014, in `docs/research/connected-cards-prior-art.md`. A builder of a canvas product said it "descended into messy chaos no matter what you did". Luhmann did not do this either: he never moved a card, and he fixed a wrong place with a link.

# Links: the decision

## On the desk, a line means "feeds into", and the far card names the link {#desk-rules basis=fact from=opt-desk}
Three links draw lines: `from=`, `needs=`, and the options of a decision. A mention draws a dotted line only for the card in focus. Focus turns the lines of that card blue. Each card at the far end names its link, for example "Source of 8".

```flow What draws a line on the desk
direction: right
source card -> card: from=
needed card -> card: needs=
option -> decision: listed as an option
mentioned card --> card: [[id]], focus only
```

- One column for each section, in board order. Cards keep board order in the column.
- A line starts and ends at the address line, where the numeral is.
- Lines run under the cards. A line between far columns shows in the gutters.
- Two links between the same two cards draw one line. The more specific link wins.
- The layout changes only when the board changes.
- The desk opens at the Claim level, as small tiles. Click a tile to open it in place. Gist and Full work too.
- Drag the empty desk to move it.
- On a phone, the desk shows one column at a time and snaps to the next.

## Which view do we keep for links? {#ask-connection ask=choose from=rethink-lines}
The rack stays for reading and answering in every option. The question is how you see the links. I recommend the rack and the desk, with the board opening on the rack.

- [x] [[opt-desk]] (opens on the rack)
- [ ] Rack and desk, but the board opens on the desk
- [ ] [[opt-rack]] (the old proposal)
- [ ] [[opt-free]] (not built yet)

# Figures: show, then tell

## A card shows the shape it talks about, and the text names it {#show-first basis=fact}
When a claim is about a layout, a flow or a structure, the card carries a figure. A decision about a view shows each option as a sketch. The first figure shows at the Gist level, under the gist.

```sketch Card anatomy: what shows at each level
  ┌ Choose ┐                        ◄ tab: an ask waits on you
 ┌┴────────┴────────────────────┐
 │ 12  Inference  v2            │  ◄ numeral and basis
 │ The claim, in one sentence   │  ◄ Claim level
 │ The gist, in one paragraph   │  ◄ Gist level
 │ ┌──────────────────────────┐ │
 │ │ figure                   │ │  ◄ Gist level, Fig. 12.1
 │ └──────────────────────────┘ │
 │ facts and options            │  ◄ Gist level
 │ depth: reasons, sources      │  ◄ Full level
 └──────────────────────────────┘
```

Figures have numbers, like card numerals: Fig. 12.1 is the first figure on card 12. You can point at a figure in words.

## A sketch block draws a layout in text characters {#fig-sketch basis=fact from=show-first}
Write a sketch with box characters, as in a terminal. The page shows it as written, in one ink, with a numbered caption. An agent writes it at low cost, and it reads the same in board.md, in a diff and in the terminal.

```sketch A wide figure makes its card two columns wide on the rack
┌─────────────────────────┐ ┌───────────┐
│ card with a wide figure │ │ card      │
│ ┌─────────────────────┐ │ │           │
│ │ figure, 50 columns  │ │ │           │
│ └─────────────────────┘ │ │           │
└─────────────────────────┘ └───────────┘
┌───────────┐ ┌───────────┐ ┌───────────┐
│ card      │ │ card      │ │ card      │
└───────────┘ └───────────┘ └───────────┘
```

The source of a sketch:

~~~~
```sketch What the figure shows, in a few words
┌────┐   ┌────┐
│ A  ├──►│ B  │
└────┘   └────┘
```
~~~~

- A sketch is 72 columns wide at most. A wide sketch makes its card two columns wide on the rack.
- Chinese and Japanese characters do not keep the columns. Use Latin labels in a sketch.
- A sketch has no colors and no markup. It shows in the ink of the card.

## A flow block draws boxes and arrows, and the compiler places them {#fig-flow basis=fact from=show-first}
Write one arrow on each line, such as `a -> b: label`. The compiler puts the boxes in ranks, orders them to cut crossings, and draws the arrows. The agent never places a box, so the same text always gives the same picture.

```flow The card-skill loop
**board.md** -> cards render: agent writes
cards render -> board.html
board.html -> you: open
you -> log.jsonl: Send
log.jsonl -> agent: cards wait
agent -> **board.md**: revise
```

- `a -> b` is an arrow. `a --> b` is a dashed arrow, for a later or optional step.
- `a -> b: label` puts a label on the arrow. `a -> b -> c` is a chain.
- `**a**` makes a bold box, for the part under discussion.
- `direction: right` draws left to right. The default is down.
- A flow has 12 boxes at most. Point at a box to darken its arrows.

# Writing: near ASD-STE100

## Cards follow ASD-STE100, about 80% of the way {#ste80 basis=fact}
Karpathy suggests ASD-STE100 to make model output easier to read. We take the rules that a checker can test, and the writer keeps the rest. Write one fact in each sentence. Use active verbs in the present tense. Use the same word for the same thing.

```facts
before: The server binds to loopback only, requires a per-run token and this server's Origin on every write, allows only its own Host names, takes board ids as slugs and never as paths, and checks every reply item by kind. (39 words)
after: The server listens on this machine only.
Every write needs the page token and this Origin.
The server accepts only its own Host names.
A board id is a short name, never a path.
The server checks each reply item by its kind.
sentence: 25 words at most; 20 for an instruction
paragraph: 6 sentences at most, one topic
words: the STE sheet list, and words that agents overuse
checked by: cards check, as warnings
```

The rules come from the ASD-STE100 sheet on Karpathy's post (`vault/assets/x/2105819303471976479-ste100-sheet.png`). The full profile is in `skill/reference/writing.md`.

## The checker warns on long sentences and on listed words {#ste-lint basis=fact from=ste80}
`cards check` and `cards render` count the words in each sentence and the sentences in each paragraph. They flag words such as "utilize" and "leverage", and they give the plain word. Quotes and code do not count. A board in another language skips these checks.

What the agent sees after `cards render`:

```text
board.md:56  warn: sentence has 28 words; split it (<= 25)
board.md:61  warn: "utilize": write use (writing.md word list)
ok: 24 cards, 9 sections, 2 warnings
```

Some rules need a person, not a checker: active voice, short noun groups, and one meaning for each word. They are in the profile as rules for the writer.

# Replies: the return path

## Your replies reach the agent as files, or by copy and paste {#return-channel basis=fact}
With `cards serve`, Send writes your reply to `log.jsonl`, and the agent reads it with `cards wait`. Without a server, Send copies the same text, and you paste it into the chat. An ask that you do not touch is reported as untouched. It is never consent.

```flow Two paths back to the agent
Send -> cards serve: served page
cards serve -> log.jsonl
log.jsonl -> agent: cards wait
Send -> clipboard: file page
clipboard -> chat: you paste
chat -> agent
```

- The server listens on this machine only.
- Every write needs the page token and the Origin of this server.
- The server accepts only its own Host names.
- A board id is a short name, never a path.
- The server checks each reply item by its kind.

A code review found three holes in the first version. Each fix has a test in `test/review.test.mjs`. In this container, your browser cannot reach the server. Use the file page and Copy.

## Make the local server the default return path? {#ask-server ask=choose from=return-channel}
The server removes copy and paste. It is one more process to keep running. It listens on this machine only, so a browser outside this container cannot reach it yet. That needs a capability URL (D12).

- [x] Server when it is reachable, copy as the fallback
- [ ] Copy and paste only, no server
- [ ] Both, and a Claude Code hook that gives the agent unread replies

# Look: the visual direction

## Cards look like kanban signal cards on a steel rack {#signal-cards basis=inference}
Cards are card stock on cool grey steel, in one ink. A yellow-red tab stands up only where the agent waits on you. Blue marks only your own acts and your focus. There are two colors, and each has one meaning.

The design roll (`f3a39d30`, a pool of 7) chose the Toyota kanban world. Three other worlds each gave one rule. Patent drawings gave reference numerals and figure numbers. The Munich 1972 pictograms gave one color for each role. Bamboo-slip books gave a struck line for an old version.

The colors are the JIS Z 9103 safety colors from factory floors. The desk adds a dot grid and lines in the same ink. A line turns blue only when you focus a card. The full record is in `DESIGN.md`.

## Approve the visual direction: kanban signal cards on a steel rack? {#ask-visual ask=approve from=signal-cards}
The board that you read now is the sample, in both views. If you reject it, I roll a new direction and use your reason as the brief.

# Foundation: decided rules

These rules are decided (D1 to D4, D6, D7, D9 and D10 in `docs/DECISIONS.md`). They give context for the decisions above. Mark Drop or reply to open one again.

## A card is the smallest unit you can judge and point at {#unit-of-judgment basis=inference}
Agents now write more than people can read. You can judge a wall of prose only as a whole. You can keep, drop, answer or question one card. Its numeral lets you point in words: "card 12 is wrong".

Karpathy names the job: "a lot more of our work will rise up the abstractions into oversight and understanding" (`vault/sources/x/karpathy-2026-10-02-understand-outputs.md`). In May 2026 he asked to "point and gesture at the screen" (`karpathy-2026-05-11-html-mind-meld.md`).

## Each card asks for one thing at most, and the top line says whose turn it is {#one-ask basis=inference from=unit-of-judgment}
A card is something to read or one of three asks: choose, approve or answer. The top line counts what waits on you. The agent puts its questions in one batch, and you answer them in one pass.

## Use a board only when cards earn it; most replies stay prose {#cards-earned basis=inference}
Use a board for three or more separate judgments, for a decision that only you can make, or for work across turns. One explanation is a paragraph, not a board. The checker warns at more than five open asks.

## Five primitives carry the whole system {#five-primitives basis=fact}
The five primitives are board, section, card, link and response. A revision is not a primitive. The compiler finds revisions on every render.

```flow How the five primitives fit
board -> section: holds, in order
section -> card: holds, in order
card -> other card: link
card -> response: your mark or answer
```

## Zoom changes the level of detail, not the size of the text {#altitude basis=inference}
The heading is the claim. The first paragraph is the gist. The rest is depth. Claim, Gist and Full in the toolbar show one, two or three levels.

```sketch One card at three levels
  Claim          Gist           Full
 ┌─────────┐   ┌─────────┐   ┌─────────┐
 │ claim   │   │ claim   │   │ claim   │
 └─────────┘   │ gist    │   │ gist    │
               │ figure  │   │ figure  │
               │ facts   │   │ facts   │
               │ ask     │   │ ask     │
               └─────────┘   │ depth   │
                             │ history │
                             └─────────┘
```

More on a card asks the agent to go deeper on that card. The interactive page can still "explain at the wrong level of abstraction" (@eliebakouch, in `karpathy-2026-10-02-understand-outputs.md`).

## Same question, edit the card; new question, new card {#revise-or-new basis=inference}
An edit keeps the numeral, and the old version stays under the card. A new card links back with `from=`. The compiler records each version, so the agent cannot lose history.

# Next: what to build

## What should the agent build next? {#ask-next ask=choose multi}
Select any. The order here is my recommendation.

- [x] An install step, and a Claude Code hook that gives the agent unread replies
- [ ] Free placement on the desk, if you did not choose it above
- [ ] An embedded CJK font subset for Chinese boards
- [ ] A project index that links boards to each other
- [ ] An explainer video for one board (a later phase)

## Name one real task from your week for the first real board {#ask-dogfood ask=answer}
Example content tests nothing. A real task tests the trigger rule, the patterns and the loop.
