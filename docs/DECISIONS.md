# Decisions

One entry per decision. Each entry gives the decision, the reason, the
alternatives we rejected, and the status. "Proposed" means the human has not
ruled yet. The matching ask cards are on `.cards/design-review/board.md`.
New decisions go at the bottom. Do not rewrite an old entry; supersede it.

Evidence keys: `amwh` = `docs/research/answer-me-with-html.md`,
`od` = `docs/research/open-design.md`, `canvas` =
`docs/research/connected-cards-prior-art.md`, `luhmann` =
`docs/research/luhmann-zettelkasten.md`, `proto` =
`docs/research/agent-ui-protocols.md`, `vault` = `vault/`.

## D1. A card is the unit of judgment, and cards are earned

2026-10-08. Accepted.
A card holds one claim and at most one ask, so the human can judge it alone.
Use a board only for three or more separate judgments, a decision only the
human can make, or work across turns. Otherwise answer in prose.
Why: generation is cheap and judging is the bottleneck (vault 2025-06-04,
2026-10-02). Prose can be judged only as a whole.
Rejected: "use it proactively and liberally" (amwh). It turns every answer
into a page and teaches people to ignore pages.

## D2. The board source is a markdown dialect, not JSON

2026-10-08. Accepted.
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
Why: the sharpest failure in the vault is the right medium at the wrong
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

2026-10-08. Proposed (ask card `ask-server`).
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

2026-10-08. Proposed (ask card `ask-visual`).
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
Why: Karpathy's list puts a diagram above prose (vault 2026-10-02). Nobody can
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
Why: Karpathy suggests STE for model output, "80% of the way" (vault
2026-10-02). A rule with no check drifts. The old board was near STE in
sentence length, but not in its other rules.
Rejected for now: a new writing standard for agents (later, if STE-80 falls
short on real boards); the full STE dictionary of about 900 words (too strict
for cards, and not in our sources).
Only English boards are checked.

## D15. Connected cards: the rack to read, the desk to see the links

2026-10-09. Proposed (ask card `ask-connection`). Supersedes D5.
One board has two views. The rack is D5: sections, numerals and focus light.
The desk puts each section in a column, in board order, and draws a line for
each `from=`, `needs=` and option link. A mention draws a dotted line only
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
