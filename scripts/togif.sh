#!/usr/bin/env bash
# Turns a screen recording into a readme sized gif.
#
#   scripts/togif.sh recording.mov docs/images/hero.gif [speed] [fps] [width]
#
# Defaults: 3x speed, 12 fps, 1100px wide.
#
# For the one image that cannot be a vhs tape: a real Claude Code
# session running beside the statusline. Everything else in
# docs/images comes from npm run record.
#
# Record with Cmd+Shift+5 (or Kap), at a normal to slow pace, then let
# this speed it up. Recording slowly and compressing in post reads as
# deliberate; recording fast reads as panic.
#
# Two things here matter more than they look:
#
# palettegen/paletteuse. A gif holds 256 colors, and ffmpeg's default
# pick is bad enough to band a terminal into mush. Generating a palette
# from the actual footage first is the whole difference between a gif
# that looks sharp and one that looks cheap.
#
# stats_mode=diff and diff_mode=rectangle. A screen recording is mostly
# a still image with a small part changing, so the palette is fitted to
# the pixels that actually move and unchanged rectangles are left
# alone between frames. On terminal footage this cuts the file size
# roughly in half for no visible cost.
set -euo pipefail

IN=${1:?usage: togif.sh <input> <output.gif> [speed] [fps] [width]}
OUT=${2:?usage: togif.sh <input> <output.gif> [speed] [fps] [width]}
SPEED=${3:-3}
FPS=${4:-12}
WIDTH=${5:-1100}

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is not installed. brew install ffmpeg" >&2
  exit 1
fi
if [ ! -f "$IN" ]; then
  echo "no such file: $IN" >&2
  exit 1
fi

PALETTE=$(mktemp -t ccvitals-palette).png
trap 'rm -f "$PALETTE"' EXIT

# setpts divides each frame's timestamp, so PTS/3 plays three times as
# fast. fps comes after it, which is what keeps the frame rate even
# rather than leaving whatever survived the speed up.
FILTERS="setpts=PTS/${SPEED},fps=${FPS},scale=${WIDTH}:-2:flags=lanczos"

echo "pass 1, fitting a palette to the footage..."
ffmpeg -loglevel error -i "$IN" \
  -vf "${FILTERS},palettegen=stats_mode=diff" \
  -y "$PALETTE"

echo "pass 2, encoding..."
# bayer dithering rather than the prettier sierra2_4a: on flat terminal
# text sierra scatters noise into solid backgrounds, which both looks
# wrong and destroys the compression.
ffmpeg -loglevel error -i "$IN" -i "$PALETTE" \
  -lavfi "${FILTERS}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  -loop 0 -an -y "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
DURATION=$(ffprobe -loglevel error -show_entries format=duration -of csv=p=0 "$OUT" 2>/dev/null || echo "?")
echo "wrote $OUT  ($SIZE, ${DURATION}s, ${FPS}fps, ${WIDTH}px wide)"

# Anything past about 5MB is slow to load on a readme and github may
# refuse to animate it at all.
BYTES=$(wc -c < "$OUT")
if [ "$BYTES" -gt 5000000 ]; then
  echo
  echo "that is over 5MB, which is slow on a readme. try, in order:" >&2
  echo "  a higher speed:  $0 $IN $OUT $((SPEED + 1))" >&2
  echo "  fewer frames:    $0 $IN $OUT $SPEED 10" >&2
  echo "  a smaller width: $0 $IN $OUT $SPEED $FPS 900" >&2
  echo "  trim the ends:   ffmpeg -i $IN -ss 2 -to 20 -c copy trimmed.mov" >&2
fi
