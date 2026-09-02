# The context report. A gif rather than a still, so the command being
# typed says what produced the output.
#
#   vhs docs/tapes/context.tape

Output docs/images/context.gif

# At 2x, like the other two tapes: see the note in statusline.tape.
Set Shell "bash"
Set FontSize 26
Set Padding 48
Set Width 2000
# The report is 20 lines, plus the typed command and the prompt after.
Set Height 840
Set Theme "Catppuccin Mocha"

Hide
Type "clear" Enter
Show

Type "agenttracker context"
Sleep 800ms
Enter
Sleep 5s
