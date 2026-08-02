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

DEMO="$PWD/.demo/projects"
BIN="$PWD/.demo/bin"

echo "building..."
npm run build --silent

echo "writing demo sessions..."
node scripts/demo-sessions.mjs "$DEMO" >/dev/null

# The tapes type "ccplus", not a path, so a shim goes on PATH ahead of
# any real install. It also pins CCPLUS_ROOT, which is what keeps the
# recordings off the real logs even if someone runs a tape by hand.
mkdir -p "$BIN"
cat > "$BIN/ccplus" <<EOF
#!/usr/bin/env bash
export CCPLUS_ROOT="$DEMO"
exec node "$PWD/dist/main.js" "\$@"
EOF
chmod +x "$BIN/ccplus"
export PATH="$BIN:$PATH"

mkdir -p docs/images

wanted=("$@")
if [ ${#wanted[@]} -eq 0 ]; then
  wanted=(dashboard context statusline)
fi

for name in "${wanted[@]}"; do
  tape="docs/tapes/$name.tape"
  if [ ! -f "$tape" ]; then
    echo "no tape named $name" >&2
    exit 1
  fi

  echo "recording $name..."
  vhs "$tape"
done

echo "done. images are in docs/images/"
