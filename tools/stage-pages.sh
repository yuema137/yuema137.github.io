#!/usr/bin/env bash
set -euo pipefail

output="${1:-_site}"
if [ "$output" != "_site" ]; then
  echo "This script only stages the fixed _site directory." >&2
  exit 2
fi

if [ -e "$output" ]; then
  echo "$output already exists; refusing to mix a new deployment with stale files." >&2
  exit 2
fi

mkdir -p "$output"

publish=(
  index.html 404.html favicon.svg robots.txt sitemap.xml .nojekyll
  assets css js
  blog cv projects publications research talks
)
for path in "${publish[@]}"; do
  cp -R "$path" "$output/"
done

rm -rf "$output/cv/resume"

# SciEval is an optional, already-validated snapshot. Failure here removes the
# partial copy and leaves the rest of the personal site publishable.
if [ -d scieval ]; then
  if ! cp -R scieval "$output/"; then
    echo "Warning: SciEval could not be staged; publishing the main site without it." >&2
    rm -rf "$output/scieval"
  fi
else
  echo "Warning: no SciEval snapshot is present; publishing the main site without it." >&2
fi

for path in cv/resume tools package.json package-lock.json README.md .github node_modules build; do
  if [ -e "$output/$path" ]; then
    echo "$output/$path was staged but must not be published." >&2
    exit 1
  fi
done

for path in index.html cv/index.html assets/cv/yue-ma-cv.pdf css/style.css .nojekyll; do
  if [ ! -e "$output/$path" ]; then
    echo "$output/$path is missing; the main site would be broken." >&2
    exit 1
  fi
done
