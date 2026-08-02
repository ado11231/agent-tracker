# The context report. A gif rather than a still, so the command being
# typed says what produced the output.
#
#   vhs docs/tapes/context.tape

Output docs/images/context.gif

Set Shell "bash"
Set FontSize 13
Set Padding 24
Set Width 1000
Set Height 620
Set Theme "Catppuccin Mocha"

Hide
Type "clear" Enter
Show

Type "ccplus context"
Sleep 800ms
Enter
Sleep 5s
