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
Set Height 900
Set Theme "Catppuccin Mocha"

Hide
Type "clear" Enter
Show

Type "ccplus --span year"
Sleep 700ms
Enter
Sleep 4s
