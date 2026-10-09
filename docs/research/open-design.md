# open-design: research note for card-skill

Repo: https://github.com/nexu-io/open-design
Snapshot: shallow clone of `main`, commit `426386581b70`, version `0.23.1`, read 2026-10-08.
Read from a scratch clone. Paths below are relative to the repo root.
License: Apache-2.0 (`LICENSE`; `package.json` `"license": "Apache-2.0"`). Bundled content keeps its own licenses: 58 `LICENSE*` files sit under `skills/`, `design-templates/`, `design-systems/`, `plugins/` (e.g. `design-templates/html-ppt/` is MIT). Brand packages are "aesthetic inspirations, not official assets" (`design-systems/README.md`).

Marking: **[fact]** = seen in a file (path given). **[inf]** = our inference or judgment.
Not done: we did not run the app. No UI was observed. All claims come from reading files.

## Verdict

- open-design is a heavy desktop/web product. Its core loop is "agent writes a whole HTML file; host previews it; human comments; agent rewrites". [inf]
- Its best ideas are contracts, not code: a layered token schema built for paste-into-one-file artifacts, a fixed runtime the agent must not regenerate, stable element ids for feedback, a logic-less data template for live artifacts, and stored answers that are not asked twice. [inf]
- Its main weakness is drift. It has two or three implementations of most things: prompt stacks, token vocabularies, clarification channels, and validators. Several validators are not wired in. [fact, see section 9]
- For card-skill: take the contracts. Invert the generation model: the agent writes data, and a fixed renderer owns the HTML. open-design's own GenUI rule says the same thing: "agent/plugin output is data; OD owns the renderer" (`docs/plugins-spec.md`). [inf]

## 1. Problem and audience

- [fact] "OpenDesign is a collaborative design agent workspace. Start with a brief, then use your coding agent ... to create a prototype that follows your design system." (`README.md`)
- [fact] It positions itself as "the open-source Claude Design alternative". It ships no model: "The `claude` / `codex` / `cursor-agent` ... already on your `PATH` are the design engine."
- [fact] Outputs: web/mobile prototypes, decks, live dashboards, images, video (HyperFrames HTML->MP4), audio. Exports: HTML, PDF, PPTX, ZIP, Markdown, MP4.
- [fact] Audience in README examples: "A PM submits a brief", designers lock the direction, engineers take the HTML into Cursor/Codex/Claude Code.

## 2. Repo map, build, run

- [fact] pnpm monorepo, Node ~24 (`package.json`, `pnpm-workspace.yaml`): `apps/` (daemon, web, desktop, packaged, closure), `packages/` (contracts, components, plugin-runtime, sidecar, ...), `tools/`, `shells/`, `e2e/`.
- [fact] Content trees: `skills/` (165 dirs), `design-templates/` (116), `design-systems/` (151 packages + `_schema/`), `craft/` (12 rulebooks), `plugins/_official/` (13 atoms, 13 scenarios, 143 design-system wrappers, 183 examples, image/video templates).
- [fact] Stack (README "Architecture"): Next.js 16 web, Express + `better-sqlite3` daemon, Electron desktop. The daemon spawns the agent CLI with the project directory as cwd.
- [fact] Run from source: `pnpm install` then `pnpm tools-dev run web`. Agent hookup: `od mcp install <agent>`. 27 runtime definitions under `apps/daemon/src/runtimes/defs/`.
- [fact, measured] TypeScript size: ~298k lines in `apps/daemon/src`, ~445k in `apps/web/src`, ~74k in `packages/`. There are 22 nested `AGENTS.md` files.
- [fact] Pace: `CHANGELOG.md` dates 0.4.0 at 2026-05-05; the package is now 0.23.1.

## 3. Core loop

- [fact] README: `brief -> plugin -> direction -> design system -> artifact -> handoff -> memory`.
- [fact] Default pipeline (`plugins/_official/scenarios/od-default/open-design.json`): stage `discovery` (discovery-question-form) -> `plan` (direction-picker, todo-write) -> `generate` (file-write, media-*, live-artifact) -> `critique` (critique-theater, `"repeat": true`, `"until": "critique.score>=4 || iterations>=3"`).
- [fact] Who generates what: the daemon composes the prompt. The agent CLI writes files into the project cwd. The preview iframe follows the files. BYOK runs with no file tools return one `<artifact>` block (`README.md` workflow step 3).
- [fact] Variations are prompt guidance only: "Default to 2-3 differentiated directions on the same brief ... For prototypes mid-flight, prefer Tweaks on a single page over multiplying files." (`apps/daemon/src/prompts/discovery.ts`). We found no side-by-side variant generator or compare view. [inf: not found is not proof]
- [fact] How the human iterates: answer a `<question-form>`, pin comments to elements, edit text or styles in place, steer a running turn (`POST /api/runs/:id/steer`, `AGENTS.md`), restore a file version. See section 8.

## 4. Design system: tokens, themes, directions

Package shape [fact] (`design-systems/README.md`): every package has `manifest.json` (`"schemaVersion": "od-design-system-project/v1"`), `DESIGN.md` (prose for agents), and `tokens.css` (compiled tokens). Optional: `USAGE.md` (read order), `components.html` (fixture), `components.manifest.json` (derived index), `design-tokens.json` and `tailwind-v4.css` (derived), `preview/`, `source/` (import evidence).

Token schema [fact] (`packages/contracts/src/design-systems/token-schema.ts`, 56 tokens):
- Groups: surfaces (`--bg --surface --surface-warm`), text ramp (`--fg --fg-2 --muted --meta`), borders, `--accent` + on/hover/active, status (`--success --warn --danger`), fonts (display/body/mono), type scale `--text-xs..4xl`, leading/tracking, `--space-1..12`, section rhythm, radius, elevation (`--elev-flat/ring/raised`), `--focus-ring`, motion (`--motion-fast --motion-base --ease-standard`), container.
- Layers by "who decides the value" and "what happens if omitted": A1-identity (brand, required), A1-structure (brand, required), A2 (required, has a fallback in `_schema/defaults.css`), B-slot (required, may alias a sibling), C-extension (per-brand allowlist).
- Why every token is required: "Artifacts are generated by agents pasting one brand's :root block into a single <style>. There is no runtime cascade from a global defaults stylesheet."
- B-slot aliasing: a thin brand writes `--fg-2: var(--fg);`. A rich brand binds a real value. Components can always reference the richer tier.
- Promotion rule (`design-systems/_schema/AGENTS.md`): a C-extension becomes a B-slot "when ≥2 brands declare a token of the same name".
- Enforcement: `scripts/check-tokens-fixture-sync.ts` ("Design system A2 required tokens", "B-slot required tokens"), plus manifest and derived-file parity guards.

How consistency is kept [fact]:
- `tokens.css` header: "Agents are expected to paste the `:root { … }` block verbatim into the first `<style>` of every artifact ... This file pre-translates the brand once, so agents copy structure instead of inventing it."
- Component fixture: "if the agent paste-replaces the :root block and reuses the component selectors below verbatim, the artifact passes lint" (`design-systems/default/components.manifest.json`).
- `DESIGN.md` ends with an "Agent Prompt Guide": "Do not invent hex values outside this palette." (`design-systems/default/DESIGN.md`).
- Craft rules are a separate axis: brand-agnostic rulebooks (`craft/typography.md`, `color.md`, `anti-ai-slop.md`, ...). A skill opts in with `od.craft.requires: [...]`, and only those files are injected (`craft/README.md`). "Brand tokens in DESIGN.md win on conflict" (`docs/skills-protocol.md`).
- Brand engine (`apps/daemon/src/brands/engine/README.md`): a ~20-field seed is expanded by `deriveTokens(seed, "default" | "dark" | "compact")`. "Variants (light / dark / compact) are the *same* seed run through a different algorithm — never hand-authored."

Directions [fact]:
- Five built-in directions in `apps/daemon/src/prompts/directions.ts` (`DESIGN_DIRECTIONS`): editorial-monocle, modern-minimal, human-approachable, tech-utility, brutalist-experimental. Fields: `id, label, mood, references[], displayFont, bodyFont, palette{bg,surface,fg,muted,border,accent}` (OKLch), `posture[]`.
- Used only when no design system is active. The agent picks: "Infer the best match from the brief ... then bind it without asking". On file-capable runs the prompt carries only an id index; the full spec is pulled with `od tools directions --id <id>`.
- The visual picker is dormant: `apps/web/src/runtime/visual-style-catalog.ts` records a 2026-09-07 product decision, "不问了" ("stop asking"). The render code was kept. README still says "Pick from 5 curated directions" (stale).

Incoherence [fact]: there are three token vocabularies. The design-system schema uses `--fg`, `--success`. html-ppt themes use `--text-1`, `--good`, `--bad` (`design-templates/html-ppt/references/themes.md`). The brand engine uses `--brand-color-primary` (`apps/daemon/src/brands/engine/build.ts`). Some "taste" templates also hard-code hex values (`web-prototype-taste-brutalist/SKILL.md`: "hazard red `#E61919`").

## 5. Templates and variations

- [fact] A template is a folder with `SKILL.md` (Claude Code skill format plus an `od:` block: `mode`, `scenario`, `preview`, `design_system.requires`, `craft.requires`, `critique.policy`), an `example.html`, and optional `assets/`, `references/` (`docs/skills-protocol.md`, `design-templates/AGENTS.md`).
- [fact] Selection: the user picks a template, or the agent matches `triggers`. The template id becomes the project `skillId`, and its body is injected as `## Active skill`. Templates are leaves: "The current registries treat them as leaf-level inputs" (`docs/skills-protocol.md` §10).
- [fact] Most templates are freeform. The agent reads prose instructions and writes a whole HTML file (e.g. `design-templates/dashboard/SKILL.md`: "Write one self-contained HTML document").
- [fact] There are three data-ish exceptions:
  - `template` mode: "copy `assets/template/` to artifact dir -> replace content placeholders".
  - html-ppt: 31 layout files (`templates/single-page/*.html`) times 36 theme CSS files that override one variable set. Themes switch by swapping `<link id="theme-link">`. Each layout has a "purpose" row in `references/layouts.md`.
  - Live artifacts: `template.html` + `data.json`, with `{{data.x}}` interpolation and `data-od-repeat="item in data.items"`. `<script>`, raw interpolation, and `javascript:` URLs are rejected (`apps/daemon/src/live-artifacts/render.ts`).
- [fact] Variants of one template are separate folders: `web-prototype-taste-{brutalist,editorial,soft}`, `wireframe-{greybox,sketch,annotated,mobile-flow}`, 50+ `html-ppt-*`. A template can also ship `examples/<key>.html`, shown as `<parent>:<key>` cards.
- [fact] Tweaks: the agent embeds a floating panel that sets CSS variables and saves them to `localStorage` (`design-templates/tweaks/SKILL.md`, `assets/wrap.html`). The README roadmap says "AI-emitted tweaks panel UX — not yet implemented".
- [fact] Prompt drift. `prompts/official-system.ts`: "For prototypes, add a small floating 'Tweaks' panel". `prompts/discovery.ts`: "Product prototypes: do **not** include floating Tweaks panels". `dashboard/SKILL.md`: "Generate specific, plausible metric names and values". `craft/anti-ai-slop.md`: "Invented metrics" is a cardinal sin.

## 6. Widgets and components

- [fact] Prototypes have no shared runtime widget library. Each design system ships its own `components.html` fixture and a derived index (default fixture: 50 selectors, 25 classes; buttons, inputs, cards, links).
- [fact] `packages/components` holds the app's own React primitives (button, dialog, form-controls). These are not used inside artifacts.
- [fact] "Atoms" (`plugins/_official/atoms/`, `docs/atoms.md`) are pipeline capabilities: `discovery-question-form`, `direction-picker`, `todo-write`, `critique-theater`, `patch-edit`, `diff-review`, `handoff`, and others. Each is a `SKILL.md` prompt fragment plus a daemon worker. The README calls atoms "Reusable UI fragments (buttons, heroes, KPI cards)", which does not match.
- [fact] Decks get a fixed runtime. `packages/contracts/src/prompts/deck-framework.ts`: "stop regenerating the scale-to-fit JS, the keyboard handler ... every regeneration has subtly different bugs". The agent copies `DECK_SKELETON_HTML` and fills slides only. html-ppt ships a shared `assets/runtime.js` (960 lines) and `base.css`.
- [fact] GenUI surfaces (`docs/plugins-spec.md` §10.3): four built-in kinds, `form | choice | confirmation | oauth-prompt`. A plugin declares each surface with a JSON Schema. "Surface kinds not declared in the manifest cannot be raised at runtime."

## 7. Agent integration

Prompt composition [fact] (`apps/daemon/src/prompts/system.ts` `composeSystemPrompt`; order in `docs/skills-protocol.md` §5):
1. Head: role, priorities, clarify/design phases. Then mode and locale overrides.
2. Discovery and direction library (when no design system is active). Memory. Custom instructions.
3. Design system: `USAGE.md` -> `DESIGN.md` verbatim ("Do not invent tokens outside this palette") -> `tokens.css` ("Paste the unscoped `:root { ...` block") -> component index -> index of rich files the agent can pull on demand.
4. `## Active craft references` -> `## Active skill` ("Follow this skill's workflow exactly") -> plugin inputs ("Treat these as authoritative answers… do not re-ask") -> project metadata -> deck framework, `<question-form>` rules, output rules.
5. Per-turn markers (`<od-done>`, `<od-next>`, `<od-focus>`) go in the user turn, not the system prompt: "the per-turn slice keeps the upstream prompt-cache prefix byte-stable" (`apps/daemon/src/server.ts`).

Several prompt implementations exist [fact]: legacy "slim" (default), legacy "classic" (`OD_PROMPT_CORE=classic`), a BYOK copy in `packages/contracts/src/prompts/system.ts`, and "OD Next" (`plugins/_official/scenarios/od-next-strategy/`). `docs/prompt-composition.md`: "The two sides share no composition floor: a rule added to one holds only for the runs that take that side." The doc says divergence shows up "as an **intermittent** bug".

Read/write surfaces [fact]:
- MCP stdio tools (`apps/daemon/src/mcp.ts`): `list_projects, get_project, get_active_context, list_files, get_file, search_files, write_file, create_artifact, delete_file, collect_brief, confirm_brief, start_run, get_run, ...`. `get_active_context` returns the project and file the user has open; it "expires ~5 minutes after the last user interaction".
- Brief card over MCP (`apps/daemon/src/mcp-brief.ts`): a draft with `nonce`, `expiresAt` (15 min TTL), and `confirmationAnswersDigest`. `confirm_brief` rejects a wrong nonce.
- Artifact manifest sidecar `<file>.artifact.json` (`apps/daemon/src/artifacts/manifest.ts`): `version, kind, title, entry, renderer, status, exports, sourceSkillId, designSystemId, metadata` (metadata capped at 16 KB). The host writes it, not the agent.
- CLI: `od project list --json`, `od files read`, `od plugin apply ... --input k=v`, `od ui respond <runId> <surface-id> --value-json` for headless answers.

Clarification [fact] (`AGENTS.md` "Asking the user questions"): "There is exactly one mechanism ...: the `<question-form>` markdown artifact." The model emits `<question-form id=...>{JSON}</question-form>` inline and ends the turn. Rules: at most 5 questions, with defaults. 16 input types (radio, checkbox, select, text, range, color, file, ...). Answers return as the next user message (`[form answers — <id>]` + `- label: value [value: v]` lines). The daemon then adds an override: "submitted form answers are authoritative", with "Forbidden output for this turn: - Re-emitting the answered `discovery` ... form" (`apps/daemon/src/server.ts`). Note that the plugin spec's GenUI surfaces are a second clarification design.

Validation: enforced vs advisory [fact]:
- `apps/daemon/src/lint-artifact.ts` has P0 rules (ai-default-indigo, trust-gradient, emoji-icon, left-accent-card, invented-metric, filler-copy, ...) and a P2 rule for sections that lack `data-od-id`. It is exposed at `POST /api/artifacts/lint` and `od lint`. But the web `saveArtifact()` has no callers, and no prompt tells the agent to run `od lint`. `craft/anti-ai-slop.md` still calls the rules "auto-enforced".
- The checklist and 5-dimension self-critique (philosophy, hierarchy, execution, specificity, restraint; "fix any < 3/5") are prompt-only.
- Critique Theater (5 reviewers, composite >= 8.0, up to 3 rounds; `docs/critique-theater.md`) "Defaults to `M0` (dark-launch)" (`apps/daemon/src/critique/rollout.ts`).
- Enforced but non-blocking: the deliverable syntax finalizer (babel/cheerio, up to 8 auto-patches), `validateRunDeliverable` (entry missing, untouched, wrong type), and `memory-verify.ts` scorecards against stored rules.
- Enforced and blocking: the BYOK pre-write check rejects `<artifact>` bodies that do not start with `<!doctype html>` or are under 64 chars (`apps/web/src/artifacts/validate.ts`).

## 8. Human feedback back to the agent

- [fact] Comments are anchored to elements by `[data-od-id]`. The iframe bridge (`apps/web/src/runtime/srcdoc.ts`) posts `od:comment-target(s)` to the host. Comments live in the SQLite table `preview_comments` with status `open|attached|applying|needs_review|resolved|failed`.
- [fact] Attached comments are injected into the next user prompt as `<attached-preview-comments>`, with file, selector, label, position, currentText, htmlHint, computed style, and the note. The block opens with: "Hard scope: change ONLY the elements identified below by selector / position / pod members." (`apps/daemon/src/runtimes/chat-prompt-inputs.ts`).
- [fact] Inspect and manual edits patch the file directly and save a `manual` version (`FileViewer.tsx`). [inf] The agent learns about them only by re-reading the file. No prompt line says "the user edited this".
- [fact] Tweak values stay in browser `localStorage`. Thumbs up/down go to `messages.feedback_json` and Langfuse. [inf] Neither reaches the agent.
- [fact] Comments are also distilled into memory: "Auto-distill any inline preview feedback ... into durable feedback + rule memory" (`server.ts`, `memory-llm.ts`).

## 9. State and persistence

- [fact] Project files are plain files under a managed project root, or under `metadata.baseDir` for imported folders (`apps/daemon/src/projects.ts`). Other state is in one SQLite file, `app.sqlite` (WAL), with tables created in code (`apps/daemon/src/db.ts`): `projects, conversations, messages, agent_sessions, preview_comments, tabs, deployments, templates, routines, ...`.
- [fact] Versions are per file on disk: `<project>/.file-versions/<sha256(name)[:24]>/manifest.json` plus full-copy content files. Fields include `version, source ('ai'|'manual'|'restore'), prompt, parentVersionId, contentDigest` (`apps/daemon/src/project-file-versions.ts`). A restore appends a new version, so history only grows. There is no git.
- [fact] Chat cards are frozen per turn in `chat_artifact_snapshots` ("Immutable message evidence"). Clicking a card opens the latest file.
- [fact] Live artifacts are files: `.live-artifacts/<id>/{artifact.json, template.html, data.json, provenance.json, refreshes.jsonl, snapshots/<refreshId>/}` (`apps/daemon/src/live-artifacts/store.ts`). "Failed attempts are summarized in refreshes.jsonl only".
- [fact] Session resume: `agent_sessions` stores `session_id, model, cwd, last_message_id, stable_prompt_hash`. Claude runs with `--resume <id>`. The resume is rejected on `model_changed`, `cwd_changed`, `missing_cursor`, or `conversation_advanced`. Then the daemon replays the full transcript, which it rebuilds from SQLite messages. Old `<artifact>` HTML in the transcript is cut down to a one-line summary (`agent-session-resume.ts`, `apps/web/src/providers/daemon.ts`).
- [fact] Memory is markdown files (`memory/MEMORY.md` index + `<type>_<slug>.md`), injected each run. "removing a `- [Name](id.md)` line disables that fact" (`apps/daemon/src/memory.ts`).
- [fact] GenUI answers persist per tier (`run | conversation | project`) in a `genui_surfaces` table with a `schema_digest` that "invalidates on schema drift". Answers are reused instead of re-asked (`docs/plugins-spec.md` §10.3.3).

## 10. Ideas worth stealing (ideas, not code)

1. **Paste-safe token contract.** A single self-contained HTML file has no cascade. So every token a component references must exist in the one `:root`. Use required slots plus `var(--sibling)` aliases for thin themes. This fits card-skill exactly. [inf]
2. **Fixed runtime, agent fills content.** The deck-framework lesson ("every regeneration has subtly different bugs") applies to our board: filter, reorder, answer, and export must be checked-in code, never agent output. [inf]
3. **Logic-less data template.** The live-artifact model (`template.html` + `data.json`, `{{data.x}}`, `data-od-repeat`, no scripts) is close to "cards.json -> board". [inf]
4. **Stable ids as feedback anchors.** `data-od-id` on every addressable block. Lint the ids. Inject feedback with a hard scope ("change ONLY the elements identified below"). [fact pattern, inf use]
5. **Answers are state, not chat.** Store each answer with its question id, a schema digest, and a scope tier. Do not ask again while the digest matches. Use a nonce + TTL to reject stale confirmations (`mcp-brief.ts`). [inf]
6. **Closed convergence vocabulary.** The `until` grammar allows only `critique.score`, `iterations`, `user.confirmed`, `preview.ok`, `build.passing`, `tests.passing`. "The evaluator is deliberately closed and is not arbitrary JavaScript." (`docs/atoms.md`) [fact]
7. **Brand vs craft split.** Keep small per-topic rulebooks that are opt-in per template. Mark which rules are machine-checked ("(guidance, not auto-checked)"). [fact pattern]
8. **Derived variants.** Make light/dark/compact a function of one seed, not hand-authored files. [fact pattern]
9. **Index plus pull.** Put an id index in the prompt and fetch the full spec on demand (`od tools directions --id`, the rich-file pull index). This keeps context small across sessions. [fact pattern]
10. **Catalog with "when to use".** html-ppt's layout and theme tables give one purpose line per entry. The agent selects from data, not from vibes. [fact pattern]
11. **Append-only version history** with `source: ai|manual|restore`, plus resume invalidation reasons that fall back to a full replay. [fact pattern]

## 11. Weight to avoid

- Daemon + Next.js + Electron + SQLite + MCP + 27 agent adapters + plugin marketplace + 151 brand clones: ~800k lines of TS. card-skill needs a skill, a renderer, and files. [fact size, inf judgment]
- Four content planes (skills, design templates, design systems, plugins) plus atoms and craft. Their boundaries need long docs to explain (`docs/skills-protocol.md`, `design-templates/AGENTS.md`). [fact]
- Several parallel prompt stacks that "share no composition floor". [fact]
- Feedback state in SQLite and a hidden data dir. A new agent session cannot read it as files. Tweak values never leave `localStorage`. [fact + inf]
- Agent-authored full HTML on every turn, then lint, critique, and finalizer passes to recover consistency. Most of those passes are advisory or off. [fact]
- Brand clones of real companies: legal and maintenance load, low value for an internal card board. [inf]

## 12. What card-skill should do differently

- **Data in, fixed HTML out.** The agent writes `cards.json` (or markdown with frontmatter), validated by one JSON Schema. A checked-in renderer builds the self-contained board. The agent never writes card CSS or JS. [inf]
- **One feedback channel, in files.** Every human action (answer, reorder, filter state that matters, comment) goes to an append-only file next to the board, e.g. `feedback.jsonl`. Each line carries card id, board revision, and schema digest. The next session reads that file. No DB. [inf]
- **One clarification mechanism.** A question is a card kind with a typed answer widget. Do not add a second one. open-design has `<question-form>`, GenUI surfaces, and the MCP brief card. [fact + inf]
- **One small token vocabulary.** Use ~25-30 tokens: surfaces, text ramp, accent, status, type scale, space, radius, motion. Themes are token files. Variants are derived. Copy the A1/A2/B-slot idea, not the 56-token list. [inf]
- **A closed widget set.** A few card kinds times a few answer widgets (choice, multi-choice, rank, text, confirm). Each has a stable `data-*` id. New kinds go through the schema, not freeform HTML. [inf]
- **Deterministic self-check.** Schema validation plus a renderer lint that blocks on failure and runs in the skill. Skip LLM critique loops by default. open-design's advisory checks show how unwired checks rot. [inf]
- **One source per contract.** Docs, prompt text, and validator read from the same schema file. Their README, prompts, and templates contradict each other where this is missing (directions, Tweaks, atoms, invented metrics). [fact + inf]

## 13. Open questions for us

- Does card-skill need live data refresh (open-design's live artifacts), or are boards one-shot per agent turn?
- Is a board the unit of versioning, or is a card? open-design versions per file.
- Should answers persist at board scope only, or also at project scope (open-design's `persist: project`)?
