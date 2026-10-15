# make install: copy skill/ into each skills folder, as a real copy, never a link.
#
#   make install                              HEAD into ~/.claude/skills and ~/.agents/skills
#   make install REF=v0.2.0                   a tag or a commit instead of HEAD
#   make install DESTS=$HOME/.codex/skills    other skills folders, separated by spaces
#
# The copy comes from a commit, not from the working tree, so an edit in
# progress never reaches the agents that use the skill. Without git (a
# downloaded archive) the copy comes from skill/ as it is.
#
# Each copy is built and run beside the old one, then swapped in whole: a
# failed install leaves the old copy in place, and a file deleted from skill/
# does not stay behind. .installed in the copy names the commit and the time.
#
# A skills folder is skipped when the folder above it (~/.claude, ~/.agents)
# does not exist: that agent is not on this machine.

DESTS ?= $(HOME)/.claude/skills $(HOME)/.agents/skills
REF ?= HEAD
NAME := card-skill

.PHONY: install
install:
	@set -e; \
	if git rev-parse --git-dir >/dev/null 2>&1; then \
	  rev=$$(git rev-parse --short "$(REF)^{commit}"); \
	  if [ -n "$$(git status --porcelain -- skill)" ] || ! git diff --quiet "$$rev" -- skill; then \
	    echo "note: skill/ differs from $(REF) ($$rev); the difference is not installed"; fi; \
	else \
	  rev="working tree"; \
	fi; \
	for d in $(DESTS); do \
	  home=$$(dirname "$$d"); \
	  if [ ! -d "$$home" ]; then echo "skip $$d: no $$home"; continue; fi; \
	  mkdir -p "$$d"; \
	  tmp=$$(mktemp -d "$$home/.$(NAME)-install.XXXXXX"); \
	  trap 'rm -rf "$$tmp" "$$tmp.old"' EXIT; \
	  if [ "$$rev" = "working tree" ]; then cp -R skill/. "$$tmp"; \
	  else git archive "$$rev" skill | tar -x -C "$$tmp" --strip-components=1; fi; \
	  node "$$tmp/bin/cards.mjs" --version >/dev/null || { echo "error: the new copy does not run (node bin/cards.mjs --version); $$d/$(NAME) is unchanged"; exit 1; }; \
	  printf '%s %s\n' "$$rev" "$$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$$tmp/.installed"; \
	  chmod 755 "$$tmp"; \
	  had=; if [ -e "$$d/$(NAME)" ] || [ -L "$$d/$(NAME)" ]; then mv "$$d/$(NAME)" "$$tmp.old"; had=1; fi; \
	  mv "$$tmp" "$$d/$(NAME)" || { [ -z "$$had" ] || mv "$$tmp.old" "$$d/$(NAME)"; exit 1; }; \
	  rm -rf "$$tmp.old"; \
	  echo "installed $(NAME) $$rev -> $$d/$(NAME)"; \
	done
