# The masthead image: a year of daily cost as a contribution graph.
#
# This records the whole year view and scripts/record.sh then cuts the
# tables off the bottom, keeping everything down to the model legend.
# The cut is why the screenshot lands in .demo and not in docs/images:
# only the cropped file is a readme image. The tables get their own
# recording in dashboard.tape.
#
# Rendered by scripts/record.sh, which builds the demo sessions and
# points ccvitals at them. Never records against real logs.
#
#   bash scripts/record.sh heatmap

# A still, so this is Screenshot at the end rather than Output. Output
# with a .png name does not write one png: it writes a directory of
# every frame vhs rendered, several hundred of them.

# At 2x, like the other tapes: see the note in statusline.tape.
Set Shell "bash"
Set FontSize 26
Set Padding 48
# The full year grid needs about 115 columns. Narrower and the heatmap
# starts dropping the oldest weeks from the left, which is correct
# behaviour and the wrong thing to lead the README with. This is about
# 123, so there is a little room and not much waste: trailing empty
# columns are not free, because a readme scales the image down to the
# column width and dead width shrinks the part people are reading.
Set Width 2020
# Tall enough for the whole year view even though the bottom half is
# cropped away: the terminal has to hold the output without scrolling,
# because a frame shorter than the output scrolls the top off and the
# top is the part being kept. The year view is 45 lines with the demo
# sessions, plus the typed command and the prompt it returns to.
Set Height 1600
Set Theme "Catppuccin Mocha"

Hide
Type "clear" Enter
Show

Type "ccvitals --span year"
Sleep 700ms
Enter
Sleep 4s

Screenshot .demo/heatmap-full.png
# Frames for vhs to actually write the file. See statusline.tape.
Sleep 2s
