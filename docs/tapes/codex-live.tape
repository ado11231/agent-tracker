Set Shell "bash"
Set FontSize 26
Set Padding 48
Set Width 1800
Set Height 320
Set Theme "Catppuccin Mocha"

Hide
Type "clear" Enter
Show

Type "node dist/main.js live --source codex --refresh 0 --no-color"
Sleep 300ms
Enter
Sleep 3s

Screenshot docs/images/codex-live.png
Sleep 2s
