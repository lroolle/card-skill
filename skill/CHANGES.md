# What changed

For the agent that writes boards. Newest first. Each line says what is
different for you, not how it was built. `cards --version` names this build;
`cards check` says when a board was last rendered by another one.

## 0.2.0

New
- `cards ids <board>` writes a `:CUSTOM_ID:` for every card that has none,
  so you can write a card as a heading and its text. The id is written
  once; it stays when the claim changes.
- `cards set <board> <id ...> --status doing|blocked|done|todo|none` writes
  the TODO keyword of cards. `cards move <board> <id ...> --to <section>`
  (or `--before <id>`, `--after <id>`) moves cards in `board.org`, in the
  order given. Use them in place of a text replace.
- Each render writes `.cards/index.html`, the list of the project's boards
  with their open asks; every board links back to it.
- `cards hook` prints the lines for a Claude Code hook that hands you unread
  replies with the human's next message. Show them; do not install them
  yourself.
- `cards export --home <url>` gives a published copy a "Back" link.
- A Chinese, Japanese or Korean board carries a subset of an open font in
  the page, when the machine has one and has fonttools. `cards render`
  says once whether it does.
- A page takes `?view=`, `?level=`, `?embed` (in a frame) and `?fresh` (a
  sample; nothing is kept) in its address.
- SKILL.md: when a board is in use, ask on the board and nowhere else; the
  link is the hand-over.

Changed
- Figures are numbered in the order of the source, also a picture inside a
  list or a quote. `cards check` warns when such a picture has no caption.
- The size of an AVIF or SVG picture is read exactly.

Fixed
- A keyword with a hyphen, such as `#+translation-of:`, was shown as text of
  the lede with no warning. `cards check` now names it, and for this one it
  names the right spelling: `#+translation_of:`.
- On a touch screen, the reading view at Claim set each claim one letter
  per line.
- The Chinese buttons: 49 strings corrected by a second reader.

Checked against Org itself
- Every template passes `org-lint` in Emacs, and Emacs reads the same
  cards from a board as `cards` does. The tests run both.

## 0.1.0

The first public version. If you wrote boards with an earlier copy, these
are the changes that matter:

Changed
- A picture is a link, not a block: `[[file:shot.png]]` alone on a line,
  with `#+caption:` above it. `#+begin_src image` is shown as code, and
  `cards check` now says so.
- A board says its TODO keywords, so Emacs and GitHub read them:
  `#+todo: TODO DOING BLOCKED | DONE` under the title.
- `DONE` on a card with `:ASK:` is no longer a warning. It is how an ask is
  closed: the card keeps the ask and its options as the record.
- The human's text in a reply is a JSON string: quotes and line breaks are
  escaped, nothing is cut.
- A link to another page of the same work (a relative link) opens in the
  same tab. A link to another site opens beside the board.

New
- `:ASK: do`: an action only the human can take outside the board. They
  answer Done or I cannot.
- `:SUGGEST: none` on a choose card: only the human knows; no `[X]`, no
  warning, and the reply says `chosen`.
- Option keys: `- [ ] small :: S/M, 140 to 180 mm`. The reply names the key.
- An ask that `:NEEDS:` another open ask waits for it. If the human changes
  the first answer from your suggestion, the second comes back `held`:
  ask it again. `:NEEDS: a=link` writes an ask for one answer only;
  `:NEEDS: a=*` waits for any answer.
- `cards render` ends with the version of the build, so you can tell when
  the SKILL.md in your context is older than the code.
- `cards ingest`: records a reply the human pasted, so the board shows the
  answers. `cards settle`: marks the answered asks DONE.
- `cards export <board> --out <dir>`: a copy to publish, with no replies,
  no history and no local path.
- `cards shot`: a picture of the page as the human sees it.
- `#+author:` and `#+description:` show in the page and in link previews.
- `#+translation_of: <board>` links a board to the same board in another
  language; `cards check` says where the translation fell behind.
- `#+language:` picks the language of the buttons (English, Simplified
  Chinese).
- Files in cards: `[[file:...]]` for a picture or any file,
  `#+include: "f" src js :lines "10-40"` for an excerpt.
- `cards check` warns about a `#+keyword:` or a block type this build does
  nothing with.

The page
- The desk opens at the most detail that fits the window at a readable size,
  and a picture shows at every level. Fit never shrinks the board below a
  readable size; a tall board fits the width and scrolls.
- The browser tab shows how many asks wait, and the icon lights up.
