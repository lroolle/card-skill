# Super goal

Build card-skill.

# Resume here

Read `docs/STATUS.md` first: what works, what is unverified, what is next.
Then `docs/DECISIONS.md` before you change behavior; supersede an entry, do not rewrite it.
UI work reads `DESIGN.md` and `TASTE.md`.
The skill is `skill/`; its policy is `skill/SKILL.md`; the format is `skill/reference/format.md` (boards are Org: `board.org`).
The agent never edits `skill/runtime/` to style one board: meaning decides looks.
Test: `npm test`. A change to the format updates `format.md`, a template, and a test together.

# Output

An explanation for a person is a discardable HTML page the eye can check.
Sentences stay near ASD-STE100: one fact each, plain verbs.
Use a diagram when the structure is the claim. Use video only when someone will watch it.
A polished page at the wrong altitude is a failed page.

# Loop

Code we keep: one change, approaches before code, a test, a commit.
Code we throw away: label it throwaway.
The human reads and decides. The agent files, compiles, and shows the work.
