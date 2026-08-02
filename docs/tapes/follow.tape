# view --follow, appending turns as a session runs. The one image that
# has to be a gif: a still frame of a live transcript is just a
# transcript.
#
# scripts/record.sh starts scripts/demo-grow.mjs beforehand, which
# writes a new demo session one turn at a time. Follow with no id
# lands on it because it is the newest file in the root.
#
#   vhs docs/tapes/follow.tape

Output docs/images/follow.gif

Set Shell "bash"
Set FontSize 13
Set Padding 24
Set Width 1000
Set Height 560
Set Theme "Catppuccin Mocha"
# Frames get thrown away rather than kept, since nothing here is worth
# frame accurate playback and the file has to load on a readme.
Set Framerate 10

Hide
Type "clear" Enter
Show

Type "ccplus view --follow"
Sleep 700ms
Enter
# Long enough for the four turns the grower writes, plus the closing
# totals line it prints on ctrl-c.
Sleep 15s
Ctrl+C
Sleep 2s
