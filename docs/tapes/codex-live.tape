# The Codex panel, recorded inside a real Codex session.
#
# Codex has no external status line, so the panel is printed by a Stop
# hook after each turn. That hook only fires on a real turn, which
# means this tape starts Codex and sends it a message rather than
# rendering the panel from demo data the way the other tapes do.
#
# Consequences worth knowing before running it:
#
#   - It spends a little of the account's real usage. One word in,
#     one line back.
#   - The panel shows that session's real numbers, not demo figures.
#     A fresh session in this directory keeps them small.
#   - It needs the hook already trusted in ~/.codex/config.toml.
#     Codex gates hooks behind a one time review, and an untrusted
#     hook is skipped in silence, which here would look like the panel
#     simply not appearing.
#
# This records the whole terminal and scripts/record.sh cuts the panel
# out of it, which is why the screenshot lands in .demo and not in
# docs/images. Same arrangement as heatmap.tape.
#
#   bash scripts/record.sh codex-live

# At 2x, like the other tapes: see the note in statusline.tape. The
# point of recording this through vhs rather than screenshotting by
# hand is that the panel then matches the Claude image beside it in
# the readme, same font, same width, same theme.
Set Shell "bash"
Set FontSize 26
Set Padding 48
Set Width 1800
# Tall enough for Codex's banner, the exchange and the panel without
# the transcript scrolling, since a scrolled frame moves the panel.
Set Height 1100
Set Theme "Catppuccin Mocha"

Hide
Type "clear" Enter
Show

Type "codex"
Enter
# Codex draws its banner and loads the session before it will accept
# input. Typing into it early drops characters.
Sleep 8s

Type "hello"
Sleep 500ms
Enter

# The model has to answer and the turn has to end before the Stop hook
# runs, so this waits on a network round trip rather than on rendering.
Sleep 25s

Screenshot .demo/codex-full.png
# Frames for vhs to actually write the file. See statusline.tape.
Sleep 2s
