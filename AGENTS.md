<!-- deva:container-context -->
# Container Environment (deva)

You are inside a Docker container running Ubuntu Linux 24.04 LTS
(Noble Numbat), not on the host machine. The workspace is a
bind-mount from the host at the same absolute path, but the
runtime is Linux.

- This is Linux. Host-only tools (open, pbcopy, pbpaste, sw_vers,
  diskutil, defaults, launchctl) are not available.
- No display server. Browsers and GUI tools will not work.
- Hard links (`ln` without -s) fail across mount boundaries.
  Use `cp` or relative symbolic links (`ln -sr`).
- Prefer relative paths for project-internal references.
  Absolute paths work here but are container-specific.
- $HOME is /home/deva (not /root). sudo works without password.
- Pre-installed: Node.js, Python (use `uv`, not pip), Go, git,
  gh, make, curl. pip is NOT in PATH.
- Docker is available (socket mounted from host).
- System packages and build caches persist across sessions.
- Container details are in DEVA_* environment variables.
<!-- /deva:container-context -->

# Super goal

Build card-skill.

# Resume here

Read `docs/STATUS.md` first: what works, what is unverified, what is next.
Then `docs/DECISIONS.md` before you change behavior; supersede an entry, do not rewrite it.
UI work reads `DESIGN.md` and `TASTE.md`.
The skill is `skill/`; its policy is `skill/SKILL.md`; the format is `skill/reference/format.md`.
The agent never edits `skill/runtime/` to style one board: meaning decides looks.
Test: `npm test`. A change to the format updates `format.md`, a template, and a test together.

# Vault

`vault/` is the record of Karpathy on agent output and the human loop.
Read `vault/index.md` first. `vault/sources/` is verbatim: add a file, do not rewrite one.
A note cites a source, or the claim is marked `ours`.

# Output

An explanation for a person is a discardable HTML page the eye can check.
Sentences stay near ASD-STE100: one fact each, plain verbs.
Use a diagram when the structure is the claim. Use video only when someone will watch it.
A polished page at the wrong altitude is a failed page.

# Loop

Code we keep: one change, approaches before code, a test, a commit.
Code we throw away: label it throwaway.
The human reads and decides. The agent files, compiles, and shows the work.
