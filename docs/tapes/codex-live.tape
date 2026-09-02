Set Shell "bash"
Set FontSize 26
Set Padding 48
Set Width 1800
Set Height 320
Set Theme "Catppuccin Mocha"

Hide
Type "clear" Enter
Show

# The same rows Codex prints after a turn, from the same renderer.
# Colors are left on here: the gauges are the one place color carries
# meaning rather than decoration, so a plain capture would misreport
# what the panel looks like in use.
Type "agenttracker live --source codex --refresh 0"
Sleep 300ms
Enter
Sleep 3s

Screenshot docs/images/codex-live.png
Sleep 2s
