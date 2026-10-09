# Connected cards: prior art for card-skill

Question: how do cards connect, branch, evolve, reference each other, and carry context, without the board turning into a mind map, flowchart, node editor, or infinite canvas?
Read 2026-10-08. Sources: vendor docs, a CHI paper, Hacker News threads (via hn.algolia.com), a few secondary review sites.

Marking: **[fact]** = stated in the linked source. **[inf]** = our inference or judgment. "secondary" = review site or third-party blog, weaker evidence.
Not done: no product was used hands-on. Flowith, Heptabase, Muse, and Miro were read from docs and reviews only. We found no Reddit threads, and we did not read G2 directly (it returned 403).

## Verdict

- [inf] Drawn edges only earn their cost when they have a job. In tldraw computer an arrow is data flow. In Flowith an edge is context inheritance. Where edges have no job, users ask what they are for (see 2.3). An edge needs a verb.
- [inf] Spatial layout pays off when the human does the placing, because the placing is the memory. In card-skill the agent places the cards. That removes the canvas's main benefit and keeps its costs: arranging, hunting, zoom drift, and "rug-pull" re-layouts.
- [inf] People value branching as an escape hatch: go back to a clean point, or ask an aside without polluting the main thread. They do not value it as a structure to look at. Builders of tree UIs say they mostly use a side panel or a linear flow (2.3).
- [inf] Two graphs get conflated: the human's reading structure and the agent's context graph. Show the human only the relations they act on. The agent can keep a richer graph.
- [inf] To show evolution, a short summary of what changed beats diff visualizations. Ink & Switch measured this (2.4).

## 1. Flowith

- [fact] Every input and response becomes a node. There are two modes. In **Follow-up First**, you click a node, and "Flowith will carry the full context of every node leading up to the one you selected". The reply appears below that node, joined by a dashed line. In **Quote First**, you click one or more nodes, even across branches, to cite them as references in one prompt. A (+) button duplicates a node so you can branch from it. https://flowith.io/docs/en/canvas/node-interaction
- [fact] Knowledge Garden: Flowith splits imported files into "fundamental knowledge units" (Seeds) and automatically matches them into later tasks. The docs say content "is automatically linked". https://flowith.io/docs/en/knowledge-garden/overview
- [fact, secondary] Agent Neo uses "Oracle", a planner that splits a goal into subtasks and calls tools (search, image, code) without the user toggling them. Vendor claims: 1,000+ inference steps and 10M tokens. https://www.eesel.ai/blog/flowith-review
- [fact, secondary] Complaints: the canvas position is not saved, so "with a lot of branches you land somewhere and have to hunt for where you left off" (G2 reviewer, quoted at the eesel link above). Also: "the canvas adds friction" for quick answers, new users "feeling overwhelmed", and "phone usage is awkward". https://dupple.com/reviews/flowith
- [fact] Flowith has almost no Hacker News discussion: two stories with 3 and 2 points. https://news.ycombinator.com/item?id=43237794 , https://news.ycombinator.com/item?id=43280361
- [inf] Flowith's edges do one real job: they define ancestry, and ancestry is the context. Quote First adds explicit references. Both are good primitives, and neither needs a 2D canvas. The canvas adds placement freedom that chat users mostly do not want, which produces the "hunt for where you left off" complaint.

## 2. Prior art by family

### 2.1 Spatial canvases

- [fact] Heptabase: cards live in a Card Library, and "whiteboards do not own cards". One card can sit on many whiteboards. Relations come from arrows, sections, and @mentions. https://wiki.heptabase.com/fundamental-elements
- [fact] Heptabase guidance: when a whiteboard feels cluttered, select related cards and "Create Section". Do not add third-layer sub-whiteboards until second-layer boards "contain over 100 cards". Use tags only for "purely archival records". https://wiki.heptabase.com/organize-knowledge-and-projects
- [inf] The vendor of the leading card canvas steers users toward grouping and away from depth. The idea worth taking is the split between card identity (library) and placement (board).
- [fact] Muse is now Allume: museapp.com redirects to allume.com. Boards nest inside boards. Nesting is the main organizing logic, and connections between cards are secondary. https://allume.com/
- [fact] Kinopio's founder: it is "not technically a mind mapping tool"; you "only connect what you want to connect". https://news.ycombinator.com/item?id=31464631 . A user on mind maps: "You have to kind of force the information into a certain structure". https://news.ycombinator.com/item?id=31463720
- [fact] tldraw Make Real: you sketch a UI and click Make Real, and a working site appears on the canvas. You then draw notes on top of it, and the next run gets the previous HTML plus those notes. https://tldraw.substack.com/p/make-real-the-story-so-far
- [fact] tldraw computer: components (text, image, instruction) are joined by arrows. On a run, each output becomes the next component's input. https://ai.google.dev/showcase/tldraw . The HN launch got 553 points. https://news.ycombinator.com/item?id=42469074
- [inf] tldraw's arrows work because they are executable. That makes it a node editor, which we want to avoid. The lesson still transfers: an arrow should only exist when it does something.
- [fact] Obsidian Canvas launched with 1380 HN points. https://news.ycombinator.com/item?id=34066824 . JSON Canvas has 4 node types (text, file, link, group). Edges have a side, arrow ends, and an optional label and color. A group is a "visual container". https://jsoncanvas.org/spec/1.0/
- [fact] A defense of manual layout: you would not want an editor that rearranges your sections, so "manual layout ... absolutely necessary". https://news.ycombinator.com/item?id=34091944
- [fact, secondary] Miro AI "Sidekicks" read the board items you select and produce outputs. Miro can also cluster stickies by theme or sentiment. https://www.gend.co/en-ca/blog/miro-sidekicks
- [inf] Miro's AI work moves toward clustering (grouping by attribute), not toward drawing edges.

What spatial layout costs, with evidence:
- [fact] Patchworks study (CHI 2014, 15 students). Code Bubbles is a canvas code editor. Its users spent "over 8 minutes longer" opening and arranging code than Patchworks users, who averaged 24 minutes. Patchworks users also made fewer navigation errors. The authors' rationale: people need "a rich mental model" of a topic before they can structure it, and arrangements "may be quickly rendered obsolete" when goals change. https://austinhenley.com/pubs/Henley2014CHI_Patchworks.pdf . The author on HN: "the canvas provided too much freedom". https://news.ycombinator.com/item?id=41077524
- [fact] "There's no natural sense of 'before' or 'after' on an infinite canvas", and "old things get small" as you zoom out. https://news.ycombinator.com/item?id=34103718
- [fact] Chris Granger (Light Table) built canvas code editors "about 4 times". His verdict: it "makes good intuitive sense, but bleeds to death from a whole bunch of paper cuts in practice". The exception is step debugging, where "there's a very definite flow". https://news.ycombinator.com/item?id=7275240
- [fact] A Here.fm cofounder said their canvas "descended into messy chaos no matter what you did", and that any fix "undid some of the benefits of the canvas". https://news.ycombinator.com/item?id=49189291 . On AI cleanup: "a housekeeper who straightens up your desk". https://news.ycombinator.com/item?id=49192202 . AI re-layout is "a frustrating rug-pull" for spatial memory. https://news.ycombinator.com/item?id=49191095
- [fact] Praise: users report that a visual component "really helps with recall", often citing ADHD or visual learning. https://news.ycombinator.com/item?id=41542532 , https://news.ycombinator.com/item?id=41651431

### 2.2 Link-first models

- [fact, secondary] Roam: each referenced block shows a count of references inline. Clicking the count expands the citing contexts in place. Each page ends with Linked and Unlinked References. https://thesweetsetup.com/a-thorough-beginners-guide-to-roam-research/
- [fact] Outliners with "mirrors" (live clones of a subtree, as in Workflowy) give graph structure without a canvas, plus collapse and a temporary root. https://news.ycombinator.com/item?id=34116013
- [fact] Scrapbox/Cosense: you link pages with brackets. The page footer shows direct links and "2-hop links", which are pages that share a link with this one. https://scrapbox.io/help/2-hop_link
- [inf] 2-hop links are computed relatedness. The author writes one link, and the system shows the neighborhood. It costs nothing in layout.
- [fact] Matuschak: evergreen notes "should be densely linked", and links beat hierarchy. https://notes.andymatuschak.org/Evergreen_notes_should_be_densely_linked
- [fact] Matuschak's own critique: "Backlinks are a weak peripheral vision". They are "a way of changing the one note you have open, not an effective means of sense-making across many notes", and when you navigate among them "you lose object permanence". https://notes.andymatuschak.org/zsRuFxYgckGS81tr2eiBAP
- [fact] Stacked panes: a followed link opens a fixed-width pane to the right, so the trail stays on screen. https://github.com/deathau/sliding-panes-obsidian
- [fact] Nelson (Xanadu): the core problem of hypertext is seeing connections side by side ("parallel textface", later "transpointing windows"). Transclusion means quoting by reference to the original, not by copy. https://mprove.de/visionreality/text/2.1.2_xanadu.html
- [inf] Transclusion fits "the same card, shown in two places" (Heptabase's card on many boards). It does not fit "this card evolved from that one". That is lineage, a different relation.

### 2.3 Branching conversations

- [fact] ChatGPT keeps every edit of a message in a revision tree. https://news.ycombinator.com/item?id=40304615 . Since September 2025, "Branch in new chat" copies the history up to a message into a new chat (web only). https://blog.tmcnet.com/blog/rich-tehrani/?p=25101
- [fact, secondary] Claude.ai: an edit or a retry creates a branch. Only one path is visible, and the others sit behind small "< 1/2 >" arrows with no overview. Third parties sell extensions to show the hidden tree. https://www.nodea.ai/blog/branching-ai-chat-guide
- [fact] Praise: you can branch back to "where the chat was still somewhat clean". https://news.ycombinator.com/item?id=46238296 . Complaints: ChatGPT's branch is "'open in new tab' with extra steps. No way to see where you are" (a dead self-promo post). https://news.ycombinator.com/item?id=46989480 . Also "the UI isn't great". https://news.ycombinator.com/item?id=47390994
- [fact] Loom (janus) is a tree of continuations. In Read mode, "the current node and its ancestry are read as a single history", and the tree sits in a sidebar. Visualize mode draws the full tree. https://generative.ink/posts/loom-interface-to-the-multiverse/
- [fact] Why people want side chats: to avoid polluting the main conversation and then navigate back. https://news.ycombinator.com/item?id=38407664 . "Context pollution": https://news.ycombinator.com/item?id=45687739
- [fact] A Twigg cofounder (tree UI for LLM context): "I often just used the side panel branch off ... The tree then kind of built itself." https://news.ycombinator.com/item?id=45689736 . A user: a personal memory device and LLM context management "should not be confused to be the one and same artifact". https://news.ycombinator.com/item?id=45691292
- [fact] The Juggler author uses the tree for large plans: sub-threads report summaries to the parent. For "most smaller tasks I tend to create a conversation, do a linear task, and bin it." https://news.ycombinator.com/item?id=48910856 . Users ask for Slack-style "aside" threads. https://news.ycombinator.com/item?id=48909080
- [fact] On node chat UIs: "node based workflows are ok when they're a necessary evil and just an evil otherwise". https://news.ycombinator.com/item?id=40301032 . "What's the point of drawing connectors, there seems no implied data flow?" https://news.ycombinator.com/item?id=40302123 . Counter-view: "the tree ... is the desired end result". https://news.ycombinator.com/item?id=40307815
- [fact] Claude Code makes a checkpoint for each prompt. Esc Esc or /rewind lists earlier prompts. You can restore the code, the conversation, or both, or "summarize from here". /branch forks the session. Bash edits are not tracked. https://code.claude.com/docs/en/checkpointing
- [fact] Cursor lets you restore a checkpoint from an earlier message. https://docs.cursor.com/agent/chat/checkpoints . A forum report says restore "permanently destroys change history" even though the UI says "you can always undo this later". https://forum.cursor.com/t/restore-checkpoint-permanently-destroys-change-history/129652
- [inf] The pattern that wins: one linear path visible, alternatives shown as a count plus a switcher, and an overview only on demand. Even Loom, a power-user tool, reads linearly by default.
- [inf] Tree-of-thoughts UIs: we found no shipped product with practitioner uptake, only demos. We did not check this deeply.

### 2.4 Version and evolution

- [fact] Google Docs suggestions show proposed text in color and deletions as strikethrough. You accept or reject each one, or all at once. https://support.google.com/docs/answer/6033474
- [fact] Figma branches: you explore without editing main, request a review, then merge. A conflict blocks the merge, and a merged branch is archived. https://help.figma.com/hc/en-us/articles/360063144053
- [fact] Ink & Switch Patchwork: you can create a branch retroactively. Strikethrough deletions made too much visual noise. "Brief AI summaries are a remarkably useful way to understand writing edits at a high level—more successful than any of our other diff visualizations so far." https://www.inkandswitch.com/patchwork/notebook/2024-version-control/
- [inf] Evolution has two verbs. **Revise** keeps the same card with new content: show the latest version, and keep history behind a count. **Supersede** means a new card replaces an old one: the old card leaves the default view and points forward. Git treats both the same way. A card UI should not.

## 3. Practitioner signal, compressed

Against (strongest first):
- Builders who shipped canvases call it chaos or paper cuts: Granger (7275240), Here.fm (49189291), and the Patchworks numbers (41077524).
- Edges without data flow confuse people: "what's the point of drawing connectors" (40302123), and node UIs are "an evil otherwise" (40301032).
- Tree-UI builders route around their own tree: Twigg (45689736) and Juggler (48910856).
- Canvas navigation: no before or after (34103718). Flowith users "hunt for where you left off" (eesel/G2, secondary).
- Hidden branches: Claude.ai's arrows and ChatGPT's "no way to see where you are" (46989480).

For:
- Manual layout is "absolutely necessary" for people who think spatially (34091944). It helps recall for visual and ADHD users (41542532).
- Branching as a way back to a clean point (46238296), and asides that keep context clean (38407664, 45687739).
- Huge launch interest: Obsidian Canvas got 1380 points (34066824), tldraw computer 553 (42469074).
- Interest is not the same as retention. We found no thread that reports long-term canvas use for chat-like work. [inf]

Every number above is an item id: https://news.ycombinator.com/item?id=<id>

## 4. Taxonomy of connection mechanisms

[inf] This table is our synthesis. The evidence for each row is in sections 1-3. "Cost" means visual complexity plus interaction cost. The 5 / 30 / 200 columns say how the mechanism holds up at that many cards.

| Mechanism | Communicates well | Cost | 5 | 30 | 200 |
|---|---|---|---|---|---|
| Spatial adjacency (free placement) | loose "these belong together"; the placer's own map | someone must place; no before/after; layouts go stale; re-layout breaks memory | great | needs regions; hunting starts | zoom drift; chaos without a gardener |
| Drawn edges | one specific A->B relation, flow | crossings; meaning unclear unless labeled; drawing is work | clear | spaghetti, or auto-layout that kills placement memory | unreadable; only filtered subgraphs work |
| Nesting / containment | part-of, scope; collapse | one parent only; hides content | overkill | good | good if shallow (Heptabase: 2 levels before 100 cards) |
| Ordering / sequence | before/after, cause, narrative; free to read | one dimension; cross-links invisible | trivial | scroll fatigue; needs anchors | works as a log with jump/filter; poor as overview |
| References / mentions (inline chip + "cited by N") | "answers / depends on / cites" at the point of use | low visual cost; meaning lives in text; following a link loses your place | fine | fine; counts become useful | fine for lookup, weak for overview |
| Transclusion (same card, many places) | identity: one thing, many contexts | live vs copy confusion; edits show up in surprising places | rarely needed | useful (one decision in two threads) | needed to avoid duplicates; needs an "appears in N" mark |
| Lineage / version (revise, supersede, fork) | "this replaced / evolved from that" | history hidden; stale cards if unmarked | inline note | stack + count + summary | stale-card risk dominates; must hide superseded cards by default |
| Grouping by shared attribute (lanes, status, tags) | "same state / same kind"; what needs me | one main facet per view; the rule must be stable and visible | unneeded | best overview | best overview + filter; lanes need counts and collapse |
| Focus + context (stacked panes, 2-hop, neighborhood on select) | local structure around the card being read | no global picture; costs a click | unneeded | good | the only relation view that still works |

Notes:
- [inf] Only rows 1 and 2 get harder to read with every card added, even when nothing else changes: each new card needs a place, and each new edge can cross the others. The other rows add one line or one badge per card. This matches the evidence: link-first tools hold up at 200 cards, and canvases need a gardener.
- [inf] Rows 5, 7, and 9 can be fully authored by the agent as data (typed links). Rows 1 and 2 need either human placement or auto-layout, and auto-layout is the "rug-pull" problem.

## 5. Three candidate connection models (not node graphs)

[inf] What decides between them: (a) whether the human mostly answers the newest card or audits the whole state, (b) how many threads run at once, (c) whether we trust the agent to write correct typed links. All three use one shared data contract: each card has an id, at most one `parent`, a list of typed `refs` (answers, depends-on, cites, alternative-to), and `revises` / `supersedes`. The agent writes these. The renderer decides what to show.

**A. Spine with asides (sequence + nesting + inline references).** Each goal has one ordered spine of cards, read top to bottom like a log. A card that moves the main line goes on the spine. A clarification, comparison, or sub-investigation becomes an aside folded under the card it came from, shown as one line: "2 asides: Postgres vs SQLite -> chose SQLite". The agent closes an aside by writing its conclusion back onto the spine as a card that cites it. Other relations show as inline chips ("depends on #14 Decision: use SQLite") with a hover preview, and each card shows "cited by N". The agent's context for a reply is the ancestry of the card the human answered (Flowith's Follow-up First), so the structure the human sees is the structure the agent uses. Evidence for the shape: Loom's read mode, demand for Slack-style asides, Juggler's sub-threads that report to the parent, Twigg's side panel. **Strongest objection:** it puts one narrative first. Links between distant cards (two asides that both bear on one decision) exist only as chips, which is Matuschak's "weak peripheral vision". At 200 cards the spine is a long scroll with no overview of what is open.

**B. Lanes and stacks (grouping by attribute + lineage).** The board has a few fixed lanes keyed by what the human must do: Needs you (decisions, questions), In motion (tasks, progress), Settled (decisions made, answers), and Reference (information). The agent puts each card in a lane by its state, and the human never drags. Evolution is a stack. A revised card keeps its identity and shows the latest version, with "rev 3: deadline moved to Fri" as a one-line summary (Ink & Switch). A superseded card leaves its lane and leaves a forward pointer ("superseded by #22"). Dependencies are text badges on the waiting card ("waiting on #9"), not arrows. Placement is set by a visible rule, so position means state. The agent can move cards without a rug-pull, because the human knows why a card moved. **Strongest objection:** this is kanban. It shows state well and hides reasoning: why a decision exists and what it branched from are one click away. With several threads running at once, lanes mix unrelated work. Choosing the main facet (state or topic) is a big commitment, and the wrong one makes the board useless.

**C. Focus with a context rail (focus + computed neighborhood + stacked panes).** The board stays a plain list or grid (by recency, or in B's lanes) and never draws relations globally. When you select a card, it opens in focus with a rail computed from the agent's typed links. The rail has six parts: Came from (the ancestry as one readable path, like Loom's read mode), Leads to (follow-ups and asides), Alternatives (siblings from the same fork, with the chosen one marked), Replaces / Replaced by, Mentioned in (backlinks with a snippet), and Also related (Scrapbox-style 2-hop). Following a link opens a stacked pane to the right, so the trail stays visible (Matuschak). Relations cost nothing until you ask for them, and the same view works at 5 cards and at 200. **Strongest objection:** there is no overview. You only learn the structure by visiting cards, so you cannot see at a glance that three open questions hinge on one decision. Everything depends on the agent writing correct typed links. A wrong or missing link is invisible until you happen to focus the right card.
