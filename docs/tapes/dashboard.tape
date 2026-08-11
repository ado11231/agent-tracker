# The dashboard with no span given: the periods, then spend by project,
# model and tool. The year grid is the other half of this screen and
# has its own tape, heatmap.tape, because one image tall enough to hold
# both is too tall to read on a readme.
#
# Rendered by scripts/record.sh, which builds the demo sessions and
# points ccvitals at them. Never records against real logs.
#
#   bash scripts/record.sh dashboard

# A still, so this is Screenshot at the end rather than Output. Output
# with a .png name does not write one png: it writes a directory of
# every frame vhs rendered, several hundred of them.

# At 2x, like the other tapes: see the note in statusline.tape.
Set Shell "bash"
Set FontSize 26
Set Padding 48
# No grid here, so the widest line is the project table at about 50
# columns. This is about 73, which leaves the tables room to grow a
# column or two and still wastes little: trailing
# empty columns are not free, because a readme scales the image down
# and dead width shrinks the part people are reading.
Set Width 1200
# Four tables and their headings come to 30 lines, plus the typed
# command and the prompt it returns to. Too short and vhs scrolls the
# top of the frame away, so this keeps a little room in hand.
Set Height 1120
Set Theme "Catppuccin Mocha"

Hide
Type "clear" Enter
Show

Type "ccvitals"
Sleep 700ms
Enter
Sleep 4s

Screenshot docs/images/dashboard.png
# Frames for vhs to actually write the file. See statusline.tape.
Sleep 2s
