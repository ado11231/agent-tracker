# The hero image: a year of daily cost, then spend by project and model.
#
# Rendered by scripts/record.sh, which builds the demo sessions and
# points ccplus at them. Never records against real logs.
#
#   vhs docs/tapes/dashboard.tape

# A still, so this is Screenshot at the end rather than Output. Output
# with a .png name does not write one png: it writes a directory of
# every frame vhs rendered, several hundred of them.

# At 2x, like the other two tapes: see the note in statusline.tape.
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
# The year view is 45 lines with the demo sessions: a recording has
# color, so the grid draws squares and needs no spacer rows, and the
# masthead and table rules cost a few lines back. With the typed
# command and the prompt it returns to, call it 47 lines at roughly
# 31px at this size, plus the padding. Too short and vhs scrolls the
# top of the frame away, so this keeps a little room in hand.
Set Height 1600
Set Theme "Catppuccin Mocha"

Hide
Type "clear" Enter
Show

Type "ccplus --span year"
Sleep 700ms
Enter
Sleep 4s

Screenshot docs/images/dashboard.png
# Frames for vhs to actually write the file. See statusline.tape.
Sleep 2s
