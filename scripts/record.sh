#!/usr/bin/env bash
# Renders the README images from the tapes in docs/tapes.
#
#   npm run record            all of them
#   npm run record context    just one
#
# Needs vhs: brew install vhs
#
# Everything is recorded against invented demo sessions, never against
# ~/.claude/projects. A README image built from real logs would put
# real project names, real paths and real prompts on a public page.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v vhs >/dev/null 2>&1; then
  echo "vhs is not installed. brew install vhs" >&2
  exit 1
fi

# ffmpeg comes with vhs, which needs it to write frames. The heatmap
# image is a crop, so this checks for it rather than assuming.
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is not installed. brew install ffmpeg" >&2
  exit 1
fi

DEMO="$PWD/.demo/projects"
CODEX_DEMO="$PWD/.demo/codex"
BIN="$PWD/.demo/bin"

echo "building..."
npm run build --silent

echo "writing demo sessions..."
node scripts/demo-sessions.mjs "$DEMO" >/dev/null

# The tapes type "agenttracker", not a path, so a shim goes on PATH ahead of
# any real install. It also pins the demo roots, which is what keeps the
# recordings off the real logs even if someone runs a tape by hand.
mkdir -p "$BIN"
cat > "$BIN/agenttracker" <<EOF
#!/usr/bin/env bash
export AGENTTRACKER_CLAUDE_ROOT="$DEMO"
export AGENTTRACKER_CODEX_ROOT="$CODEX_DEMO"
exec node "$PWD/dist/main.js" "\$@"
EOF
chmod +x "$BIN/agenttracker"
export PATH="$BIN:$PATH"

mkdir -p docs/images

wanted=("$@")
if [ ${#wanted[@]} -eq 0 ]; then
  wanted=(heatmap dashboard context statusline codex-live)
fi

for name in "${wanted[@]}"; do
  tape="docs/tapes/$name.tape"
  if [ ! -f "$tape" ]; then
    echo "no tape named $name" >&2
    exit 1
  fi

  echo "recording $name..."
  vhs "$tape"

  # The heatmap tape records the whole year view, tables and all,
  # because a terminal shorter than its output scrolls the top away and
  # the top is the part being kept. So the cut happens here instead.
  #
  # 740 is the last row of the model legend. To work it out again after
  # a layout change, open .demo/heatmap-full.png and find the first
  # empty row under the legend. The pad puts the background back below the
  # cut so the bottom margin matches the 48 above the first line, and
  # 1c1c2c is what vhs renders Catppuccin Mocha's base as.
  if [ "$name" = heatmap ]; then
    echo "cropping heatmap..."
    ffmpeg -y -v error -i .demo/heatmap-full.png \
      -vf "crop=2020:672:0:0,pad=2020:700:0:0:0x1c1c2c" \
      docs/images/heatmap.png
  fi
done

echo "done. images are in docs/images/"
