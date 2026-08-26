#!/bin/bash
# Shrink a PDF before publishing it to assets/.
#
# Slide decks exported from Keynote/PowerPoint embed images at full resolution,
# which makes them several times larger than they need to be for the web. This
# downsamples the images and leaves text and vector art untouched.
#
# This is an AUTHORING tool. It is not part of any build, the site does not
# depend on it, and nothing here runs when the site is served.
#
# Requires ghostscript:  brew install ghostscript
#
# Usage:  tools/optimize-pdf.sh <input.pdf> <output.pdf> [preset]
#   preset: screen (72dpi) | ebook (150dpi, default) | printer (300dpi)
#
# Always open the result and compare a few image-heavy pages before shipping.

set -euo pipefail

GS=$(command -v gs || echo /opt/homebrew/bin/gs)
[ -x "$GS" ] || { echo "ghostscript not found — brew install ghostscript" >&2; exit 1; }

IN=${1:?usage: optimize-pdf.sh <in.pdf> <out.pdf> [screen|ebook|printer]}
OUT=${2:?usage: optimize-pdf.sh <in.pdf> <out.pdf> [screen|ebook|printer]}
PRESET=${3:-ebook}

"$GS" -sDEVICE=pdfwrite -dCompatibilityLevel=1.5 -dPDFSETTINGS=/"$PRESET" \
      -dNOPAUSE -dQUIET -dBATCH -dDetectDuplicateImages=true -dCompressFonts=true \
      -sOutputFile="$OUT" "$IN"

before=$(wc -c < "$IN"); after=$(wc -c < "$OUT")
printf '%s: %.1f MB  ->  %s: %.1f MB  (%d%% smaller, /%s)\n' \
  "$(basename "$IN")"  "$(echo "$before/1048576" | bc -l)" \
  "$(basename "$OUT")" "$(echo "$after/1048576" | bc -l)" \
  "$(( 100 - after * 100 / before ))" "$PRESET"

# Page counts must match; if they do not, the conversion lost something.
pi=$(strings "$IN"  | grep -c '/Type */Page[^s]' || true)
po=$(strings "$OUT" | grep -c '/Type */Page[^s]' || true)
[ "$pi" = "$po" ] && echo "page count preserved ($po)" || echo "WARNING: page count $pi -> $po"
