# The hero image: a year of daily cost, then spend by project and model.
#
# Rendered by scripts/record.sh, which builds the demo sessions and
# points ccplus at them. Never records against real logs.
#
#   vhs docs/tapes/dashboard.tape

Output docs/images/dashboard.png

Set Shell "bash"
Set FontSize 13
Set Padding 24
# The full year grid needs about 115 columns. Narrower and the heatmap
# starts dropping the oldest weeks from the left, which is correct
# behaviour and the wrong thing to lead the README with.
Set Width 1240
# The year view is 45 lines with the demo sessions: a recording has
# color, so the grid draws squares and needs no spacer rows, and the
# masthead and table rules cost a few lines back. Too short and vhs
# scrolls the top of the frame away.
Set Height 880
Set Theme "Catppuccin Mocha"

Hide
Type "clear" Enter
Show

Type "ccplus --span year"
Sleep 700ms
Enter
Sleep 4s
