# Agent-to-UI protocols: lessons for the card-skill contract

Read 2026-10-08. Scope: the contract between an agent and a card board. The agent writes a board spec. A fixed renderer makes a self-contained HTML board. The human's feedback goes back to a CLI agent through files.

Method: we read specs, schemas and docs at the source. Repos cloned shallow on 2026-10-08: a2ui-project/a2ui, modelcontextprotocol/ext-apps, ag-ui-protocol/ag-ui. We also read the Adaptive Cards 1.6 JSON schema, docs.slack.dev, developers.openai.com, ai-sdk.dev, code.claude.com and support.claude.com. Practitioner complaints come from HN threads read in full through the Algolia items API.

Marking: `[fact: key]` = checked in the source `key` (URL list at the bottom). `[inf]` = our inference. `[HN id]` = what one practitioner said, with the item link at the bottom. It is evidence of a complaint, not proof of a claim.

## Bottom line

1. Three ecosystems arrived at the same split: the model emits data, and a fixed renderer owns the components. OpenAI says to separate data tools from render tools. Vercel moved from streamed server components to tool results that the client renders. A2UI lets the agent use only a client-side catalog. [fact: openai-ui] [fact: vercel-migrate] [fact: a2ui-spec] card-skill already has this shape. Keep it.
2. Give the agent a small semantic vocabulary. Layout and theme belong to the renderer. Adaptive Cards gave layout to the author across many hosts. It got fragmentation, per-host layout rules and "lowest common denominator" output. [fact: ac-uam] [fact: teams-cards] [HN 39304673]
3. A stable card id is the join key between the spec and the human's answers. Rewrite the whole board on each turn. Merge the human's state by id in the renderer. Do not ship a patch language in v0. [inf, from L2]
4. Feedback is a snapshot keyed by card id. It gives each open question a status of answered, declined or untouched, and it names the board revision it answers. [inf, from MCP elicitation and AG-UI interrupts]
5. Never require a live connection or an LLM round trip per click. Local actions stay local. The agent reads the result on its next turn. [inf] [HN 46292959] [HN 46299251]

## Comparison

| Protocol | Primitive set | Updates | User action -> agent | Theme owner | Main failure mode |
|---|---|---|---|---|---|
| Adaptive Cards 1.6 | 16 body elements (6 are inputs) + 5 actions | Replace the card (Action.Execute returns a card; `refresh`) | Inputs merge into action `data` by input `id`; `verb` | Host (HostConfig) | Host fragmentation, lowest common denominator |
| Slack Block Kit | 21 block types, max 50 per message | Replace message/view; `hash` guards races | `block_actions`: action_id, block_id, value + `state.values` | Slack | Rigid for custom needs |
| A2UI 0.9.1 | 18 components + 14 functions (basic catalog) | Upsert components by id; data by JSON Pointer | `action` {name, surfaceId, sourceComponentId, context} | Client catalog; v1.0 drops wire theme | Invalid LLM output; wire churn |
| MCP Apps | None: raw HTML in a sandboxed iframe | Host pushes tool input/result; view calls tools | JSON-RPC over postMessage: tools/call, ui/message, ui/update-model-context | Host CSS variables | Bound to JS+iframe; no terminal story |
| OpenAI Apps SDK | None (HTML); optional component library | Same as MCP Apps | callTool, sendFollowUpMessage, setWidgetState | Host | Fixed widget schemas are brittle |
| AG-UI | No UI components; 31 event types | STATE_SNAPSHOT + STATE_DELTA (JSON Patch) | Interrupt, then next run sends `resume[]` | App | Needs a live run; not a UI spec |
| Vercel AI SDK | Was RSC streamUI; now tool parts -> app components | Streamed props, rendered on the client | `addToolOutput`, then resubmit | App | RSC: flicker, no abort, quadratic transfer |
| Claude | Artifacts: free code; Claude Code: AskUserQuestion | Edit or new version | Next chat message; hooks; channels | Claude | No contract for feedback data [inf] |

## Per protocol

### Microsoft Adaptive Cards
- Primitives. Body: TextBlock, RichTextBlock, Image, ImageSet, Media, FactSet, Container, ColumnSet, Table, ActionSet, and six inputs (Text, Number, Date, Time, Toggle, ChoiceSet). Actions: OpenUrl, Submit, ShowCard, ToggleVisibility, Execute. [fact: ac-schema]
- Updates replace the whole card. An Action.Execute reply can carry "an Adaptive Card that the client should display in place of the current one". `refresh` fetches a new card at display time. [fact: ac-uam]
- Actions. Input values join the action `data` ("Initial data that input fields will be combined with"), keyed by input `id`. `verb` names the action. [fact: ac-schema] [fact: ac-uam]
- Theme. HostConfig owns fonts, sizes, colors, spacing and `maxActions` (default 5). [fact: ac-hostconfig] An AC developer: authors get semantic choices only, "monospace" but not "Ubuntu Mono". [HN 31483532]
- Versioning. A card declares `version`. An older client shows `fallbackText`. An element can declare `fallback` ("drop" or a replacement) and `requires`. [fact: ac-schema]
- Failure mode. Microsoft: "different hosts started supporting different action models and this led to fragmentation". Action.Execute was the fix. Its Action.Submit fallback cannot return a new card, so the old path stays degraded. [fact: ac-uam] Teams does not support positive/destructive action styles or `isEnabled` on Action.Submit. [fact: teams-cards]
- Practitioners: the samples are "truly 'lowest common denominator'" [HN 39304673]. "Inflexible for uses not part of its core capabilities", no interactive charts [HN 39297365]. "You need a full blown editor ... Difficult to debug" [HN 31473931]. "So many options", so one author built a small subset [HN 31469150].

### Slack Block Kit
- Primitives. 21 block types now, including agent-oriented `plan` and `task_card`. Max 50 blocks per message and 100 per modal or Home tab. [fact: slack-blocks]
- Updates replace a message or a view. `views.update` takes a `hash` "to protect against possible race conditions" and fails with `hash_conflict`. [fact: slack-views-update] Streamed agent messages send `task_update` chunks keyed by task `id`. [fact: slack-appendstream]
- Ids. `block_id` "should be unique for each message and each iteration of a message. If a message is updated, use a new block_id." [fact: slack-section] But a modal keeps typed input across `views.update` only when `block_id` and `action_id` stay the same. [fact: slack-modals] So identity is a decision: the same id keeps state, a new id resets it. [inf]
- Actions. The `block_actions` payload has `actions[]` (action_id, block_id, value, action_ts), `state.values` keyed by block_id then action_id, and a short-lived `response_url`. [fact: slack-payload]
- Failure mode: "very rigid and frustrating to work with" [HN 46287420].

### Google A2UI
- Status. v0.9.1 is the production release. v1.0 is a release candidate. v0.8 is legacy. The repo moved to a2ui-project/a2ui. [fact: a2ui-readme] v0.8 was the format at the Dec 2025 launch; the launch thread quotes v0.8 syntax. [HN 46286407] [inf]
- Primitives. Basic catalog: Text, Image, Icon, Video, AudioPlayer, Row, Column, List, Card, Tabs, Divider, Modal, Button, CheckBox, TextField, DateTimeInput, ChoicePicker, Slider. Plus 14 functions (validators, formatters, openUrl, and/or/not). The spec expects production apps to define their own catalog. [fact: a2ui-spec]
- Updates. A JSONL stream of four messages: createSurface, updateComponents, updateDataModel, deleteSurface. Components form a flat adjacency list with string ids and one `root`. updateComponents adds or updates by id. updateDataModel upserts the value at a JSON Pointer. [fact: a2ui-spec]
- Actions. A button sends `action` {name, surfaceId, sourceComponentId, timestamp, context}. Inputs bind two-way to a local data model. Typing does not touch the network; the state goes out with the next action. `sendDataModel: true` attaches the full surface data model to every client message. [fact: a2ui-spec]
- LLM fit. v0.9 moved from "Structured Output First" to "Prompt First": the schema goes in the prompt, maps replace key-value arrays, and a validator returns `VALIDATION_FAILED` with a JSON Pointer `path` so the model can fix it. [fact: a2ui-evo09] The Python SDK repairs smart quotes and trailing commas before validation. [fact: a2ui-fixer]
- Theme. The v0.9 surface theme had only primaryColor, iconUrl and agentDisplayName. v1.0 removes `theme` and primaryColor "to separate layout from branding". [fact: a2ui-spec] [fact: a2ui-evo10]
- Security. The agent can only name components from a trusted catalog. It cannot send code. [fact: a2ui-readme]
- Failure modes. Two breaking wire changes (0.8 -> 0.9 -> 1.0) since launch. [fact: a2ui-evo09] [fact: a2ui-evo10] A demo on a small model showed UI "1/3rd of the time" [HN 46288940]. One SSE connection for a session that can span days [HN 46292959]. An LLM round trip per button press [HN 46299251]. "The hard parts weren't the wire format, they were versioning components, debugging state ... and not painting yourself into a corner with a too-clever layout DSL" [HN 46287538].

### MCP Apps (SEP-1865) and MCP-UI
- Shape. A tool sets `_meta.ui.resourceUri` to a predeclared `ui://` HTML resource (`text/html;profile=mcp-app`). The host renders it in a sandboxed iframe. There is no component catalog. [fact: mcp-apps]
- Updates. The host sends tool-input, optional tool-input-partial while arguments stream, tool-result and tool-cancelled. The view can call server tools for fresh data. [fact: mcp-apps]
- Back channel. JSON-RPC over postMessage: `tools/call`; `ui/message` adds a user message; `ui/update-model-context` sets model context for later turns. "Each request overwrites the previous context sent by the View." The host MAY defer it to the next user message. Tools with visibility `["app"]` are callable by the UI and hidden from the model. [fact: mcp-apps]
- Theme. The host passes CSS variables. "Spacing intentionally excluded—layouts break when spacing varies from original design." A full design system was rejected as "too prescriptive". [fact: mcp-apps]
- Lineage. MCP-UI started this and now implements the standard. Its legacy actions were tool, prompt, link, notify, intent. [fact: mcp-ui] Hosts include Claude, ChatGPT, VS Code and Goose. [fact: mcp-apps-readme] [fact: claude-interactive]
- Failure modes. "Very JS+iframe bound, so what about mobile or terminal UIs?" [HN 46023284] Most real app UIs cannot be generated on the fly [HN 46027098]. Skills and CLIs already erode MCP for coding agents [HN 46026838].
- Related. MCP elicitation forms allow only "flat objects with primitive properties". The reply is accept, decline or cancel. [fact: mcp-elicitation]

### OpenAI Apps SDK
- ChatGPT now implements MCP Apps. `window.openai` is a set of optional extensions on top. "ChatGPT is now fully compatible with the MCP Apps spec" (changelog, Feb 2026). [fact: openai-ui] [fact: openai-changelog]
- Guidance worth copying [fact: openai-ui]:
  - "Custom UI is optional. Add it when a plugin use case requires people to inspect, compare, edit, confirm, or navigate structured information. Keep the MCP tools useful without a component."
  - Split data tools from render tools. A template on every call re-renders the iframe too often.
  - Three kinds of state: business data (server, authoritative), UI state (one rendered instance, ephemeral), cross-session state (your storage). Widget state is not "the source of truth". "Avoid localStorage for core state."
  - Selections the model needs go through `ui/update-model-context`. `setWidgetState` splits `modelContent` (the model sees it) from `privateContent` (UI only).
  - "Treat the resource URI as a cache key." Publish a new URI on a breaking change.
- Tool output: "Keep fields concise; the model reads them verbatim." [fact: openai-ref]
- Failure mode. Fixed widget schemas: "If those features aren't supported by the widget's hard-coded schema, you're out of luck" [HN 45494783], "very brittle" [HN 45496227]. (The commenter founded Phind, which sells generated UI.) Chat is weak for choices with many constraints; users want lists they can tweak [HN 45497189].

### AG-UI (CopilotKit)
- Role. "AG-UI is not a generative UI specification — it's a User Interaction protocol." It carries A2UI, MCP-UI and Open-JSON-UI. [fact: agui-genui]
- Events. 31 types in the TypeScript enum: lifecycle, text, tool call, state, activity, reasoning, subagent, raw, custom. [fact: agui-types]
- State. STATE_SNAPSHOT replaces the client state. STATE_DELTA applies RFC 6902 JSON Patch. On mismatch the client may ask for a new snapshot. [fact: agui-events]
- Human input. A run ends with an interrupt outcome. The next run sends `resume[]` with {interruptId, status: resolved|cancelled, payload}. A resume must cover every open interrupt. A denial goes in the payload, not the status. Resumes must be safe to replay. The agent emits a state snapshot before the interrupt. [fact: agui-interrupts]
- Fit: best "if you are building the UI and the Agent at the same time" [HN 46316160].

### Vercel AI SDK: from streamUI to tool parts
- AI SDK RSC (streamUI, createStreamableUI) is experimental. The docs list: no abort through server actions; components "remount on .done(), causing them to flicker"; suspense crashes; "quadratic data transfer"; update issues after a stream closes. "We do not recommend using it for stable production environments." [fact: vercel-migrate]
- Replacement. The model calls tools. Results stream as typed message parts. The client maps parts to its own components. [fact: vercel-genui] A tool that needs the user has no server `execute`. The UI calls `addToolOutput`, and the chat resubmits when all results are present. [fact: vercel-tools]
- Lesson: streaming server-rendered UI was fragile. Stream data and render locally. [inf]

### Anthropic
- Artifacts are free-form code or documents. Claude makes one when content is "significant and self-contained, typically over 15 lines" and likely to be edited or reused. Artifacts can store data (personal or shared, 20 MB per artifact) and can call Claude. [fact: claude-artifacts] There is no component catalog. The human's answer is the next chat message. [inf]
- MCP Apps run in Claude on web, desktop and mobile since Jan 2026. The announcement does not list Claude Code. [fact: claude-interactive]
- Claude Code pieces for a file-based loop:
  - AskUserQuestion asks multiple-choice questions with an "Other" free-text row and a notes field. A question stays open until answered, unless the user sets a timeout. [fact: cc-tools]
  - Hooks. UserPromptSubmit can add `additionalContext`; it cannot replace the prompt. Hook strings are capped at 10,000 characters. Overflow goes to a file that Claude is not told to read. FileChanged fires on any change to a watched file, but it cannot add context; it can only show a terminal `systemMessage`. SessionStart can set `watchPaths`. [fact: cc-hooks]
  - Channels (research preview). A local MCP server pushes `notifications/claude/channel` events. Events queue and arrive together on the next turn. There is no acknowledgement. "An ungated channel is a prompt injection vector." [fact: cc-channels]
  - Output styles change the system prompt. They render nothing. [fact: cc-output-styles]

## Practitioner signal (HN)

- Consistency matters more than novelty. "Generative UI is incompatible with learning" [HN 46179098]. Buttons that move cannot be learned [HN 46179084]. "I cannot reproduce your issue because things on my end look different" [HN 46180211].
- Trust. A generated "confirm purchase" button scares people [HN 46286865]. N renderers x M transports invites bugs [HN 46287868]. A Google PM calls agent-sent HTML+CSS+JS "a code injection attack waiting to happen" [HN 46290249].
- Format. JSON is a poor language for UI authoring [HN 39294872]. Markdown is what LLMs write well [HN 46287420].
- The common ask is small: a "yes" button for yes/no follow-ups [HN 46022095]; Cline and Claude Code multiple choice as the model [HN 46287014] [HN 46287482].
- Reuse. Users want to freeze a generated UI and keep it as a view [HN 47444899].

## Design lessons for card-skill

### L0. When to answer with cards
- Use cards when the human must inspect, compare, rank or decide over several items. OpenAI uses the same test. [fact: openai-ui] Claude's artifact threshold is content that is self-contained and likely to be reused. [fact: claude-artifacts]
- Always print a short plain-text summary in the terminal too. The turn must be useful if the board is never opened. [fact: openai-ui "useful without a component"] [inf]

### L1. The smallest viable primitive set [inf, built from the evidence below]
- Board: `id`, `rev`, `title`, `summary`, `cards[]`, optional `facets` (card fields the human can filter or group on).
- Card: `id`, `title`, `body` (markdown), `fields` (flat key -> value, like FactSet), `tags`, `tone` (neutral | good | warn | bad), optional `ask`.
- Ask: `choice` (options with stable ids; `multi` flag), `text` (free reply), `confirm` (approve / reject; a two-option choice). Every card also takes a free note.
- Renderer features, not agent primitives: filter, sort, reorder, pin, dismiss. Their results become feedback data.
- Left out of v0: rows, columns, containers, colors, fonts, spacing, scripts.
- Evidence. MCP elicitation gets by with flat primitive fields. [fact: mcp-elicitation] Adaptive Cards users built subsets [HN 31469150]. A clever layout DSL is the named trap [HN 46287538]. A2UI v1.0 takes branding off the wire. [fact: a2ui-evo10] MCP Apps leaves spacing with whoever owns the layout, because "layouts break when spacing varies". [fact: mcp-apps] So layout and spacing need one owner; here it is the renderer. [inf] Size: about 3 content shapes and 3 asks, against 21 types in Adaptive Cards and 18 + 14 in the A2UI basic catalog. [fact: ac-schema] [fact: a2ui-spec]
- Robustness. Validate strictly and report errors as {JSON Pointer path, one sentence}, like A2UI. [fact: a2ui-spec] Render unknown kinds or fields as plain text and carry on (Adaptive Cards `fallbackText` and `fallback: "drop"`). [fact: ac-schema] Use LLM-natural shapes: maps not key-value arrays, markdown for prose. [fact: a2ui-evo09] [inf]
- Escape hatch: if a chart is needed later, add one sandboxed `embed` kind. Not in v0. One team passed on Adaptive Cards partly because it had no interactive charts. [HN 39297365] [inf]

### L2. Stable ids: yes. Patch semantics: not on the wire.
- The id is the join key. Each structured protocol returns one with the action: A2UI `sourceComponentId`, Slack `action_id`/`block_id`, AG-UI `interruptId`, Adaptive Cards input `id`. [fact: a2ui-spec] [fact: slack-payload] [fact: agui-interrupts] [fact: ac-uam] Without it, an answer cannot be matched to a card after the agent rewrites the board. [inf]
- The agent rewrites the whole board each turn (snapshot). Patches exist for streaming bandwidth (AG-UI deltas, A2UI incremental updates). [fact: agui-events] [fact: a2ui-spec] card-skill is turn-based and file-based. One rewritten JSON file is easier for an LLM to get right than RFC 6902 operations. [inf] Vercel's incremental UI streaming hit flicker and quadratic transfer. [fact: vercel-migrate]
- The renderer merges human state by id across rewrites. Same card id keeps the answer, the note and the position. A new id starts empty. This is Slack's rule. [fact: slack-section] [fact: slack-modals] Rule for the agent: change the id when the question changes meaning. [inf]
- Every board has a `rev`. Each reply names the `rev` it answers, so the agent can spot stale answers. Slack guards races with `hash`; AG-UI expires interrupts. [fact: slack-views-update] [fact: agui-interrupts] [inf]

### L3. Feedback as data the agent reads on its next turn
- One reply file per board, written by the renderer and read by the agent: a snapshot, overwritten on each save. MCP Apps overwrites model context the same way. A2UI sends the full data model with each action. [fact: mcp-apps] [fact: a2ui-spec] An append-only log is optional, for audit. [inf]
- Shape [inf]: `{board, rev, saved_at, order: [ids], cards: {<id>: {status, value, note, pinned, dismissed}}}`. `status` is answered | declined | untouched. Elicitation (accept / decline / cancel) and AG-UI (resolved / cancelled) both separate "said no" from "did not answer". [fact: mcp-elicitation] [fact: agui-interrupts]
- Keep model-visible state apart from UI-only state (open panels, a filter being typed). OpenAI splits `modelContent` from `privateContent`. [fact: openai-ui]
- Keep it short. The model reads tool output verbatim. A hook can inject at most 10,000 characters. [fact: openai-ref] [fact: cc-hooks] Write one digest line per answered card next to the JSON. [inf]
- Turn boundary. Treat the board like an AG-UI interrupt: the turn ends with the board, the human resolves it, the next turn reads the reply. [fact: agui-interrupts] [inf]
- Delivery ladder [inf, to test]: (a) a tiny local server writes the reply file on "Send". (b) A page on file:// cannot write to disk, so it offers "Copy reply" (compact text to paste into the terminal) and "Download reply.json". (c) A UserPromptSubmit hook injects the digest automatically. [fact: cc-hooks] FileChanged can only notify. [fact: cc-hooks] Channels can push, but are a research preview. [fact: cc-channels]
- Filter, reorder and typing stay local and instant. Nothing reaches the agent until "Send". A2UI does the same. [fact: a2ui-spec] Drafts may sit in localStorage, never as the source of truth. [fact: openai-ui]

### L4. Theming
- The renderer owns layout and theme. Set one theme per user or project as CSS custom properties, like MCP Apps. [fact: mcp-apps] The agent gives semantic hints only (`tone`, maybe `emphasis`), like HostConfig semantics. [fact: ac-hostconfig] [HN 31483532] A2UI v1.0 took the theme off the wire. [fact: a2ui-evo10]
- card-skill has one renderer. The Adaptive Cards "lowest common denominator" problem came from many hosts, so it does not apply here. Spend the effort on one good renderer. [inf]

### L5. Three mistakes to avoid
1. Giving the agent a layout and styling DSL. It brings verbosity, host breakage, and boards that differ every turn. Evidence: [HN 46287538] [HN 39304673] [HN 46179098] [fact: ac-uam] [fact: a2ui-evo10].
2. Making the page the source of truth. Answers kept only in the page are lost on re-render. Answers not tied to a card id and a `rev` cannot be attributed. An unanswered card must not look like a declined one. Evidence: [fact: openai-ui] [fact: agui-interrupts] [fact: mcp-elicitation] [fact: slack-modals].
3. Needing a live connection or an LLM round trip for feedback to count. Sessions span days. CLI agents act only on their turn. Streamed UI broke at Vercel. Evidence: [HN 46292959] [HN 46299251] [fact: vercel-migrate] [fact: cc-channels].

## Open questions to check locally
- Do people accept "Copy reply" on file://, or is the local server the real default? Test with a user.
- With several boards in one session, how does a hook find the right reply file?
- How large is the digest for a 50-card board, against the 10,000-character hook cap?
- How often does the agent write a valid board on the first try? A2UI built an eval harness for this question. [fact: a2ui-eval]

## Sources

- ac-schema: https://github.com/microsoft/AdaptiveCards/blob/main/schemas/1.6.0/adaptive-card.json
- ac-uam: https://learn.microsoft.com/en-us/adaptive-cards/authoring-cards/universal-action-model
- ac-hostconfig: https://learn.microsoft.com/en-us/adaptive-cards/rendering-cards/host-config
- teams-cards: https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference
- slack-blocks: https://docs.slack.dev/reference/block-kit/blocks
- slack-section: https://docs.slack.dev/reference/block-kit/blocks/section-block
- slack-modals: https://docs.slack.dev/surfaces/modals
- slack-views-update: https://docs.slack.dev/reference/methods/views.update
- slack-payload: https://docs.slack.dev/reference/interaction-payloads/block_actions-payload
- slack-appendstream: https://docs.slack.dev/reference/methods/chat.appendStream
- a2ui-readme: https://github.com/a2ui-project/a2ui/blob/main/README.md
- a2ui-spec: https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9_1/docs/a2ui_protocol.md
- a2ui-evo09: https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/docs/evolution_guide.md
- a2ui-evo10: https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/docs/evolution_guide.md
- a2ui-fixer: https://github.com/a2ui-project/a2ui/blob/main/python/a2ui_agent/src/a2ui/parser/payload_fixer.py
- a2ui-eval: https://github.com/a2ui-project/a2ui/blob/main/eval/DESIGN.md
- mcp-apps: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- mcp-apps-readme: https://github.com/modelcontextprotocol/ext-apps/blob/main/README.md
- mcp-ui: https://github.com/MCP-UI-Org/mcp-ui
- mcp-elicitation: https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
- openai-ui: https://developers.openai.com/plugins/build/chatgpt-ui
- openai-ref: https://developers.openai.com/plugins/reference
- openai-changelog: https://developers.openai.com/plugins/changelog
- agui-genui: https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/generative-ui-specs.mdx
- agui-types: https://github.com/ag-ui-protocol/ag-ui/blob/main/sdks/typescript/packages/core/src/generated/types.ts
- agui-events: https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/events.mdx
- agui-interrupts: https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/interrupts.mdx
- vercel-migrate: https://ai-sdk.dev/docs/ai-sdk-rsc/migrating-to-ui
- vercel-genui: https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces
- vercel-tools: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage
- claude-artifacts: https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them
- claude-interactive: https://claude.com/blog/interactive-tools-in-claude
- cc-tools: https://code.claude.com/docs/en/tools-reference
- cc-hooks: https://code.claude.com/docs/en/hooks
- cc-channels: https://code.claude.com/docs/en/channels-reference
- cc-output-styles: https://code.claude.com/docs/en/output-styles

HN threads: Adaptive Cards 2022 https://news.ycombinator.com/item?id=31449834, 2024 https://news.ycombinator.com/item?id=39294372; A2UI https://news.ycombinator.com/item?id=46286407; MCP Apps https://news.ycombinator.com/item?id=46020502; Apps SDK https://news.ycombinator.com/item?id=45494558; "What Is Generative UI?" https://news.ycombinator.com/item?id=46138473; Markdown as generative UI protocol https://news.ycombinator.com/item?id=47439300.

HN comments cited (each is https://news.ycombinator.com/item?id=ID): 31469150, 31473931, 31483532, 39294872, 39297365, 39304673, 45494783, 45496227, 45497189, 46022095, 46023284, 46026838, 46027098, 46179084, 46179098, 46180211, 46286865, 46287014, 46287420, 46287482, 46287538, 46287868, 46288940, 46290249, 46292959, 46299251, 46316160, 47444899.
