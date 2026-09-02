# The statusline panel, run by hand rather than by Claude Code.
#
# Without stdin it falls back to the newest session, which is what
# makes it previewable. The rate limit row needs the host json, so it
# is absent here: that is the panel shrinking to the rows it has data
# for, which is the documented behaviour.
#
#   vhs docs/tapes/statusline.tape

# A still, so this is Screenshot at the end rather than Output. Output
# with a .png name writes a directory of every frame, not one image.

# Everything below is at 2x. Width, Height, FontSize and Padding are
# doubled together, which leaves the layout identical (columns are
# width minus padding over character width, and character width scales
# with font size) and gives four times the pixels. Readers see it
# downscaled, and downscaling is what makes the text look sharp.
Set Shell "bash"
Set FontSize 26
Set Padding 48
Set Width 1800
# Four rows of panel, the typed command and the prompt it returns to.
Set Height 340
Set Theme "Catppuccin Mocha"

Hide
Type "clear" Enter
Show

Type "agenttracker statusline"
Sleep 700ms
Enter
Sleep 3s

Screenshot docs/images/statusline.png
# vhs takes the screenshot off a later frame, so a tape that ends on
# Screenshot sometimes exits before the file is written. This sleep is
# the frames it needs. Without it the image appears about one run in
# three.
Sleep 2s
