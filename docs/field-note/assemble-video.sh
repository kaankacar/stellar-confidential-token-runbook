#!/usr/bin/env bash
# Assemble the DR-6 demo video from the card and the clips shots.mjs recorded,
# then copy every still next to it.
# Usage: docs/field-note/assemble-video.sh            (HANDIN_DATE=YYYY-MM-DD overrides today's date)
# Output: docs/field-note/handin/DR-6_confidential-tokens-field-note_<date>.mp4
#         (1920x1080, 30 fps, H.264 yuv420p, no audio) plus the stills as PNG.
# Order: card 3 s, clip-a (the lifecycle log typed), clip-c (the transfer on the explorer,
#        then Bob's empty page), clip-b (the auditor log typed), clip-d (the game page scrolled).
set -euo pipefail
cd "$(dirname "$0")"
OUT_DIR=handin; mkdir -p "$OUT_DIR" clips/mp4
TODAY=${HANDIN_DATE:-$(date -u +%Y-%m-%d)}
OUT="$OUT_DIR/DR-6_confidential-tokens-field-note_${TODAY}.mp4"
ENC=(-c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -r 30 -an -movflags +faststart)
# Normalise a clip to 1920x1080 at 30 fps (letterboxed if the aspect differs) so the concat is a stream copy.
norm() {
  ffmpeg -y -loglevel error -i "$1" \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p" \
    "${ENC[@]}" "$2"
}
LIST=clips/mp4/concat.txt; : > "$LIST"
add() { echo "file '$(pwd)/$1'" >> "$LIST"; }
# 1. The card, 3 s. 1600x1000 scaled to 1920x1200 and cropped to 1920x1080: no stretch, no bars, the caption stays in frame.
ffmpeg -y -loglevel error -loop 1 -framerate 30 -t 3 -i card/card.png \
  -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,format=yuv420p" "${ENC[@]}" clips/mp4/00-card.mp4
add clips/mp4/00-card.mp4
# 2. The clips in shot-list order.
for c in clips/clip-a-lifecycle.webm clips/clip-c-explorer.webm clips/clip-b-audit.webm clips/clip-d-gerald.webm; do
  [ -f "$c" ] || { echo "skip missing $c" >&2; continue; }
  base=$(basename "${c%.*}"); norm "$c" "clips/mp4/$base.mp4"; add "clips/mp4/$base.mp4"
done
ffmpeg -y -loglevel error -f concat -safe 0 -i "$LIST" -c copy -movflags +faststart "$OUT"
# 3. Every still next to the video.
cp shots/DR-6_confidential-tokens-field-note_*.png "$OUT_DIR"/
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,pix_fmt:format=duration -of default=nw=1 "$OUT" | tr '\n' ' '; echo
echo "wrote $OUT"
