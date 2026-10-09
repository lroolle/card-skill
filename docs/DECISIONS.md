# Decisions

One entry per decision. Each entry gives the decision, the reason, the
alternatives we rejected, and the status. "Proposed" means the human has not
ruled yet. The matching ask cards are on `.cards/design-review/board.md`.
New decisions go at the bottom. Do not rewrite an old entry; supersede it.

Evidence keys: `amwh` = `docs/research/answer-me-with-html.md`,
`od` = `docs/research/open-design.md`, `canvas` =
`docs/research/connected-cards-prior-art.md`, `luhmann` =
`docs/research/luhmann-zettelkasten.md`, `proto` =
`docs/research/agent-ui-protocols.md`, `karpathy` = Karpathy's posts on
agent output and the human loop, by date: `docs/research/karpathy-posts.md`.

## D1. A card is the unit of judgment, and cards are earned

2026-10-08. Accepted.
A card holds one claim and at most one ask, so the human can judge it alone.
Use a board only for three or more separate judgments, a decision only the
human can make, or work across turns. Otherwise answer in prose.
Why: generation is cheap and judging is the bottleneck (karpathy 2025-06-04,
2026-10-02). Prose can be judged only as a whole.
Rejected: "use it proactively and liberally" (amwh). It turns every answer
into a page and teaches people to ignore pages.

## D2. The board source is a markdown dialect, not JSON

2026-10-08. Accepted. Superseded by D16 (Org) on 2026-10-09.
`board.md`: H1 = section, H2 = card, `{...}` attributes on headings.
Why: agents write markdown natively. A human can read and edit it in any
editor or in a git diff. amwh reports far fewer output tokens for a markdown
draft than for HTML (their benchmark; not reproduced).
Rejected: `cards.json` with a JSON Schema (recommended by od and proto). It
is easier to validate but worse to write and read, and multi-line text in
JSON strings is error-prone. Cost we accept: our own parser, with tests.

## D3. Five primitives; the agent has no style or layout controls

2026-10-08. Accepted.
Board, section, card, link, response. A section offers three layouts (grid,
compare, list). Nothing else is visual.
Why: every board looks the same, so people learn it once. A2UI removed theme
from its protocol; practitioners report a "too-clever layout DSL" as the trap
(proto). od says agent output is data and the app owns the renderer.
Rejected: per-card styles, colors, templates as visual variants.

## D4. Zoom is altitude: claim, gist, full

2026-10-08. Accepted.
The heading is the claim, the first paragraph is the gist, the rest is depth.
Claim / Gist / Full in the toolbar. More on a card asks the agent to go deeper.
Why: the sharpest failure in those posts is the right medium at the wrong
altitude (@eliebakouch). Pixel zoom is a canvas habit and does not help reading.

## D5. Connected cards: sections, numerals and focus light; no canvas, no edges

2026-10-08. Proposed (ask card `ask-connection`). Superseded by D15 on 2026-10-09.
Sections give reading order. Each card has a stable numeral. Focus lights
related cards, names the relation on each one, and dims the rest.
Why: a canvas helps when the human places cards, because placing is what
they remember; here the agent places them (canvas). Drawn edges tangle past
about 30 items. Focus plus context is the one relation view that still works
at 200. Luhmann's Zettelkasten linked cards by address and placement.
Rejected: node graph, mind map, infinite canvas, permanent edges.
Open alternative: a lineage view that lays one card's `from=` chain out as a
thread.

## D6. Links: from=, needs=, [[id]]

2026-10-08. Accepted.
Lineage, dependency, mention. Option refs on a choose card add a fourth name.
When two cards link in more than one way, the most specific name wins
(Option and Decides this beat Source and Follows from this).
Rejected: a typed relation vocabulary (supports, contradicts, ...). Agents
would misuse it. The reason belongs in the text.

## D7. Revisions are derived; numerals are stable

2026-10-08. Accepted.
Each render diffs every card against `log.jsonl`. A changed card gets a new
version and keeps its numeral; old versions show under the card. Numerals are
never reused. Rule for the agent: same question, edit the card; new question,
new card with `from=`.
Why: an agent forgets bookkeeping; the compiler does not. Slack's rule is the
same: the same block id keeps the user's input (proto).

## D8. Replies return as files; copy is the fallback

2026-10-08. Proposed (ask card `ask-server`). Accepted 2026-10-09: the human
confirmed "server when it is reachable, copy as the fallback" (round 1).
`cards serve` writes each Send to `log.jsonl` as a round; `cards wait` blocks
until one arrives; `cards inbox` prints unread rounds. A `file://` page copies
the same text instead. One digest implementation serves both
(`skill/runtime/digest.js`).
An untouched ask is reported as untouched, never as consent (amwh, MCP
elicitation in proto).
Security: localhost bind, a per-run token in the served page, Host and Origin
checks. Tested in `test/e2e.test.mjs`.
Rejected: copy-paste only (amwh's weak point: five manual steps, no ids).
Open: a Claude Code `UserPromptSubmit` hook that injects unread rounds (proto).

## D9. Zero dependencies; one self-contained HTML file

2026-10-08. Accepted.
Node stdlib, vanilla JS, no build step. The page carries its CSS, JS and data.
Why: the board must open from `file://`, offline, and survive being mailed.
Nothing to install means nothing to break.
Cost: our own markdown subset (`skill/lib/md.mjs`), with tests.

## D10. Drafts live in the page; sent replies live in the log

2026-10-08. Accepted.
Unsent responses are kept in `localStorage`. Once sent, the log is the record.
The page is never the source of truth (OpenAI: "Avoid localStorage for core
state", proto). A human reorder overlays the board only until the agent
publishes a new revision; the agent must apply the order in `board.md`.

## D11. Visual direction: kanban signal cards on a steel rack

2026-10-08. Proposed (ask card `ask-visual`). Accepted 2026-10-09: the human
approved it (round 1).
Roll `f3a39d30`, pool 7, assigned candidate #7 (Toyota kanban). Raises: patent
drawing numerals and one highlight tint; one color per role (Munich 1972
pictograms); a struck line for superseded versions (bamboo slips). Material
and reasons in `DESIGN.md`.

## D12. The server's threat model: other pages in the browser, and the network

2026-10-08. Accepted, after a code review found three holes in v0.
Loopback binds only (`--host 0.0.0.0` is refused). An exact Host allowlist
against DNS rebinding. A board id in a URL is a slug matched raw, never a
path and never decoded. A POST needs the per-run token and this server's
Origin. Each reply item is checked by kind before it reaches the log, because
the agent reads the log as the human's words. Author text cannot name an
internal placeholder (NUL is replaced), so markdown cannot emit raw HTML.
Regression tests: `test/review.test.mjs`.
Cost: the host browser cannot reach a server inside a container through a
published port, because that needs a non-loopback bind. The way out, if
needed: a capability URL that carries the token on every request, as
Jupyter does.

## D13. Figures are content: sketch and flow

2026-10-09. Accepted (the human asked for visual explanation as a first rule).
A card that talks about a shape shows it. Two fenced blocks do this:
`sketch` (text characters, shown as written) and `flow` (arrows written as
text; the compiler places the boxes with a small layered layout). The first
figure shows at the Gist level. Figures are numbered per card: Fig. 12.1.
Why: Karpathy's list puts a diagram above prose (karpathy 2026-10-02). Nobody can
judge a decision about a view from a paragraph. A sketch costs an agent little,
and it reads the same in a terminal, a diff and the page. A flow keeps the
agent out of placement, as the board does.
Rejected: SVG written by the agent (a sanitizer is a large attack surface, and
free colors break the role colors); Mermaid (a dependency and a large grammar);
image files (not readable in a diff).
Cost: our own layout code, `skill/lib/figure.mjs`, with tests in
`test/figure.test.mjs`. CJK text in a sketch loses its columns.

## D14. Cards are written near ASD-STE100, and the checker tests what it can

2026-10-09. Accepted (the human asked for it).
The profile is `skill/reference/writing.md`. The checker warns on a sentence
over 25 words, a paragraph over 6 sentences, and words from a list: the
examples on the STE sheet and words that agents overuse. Active voice, simple
tenses, short noun groups and one meaning for each word stay rules for the
writer.
Why: Karpathy suggests STE for model output, "80% of the way" (karpathy
2026-10-02). A rule with no check drifts. The old board was near STE in
sentence length, but not in its other rules.
Rejected for now: a new writing standard for agents (later, if STE-80 falls
short on real boards); the full STE dictionary of about 900 words (too strict
for cards, and not in our sources).
Only English boards are checked.

## D15. Connected cards: the rack to read, the desk to see the links

2026-10-09. Proposed (ask card `ask-connection`). Supersedes D5. Accepted
2026-10-09 with a change: the board opens on the desk, not the rack (round 1,
"Rack and desk, but the board opens on the desk"). D17 extends the desk.
One board has two views. The rack is D5: sections, numerals and focus light.
The desk puts each section in a column, in board order, and draws a line for
each `from=`, `needs=` and option link. A mention draws a dashed line only
for the card in focus. A rule makes the layout, so no agent and no human
places a card. Press `D` to switch.
Why D5 was wrong: it rejected a canvas because people remember what they
place, and here the agent places the cards. That reason is about memory. It
missed the other benefit of a canvas: you see the structure at once. A layout
by rule gives that benefit with no placement. Our research named the cost of
focus-only links ("there is no overview", model C in canvas), and D5 accepted
that cost without a test. The human rejected it on the first review.
Luhmann (luhmann): each card had a fixed address and never moved. He took a
card out to use it and put it back in the same place. We found no source
that he spread cards out to write. So the rack is his box, and the desk is a
temporary view that moves nothing in board.md. A persistent free layout
would be our choice, not his method.
What stays from D5: lines tangle in a free graph, so only three link types
draw lines, on boards of 30 cards or fewer. A line that skips a column
crosses it in a gap between cards, never behind a card (`test/e2e.test.mjs`).
The rack stays the place to read and answer.
Rejected for now: free placement by the human (an option on the board; it
costs time to arrange, Patchworks in canvas); a force layout (it moves on
every change, the "rug-pull" in canvas); one layered graph of all cards (it
loses the sections that the agent wrote).
Open: which view opens first; free placement.

## D16. Boards are written in Org mode

2026-10-09. Accepted (the human asked for Org in place of markdown). Supersedes D2.
`board.org` is plain Org: `*` sections, `**` cards, a property drawer for the
id and the links (`:CUSTOM_ID:`, `:ASK:`, `:BASIS:`, `:FROM:`, `:NEEDS:`),
the TODO keyword for the status, a `[3/8]` cookie for progress, tags for
section layout, a description list for the facts, `#+caption:` and
`#+begin_src sketch|flow` for figures, `[[#id]]` for references. Spec:
`skill/reference/format.md`. Reader: `skill/lib/org.mjs`.
Why: the markdown dialect had to invent syntax (`{#id ask=choose}`, facts
fences, `[[id]]`); Org has a native form for each of them, so a board is
plain Org that reads correctly in Emacs, on GitHub and in any editor. The
human reports that frontier models write Org as well as markdown.
How it fits: both readers produce the same blocks, so figures, widgets, lint
and the runtime did not change. A version is now a change in meaning
(`canonical()` in `skill/lib/board.mjs`), so converting this board from
markdown to Org created no revisions for the 10 cards whose content did not
change. Older `board.md` boards and log entries still render.
Costs: two readers to keep; Org's emphasis rules mean paths and keys go in
`=verbatim=`; a single blank line does not end an Org list, so ours ends a
list where the item kind changes (description, checkbox, plain).
Rejected: keeping markdown as the format agents write; JSON (D2).

## D17. The desk is a canvas: zoom, your own layout, typed lines, a note dock

2026-10-09. Accepted as the human's request; five choices inside it were the
agent's and waited on ask card `ask-canvas`. The human approved them (round 2).
- Opens on the desk at Fit: the whole board, scaled to the window. Fit, 50%
  and 100% presets (`z`), Ctrl or Cmd with the wheel or a pinch zooms at the
  pointer. Focusing a card below 75% zooms to it at 100%; Esc goes back.
  The human suggested 10%; at 10% no text can be read, so Fit is the
  overview (agent's choice 1).
- Your layout: drag a card by its top strip (agent's choice 2: the address
  line is the handle, so text stays selectable) or its grip. The first drag
  freezes the rule layout, so nothing jumps; a moved card snaps to the 24px
  dot grid. Arrange restores the rule layout, with Undo. Alt + arrows move a
  placed card. The layout lives in this browser and never in `board.org`
  (agent's choice 3: Luhmann never moved a card in the box; the desk is the
  work surface). A card added later goes to a new column at the right
  (agent's choice 4), so nothing you placed moves.
- Typed lines: source grey with an open arrow, needs red (the color of
  "blocked") with a filled arrow, option violet with a diamond at the
  decision, mention dashed with a dot. Focus thickens a card's lines and
  fades the rest; the lines no longer turn blue, so the type stays readable.
  A key in the desk bar names the four types.
- The board note moved from a footer to a dock in the bottom-left corner,
  in both views (`c`).
- A phone (720px or narrower) opens on the rack: at that width the whole
  desk fits only as a minimap (agent's choice 5; the Mac review of rev 7).
  At any zoom, lines keep their screen width and their end shapes their
  size. On your own layout, lines lie above the cards, faint where they
  cross one.
Why: the human asked for each of these. Evidence for the defaults: the Mac
review of the page in a browser on a Mac, and the design reviews.
Rejected: free placement that the agent sees or that edits `board.org`; a
force layout (it moves on every change); pixel zoom without semantic zoom
(Claim, Gist and Full still change what a card shows).
Tests: `test/e2e.test.mjs` "desk canvas".

## D18. The board note becomes a direct chat with the agent

2026-10-09. Accepted (the human asked: move it to the right, make it a direct
chat). Supersedes the note-dock part of D17.
A chat box in the bottom-right corner (`c`). Enter sends a message now, as
its own round with one `note` item, apart from the card answers; Esc or Undo
holds it back for 5 s, as with Send. The agent answers with `cards say
<board> "..."`, a `say` event in `log.jsonl` that changes no card; a served
page shows it at once, a file page after a reload. The thread shows your
rounds, the agent's messages and each published revision, in time order. A
new agent message puts a yellow-red dot on the closed box. Without a server,
Send copies only the message.
Why: a note about the whole board is a conversation, and it was hidden in a
form field that waited for the batch Send. Card answers stay one batch
(D1): judgments are batched, conversation is not.
Cost: a chat round wakes `cards wait` while the human may still be marking
cards; SKILL.md tells the agent to answer briefly with `cards say` and to put
anything to judge on the board.
Rejected: the agent replying by editing the board lede (it is not a
conversation, and it would be a revision); a chat that also carries the card
drafts (it would split the batch silently).
Tests: `test/e2e.test.mjs` "chat", `test/review.test.mjs` "cards say".

## D19. Cards show files: images, excerpts, and a chip for the rest

2026-10-09. Proposed (the human asked: inspect content in the card, not
elsewhere). On the open-source board, card `files`.
Org's own syntax, nothing new: a paragraph that is one bare
`[[file:x.png]]` is an image figure (numbered, captioned, the first one
under the gist); `#+include: "f" src lang :lines "a-b"` is an excerpt with
its path, its range and line numbers (Org's range: the upper end is not
included); any other file alone on a line is a chip with type, name and
size. Paths are relative to `board.org`, as in Org.
The compiler reads every file at render and embeds it: an image as a data
URI with its pixel size from the header (the desk measures cards before
images decode), an excerpt as escaped text. A click opens an image in a
dialog in the page; a second click shows its real pixels.
Fences, as errors with a fix: a missing file, an absolute path, a file
outside the project (the parent of `.cards`), a file that may hold secrets
(`.env`, keys, `.git/`), a binary excerpt, a range outside the file.
Warnings: an image over 1 MB, 8 MB of files on a board, an excerpt over
120 lines, an image with no caption.
Versions: `canonical()` keeps the path; the log keeps a hash of each file a
card shows (`files` on the card event), so a changed image, or a changed
line inside an excerpt, is a new version, and an edit elsewhere is not.
Why: a retelling of a screenshot or a code path asks the human to trust
the agent; the file itself lets them check. The page stays one file (D9).
Cost: the page grows with every image; the warnings cap it in practice. A
chip's link works when the board opens from disk, not on a served page.
Rejected: fetching remote images (the page would leak the reader and break
offline); previews of PDF and video (embedding them makes the page huge and
the viewers differ per browser); paths relative to the project root (it
breaks the board in Emacs and on GitHub, where Org paths are relative to
the file); a markdown syntax for files (boards are Org, D16).
Tests: `test/assets.test.mjs`.

## D20. The page chrome speaks the board's language

2026-10-09. Proposed (the human asked: i18n in the card board, without
extra complexity). On the open-source board, card `i18n`.
`#+language:` picks the string table for buttons, labels and help: one flat
JSON file per language in `skill/runtime/lang/`; `en.json` holds every key,
and a missing key or language falls back to English. `en` and `zh-Hans`
ship; `zh`, `zh-CN` and `zh-Hans-CN` use `zh-Hans`. The compiler puts only
the board's table into the page. Dates follow the board's language. On a
Chinese or Japanese board, emphasis is a dot under each character, not a
slanted glyph.
Why: one board is written for one human in one language, so the board, not
the browser, decides. A page with Chinese cards and English buttons reads
as two products.
Cost: every new string in the runtime needs a key in each file; a test
checks that every language has every key and the same placeholders.
Rejected: a language switch on the page (it doubles the writing and the
versions, and two languages of one card can say different things);
following the browser's language (the chrome would disagree with the
cards); translating the reply to the agent (the agent reads English data,
and the human's own words go through as written); an i18n library (a
lookup and a placeholder fill are the whole need).
Open: a Chinese font in the page (the CJK subset of round 1) needs a
subsetter; today the page uses the system font.
Tests: `test/i18n.test.mjs`.

## D21. An ask that depends on an ask waits for it

2026-10-09. Built, after the first field report (a human changed a band,
kept a size whose range was quoted for the other band, and approved the
order in the same reply).
`:NEEDS:` between two open asks is a gate, in three forms. `:NEEDS: a`: the
ask is written for the option the agent suggested in `a`. `:NEEDS: a=link`:
it applies only when `a` is answered `link`. `:NEEDS: a=*`: it takes any
answer of `a`. The page shows a waiting ask with its controls off and the
reason in words. When the human answers `a` otherwise than the ask was
written for, the ask is held (form 1) or marked "Not needed" (form 2); the
reply says `held` and why. In form 1 the human can press "Answer anyway";
the reply then carries `[answered after #n changed]`.
Why: a human answers a board in one batch. An approval that rests on an
answer they just changed is the worst kind of yes: it looks like consent
and is not.
Cost: one more state for an ask (`held`), on the page, in the reply and in
the server's checks.
Rejected: a line with no gate (the old behavior: it draws the dependency
and enforces nothing); hiding the dependent ask (disabled, not hidden: the
human sees what will be asked); opening on any answer by default (the
unsafe default: the premise changes in silence; the agent must opt in with
`=*`); a rule that the agent asks dependent questions in separate rounds
only (right, but a board must be safe when the agent does not follow it).
Tests: `test/e2e.test.mjs` "asks that depend on asks", "asks written for
one answer"; `test/loop.test.mjs`.

## D22. The reply is a wire format; a pasted reply is recorded

2026-10-09. Built (field report: in a container and on a published page
the reply is copy and paste, and the log never learned of the round).
The digest is one text for three uses: the human reads it, the agent reads
it, and `cards ingest` parses it back into the items a served page would
have posted. So a line is `who  kind  what`, the human's words are JSON
strings, an option comes back as its key, and a copied reply carries a
short key. `cards ingest` records the round once and marks it read.
`DONE` on an ask card closes the ask and keeps the ask and its options as
the record; `cards settle` sets the keyword on every answered ask.
Why: without a record the board still showed answered asks as open, and
the agent rewrote each card by hand, once per language.
Cost: the digest is now a format with a parser and a round-trip test; a
change to its words can break `ingest`.
Rejected: a base64 blob at the end of the copied text (exact, but noise in
a chat and opaque to the human who pastes it); a set of commands that edit
`board.org` for each kind of revision (one keyword covers the common case;
the rest is the agent's own editing); removing `:ASK:` from a closed card
(the question is the context of the answer).
Tests: `test/loop.test.mjs` "ingest"; `test/e2e.test.mjs` "a pasted reply".

## D23. A copy to publish is its own artifact

2026-10-09. Built (field report: a hand-made publish folder, stale copies,
and a page that carried past replies and an absolute path).
`cards export <board> --out <dir>` writes `index.html`: the board as it is
now. No replies, no chat, no past versions of cards, no path on the disk.
A file shown as a chip is copied beside the page. The export records
nothing. Every page, local or published, now has a description, link
preview tags, `#+author:`, an icon, and a mark that links to the project.
The icon and the browser tab's title show when an ask waits.
Why: `board.html` is a working file between one human and one agent. A
page for other people is a different thing with a different promise, and
"I grepped for private strings" is not a promise.
Cost: a second output mode in the compiler, with a test that reads the
file for each thing it must not hold.
Rejected: a `--public` flag on `render` (the same file name for two
different promises); a reply endpoint for published pages (a server, an
account or a third party; a reader copies the reply and sends it);
`#+icon:` and `#+keywords:` (no reader is served by them); a preview image
(a board has no public URL of its own to name one).
Tests: `test/loop.test.mjs` "export"; `test/e2e.test.mjs` "published copies".

## D24. The first view shows the most that fits; Claim is the map

2026-10-09. Built (field report: the first view hid the pictures, and Fit
at Gist was 20%). Refines D15 and D17.
A picture shows at every level on the desk: at Claim it is a thumbnail on
the tile. With no level picked yet, the desk opens at Gist when every
section fits the window's width and the board is at most two windows tall;
else at Claim. Claim is the map: Fit there shows every card, however
small. Gist and Full are for reading: Fit there never goes below 50%; a
tall board fits the width and scrolls down. Fit leaves about 30% of the
table empty around the cards.
Why: a rule, not a knob. A board made to look and pick must open on what
there is to see, and "Fit" must never be a view that nobody can read.
Cost: Fit means two things by level, said in one comment in `board.js`.
Rejected: opening on the rack when a compare section has pictures (the
desk is the first view, D15); a keyword that sets the first view
(`#+startup:` in Org names fold states that do not match our levels, and a
knob per board is how first views go wrong); semantic zoom, where the zoom
picks the level (a card's height changes with its level, so the layout
would move under the pointer).
Tests: `test/e2e.test.mjs` "first view".

## D25. An update is never silent

2026-10-09. Built (field report: the installed skill was replaced under a
running session; boards written for the old build passed `check` and would
have rendered photos as code).
One version number (`skill/lib/version.mjs`, `package.json`, `SKILL.md`,
`CHANGES.md`; a test keeps them equal). `cards --version`. `CHANGES.md`
inside the skill, written for the agent. The log records which build
rendered a board last, and `check` and `render` say once when it was
another. `render` ends with the build's version, because a session keeps
the `SKILL.md` it loaded at its start. `check` warns about syntax that
does nothing in this build: an unknown `#+keyword:`, an unknown block
type, a `#+begin_src` language that names a drawing we do not draw.
Why: a format that degrades in silence teaches the agent the wrong thing
is fine.
Cost: a short list of words (`image`, `mermaid`, `chart`, ...) that mean
"the writer wanted a drawing"; it will miss some.
Rejected: an error for unknown keywords (a valid Org file carries many we
do not read); a warning for every Org setting such as `#+startup:` (noise
that punishes valid Org).

## D26. One board in two languages is two linked boards

2026-10-09. Built (field report: a second language was needed within a
day; every revision was two edits, and the reply landed in one board
only). Refines D20, which rejected a language switch.
A translation is a second board that says `#+translation_of: <board>` and
keeps the card ids and option keys of its source. Each page links to the
other, in the same tab. `cards check` on the translation lists what fell
behind: a missing card, an extra card, a different ask, different option
keys, a card the source changed later. `cards inbox <source>` prints the
replies sent from a translation as well.
Why: D20's reason stands (two languages of one card can say different
things), so the tool finds the difference instead of hiding it.
Cost: the writing is still double. Each board keeps its own log.
Rejected: two languages in one `board.org` (Org has no construct for it,
and every card would double in the file the agent reads); one shared log
(card versions differ per language); machine translation in the compiler.
Tests: `test/loop.test.mjs` "translations".

## D27. We adopt the text Org leaves in the file, not what Emacs does

2026-10-09. Built, from a reading of 20 Org features against the manual.
A board declares its states (`#+todo: TODO DOING BLOCKED | DONE`), because
Org knows only `TODO` and `DONE` by default. A planning line (`CLOSED:`,
`SCHEDULED:`, `DEADLINE:`) may stand between a heading and its drawer. The
properties Emacs writes on its own, and a `:LOGBOOK:` drawer, are ignored,
not errors. A comment block is not shown. `check` warns about a blank
line before a drawer and about `DOING` with no `#+todo:` line.
Why: "plain Org" was a claim nobody had tested against Org. Three of our
own constructs were not Org to Emacs or to GitHub.
Rule for what comes next (the roadmap board): a feature of Org is in scope
when its state lives in the file as text (keywords, drawers, cookies,
`#+RESULTS:`, footnotes), and out of scope when it is behavior of the
editor (column view, agenda commands, capture, macros).
Open: no test runs a board through Emacs; `org-lint` in CI is on the
roadmap.

## D28. Three small additions to an ask

2026-10-09. Built (field report).
`:ASK: do`: an action only the human can take outside the board; the
answer is Done or I cannot. `:SUGGEST: none` on a choose card: only the
human knows, so no `[X]`, no warning, and the reply says `chosen`. Option
keys, `- [ ] small :: S/M, 140 to 180 mm`: the reply names the key, so an
answer survives a rewording and a translation.
Why: each was a thing an agent could not say honestly: "I am blocked on
you, outside this page", "I have no recommendation", "this option, in any
language".
Rejected: custom button labels on `approve` (a `do` is not a judgment of
the agent's work, and the reply should say which it was); card ids made
from the claim (field report 3.1: an id holds the card's history, answers
and links, and a claim is rewritten often).

## D29. A CJK board carries a subset of an open font

2026-10-09. Built. The human chose this in round 1 of the design review;
D20 left it open.
When `#+language:` is Chinese, Japanese or Korean, `cards render` puts two
weights of an open font into the page, cut down to the characters the board
and its chrome use. The font covers CJK characters only (`unicode-range`);
Latin stays with the system face. The subset keeps the font's copyright and
license records. A Chinese sample of 7 cards grows by about 165 KB.
The skill ships neither the font (20 MB) nor the subsetter (fonttools is
Python). It uses what the machine has: Noto Sans CJK or Source Han Sans,
and `pyftsubset` directly or through `uv`. Without them the page keeps the
system font, and render says so once, with the way to set it up.
Why: a page with Han text is a different page on every machine, and boxes
on a machine with no CJK font. That includes the machine an agent takes
its own screenshots on.
Cost: an optional outside tool at render time, as Playwright is for
`cards shot`; a second or two on the first render of a board, then a cache.
Rejected: shipping a font in the skill (size); embedding the system's own
face, such as PingFang or YaHei (their licenses do not allow it); a font
from a CDN (the page must work with no network); the full font (megabytes
for each board); writing a subsetter in Node (CFF outlines are a project
of their own).
Open: characters the human types into a reply are not in the subset; they
show in the system font.
Tests: `test/font.test.mjs`.

## D30. A board in a frame, and a sample anyone may answer

2026-10-09. Built, from the fresh review of the landing page.
`?embed` in a board's address: one row of tools, no chat box, and the wheel
goes on to the page around the board. `?fresh`: the page reads and keeps
nothing in the browser. `?view=` and `?level=` pick the first view once.
After an answer, the keyboard focus stays on the control that was used.
Why: the landing page shows a live board in a frame. There the full
toolbar took a third of the frame on a phone, the board swallowed every
wheel turn, and a second visit showed the first visit's answers under a
page that still said "1 ask waits on you". A keyboard user lost the focus
on every answer, on every board.
Rejected: a separate "demo build" of the page (a sample must be the real
page); a reset button on the landing page (state that should not exist is
better not kept).
In a frame the tools are a strip along the lower edge, the ask tabs stay
in sight while the cards scroll, and the link to the board's other language
keeps the options of the address. A sample (`?fresh`) says that it is one
when you send. All four came from a second review of the landing page.
Tests: `test/e2e.test.mjs` "a sample in a frame", "touch".

## D31. Org itself is in the test loop

2026-10-09. Built. Closes the open point of D27.
`test/emacs.test.mjs` runs `org-lint` in a real Emacs on every template and
on the boards the project shows, and compares what Emacs reads from each
card (state, id, ask, needs, tags, claim) with what our parser reads. It
skips without Emacs; CI installs Emacs and requires it.
Why: "a board is plain Org" was a claim with no test. Now a change to the
format that Org reads differently fails the build.
Found by it: nothing, after D27. `org-lint` does flag the two faults our
own check warns about (a blank line before a drawer, a link to a card that
does not exist).

## D32. A project has a list of its boards

2026-10-09. Built. The human chose this in round 1 of the design review
("a project index that links boards to each other").
Each render writes `.cards/index.html`: every board with its title,
revision and open asks, the boards with open asks first. Each board page
links back ("All boards"). `cards serve` shows the same list at `/`. A
published copy has no such link unless `cards export --home <url>` names
the page that links to it.
Why: with five boards nobody knows which one waits. The list is also the
way back from a board, which a page opened from a link did not have.
Cost: one more generated file in `.cards/`. It is rewritten on every
render and never read by the tool.
Rejected: a list only in the terminal (`cards ls`): the human is in the
browser; a link from a published copy to a list on the writer's disk.
This is the base of the roadmap's "agenda" direction, not the whole of it:
the list counts asks per board; an agenda would list the asks themselves.
Tests: `test/loop.test.mjs` "index".

## D33. Replies can arrive on their own, by a hook the human installs

2026-10-09. Built. The human chose this in round 1 ("a Claude Code hook that
gives the agent unread replies").
`cards hook` prints the lines for `.claude/settings.json`: a
`UserPromptSubmit` hook that runs `cards inbox --quiet`. With it, replies
that the human sent from a served board reach the agent with the human's
next message, once, and print nothing when none waits.
Why: the agent had to remember `cards wait` or `cards inbox`. A reply that
nobody reads is the loop broken in silence.
The agent prints the lines and the human decides: the tool does not edit
settings, and SKILL.md tells the agent not to.
Rejected: a command that writes the hook into the settings (an agent's tool
must not change what runs on every message without the human's own hand);
a Stop hook that blocks the agent until a reply arrives (it turns a
question into a lock).
Tests: `test/loop.test.mjs` "hook".

## D34. An id may be written by the tool, once

2026-10-09. Built. Supersedes the rejection in D28 (field report 3.1: three
drawer lines on every card, about 80 lines on a board of 27).
A card may be written as a heading and its text. `cards ids <board>` gives
every card without a `:CUSTOM_ID:` one made from its claim, and writes the
drawer into `board.org`. The error for a missing id names the command.
Why this and not ids derived on every parse: an id holds the card's
history, its answers and its links, and a claim is rewritten often. Written
once into the file, the id survives the rewrite; derived each time, it
would not. The agent still saves the typing; the file still says, in plain
Org, which card is which.
Cost: a second command that edits `board.org` (after `settle`). It only
adds lines, and only where no id is.
Rejected: writing the ids during `render` (a render that changes its own
input surprises the agent that holds the file open); a short one-line id
syntax of our own (not Org).
Tests: `test/loop.test.mjs` "ids".

## D35. A tagged version is closed; the next change of the skill opens a new one

2026-10-09. Built. Completes D25.
Found on our own release. v0.1.0 was tagged, and then 8 commits changed 17
files of `skill/` under the same number: three commands, the font, the
address options. A board rendered by a copy of the tag and then by a copy
of main got no note, because both copies said "cards 0.1.0". The update
was silent again, which is what D25 was built to stop.
Rule: once `v<VERSION>` is a tag, `skill/` stays as tagged. The first
change after it raises VERSION and opens a section in `skill/CHANGES.md`.
A test fails otherwise. CHANGES.md for 0.1.0 is again what the tag said;
what came after is 0.2.0.
Why a test and not a habit: the habit failed on the first release.
Cost: CI fetches the whole history for the tags. Between two tags, two
copies made from main at different commits still share one number, so a
version should be tagged soon after it is opened.
Rejected: a hash of `skill/` in the name of the build. It finds every
change but cannot say what changed, and CHANGES.md is written by version.
Tests: `test/loop.test.mjs` "version: skill/ does not change under a
version that is already tagged".
