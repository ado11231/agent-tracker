# The statusline panel, run by hand rather than by Claude Code.
#
# Without stdin it falls back to the newest session, which is what
# makes it previewable. The rate limit row needs the host json, so it
# is absent here: that is the panel shrinking to the rows it has data
# for, which is the documented behaviour.
#
#   vhs docs/tapes/statusline.tape

Output docs/images/statusline.png

Set Shell "bash"
Set FontSize 13
Set Padding 24
Set Width 900
Set Height 300
Set Theme "Catppuccin Mocha"

Hide
Type "clear" Enter
Show

Type "ccplus statusline"
Sleep 700ms
Enter
Sleep 3s
