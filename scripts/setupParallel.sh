#!/usr/bin/env bash
# Creates one git worktree per parallel stream, each on its own branch off the
# current HEAD, with dependencies installed. See
# docs/superpowers/specs/PARALLEL.md for the contract the streams follow.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
parent="$(dirname "$repo_root")"
base="$(basename "$repo_root")"

streams=(
  "a-smart-guides"
  "b-auto-justify"
  "c-export"
  "d-user-guide"
)

if [ -n "$(git -C "$repo_root" status --porcelain)" ]; then
  echo "Working tree is dirty. Commit or stash first — every worktree branches off HEAD." >&2
  exit 1
fi

for stream in "${streams[@]}"; do
  dir="$parent/$base-$stream"
  branch="stream/$stream"

  if [ -e "$dir" ]; then
    echo "skip  $dir (already exists)"
    continue
  fi

  echo "==> $branch -> $dir"
  git -C "$repo_root" worktree add -b "$branch" "$dir" HEAD
  (cd "$dir" && npm install --silent)
done

echo
echo "Worktrees ready. Open one terminal per stream:"
for stream in "${streams[@]}"; do
  letter="$(echo "${stream:0:1}" | tr '[:lower:]' '[:upper:]')"
  echo
  echo "  cd $parent/$base-$stream && claude"
  echo "  Read docs/superpowers/specs/PARALLEL.md, then implement docs/superpowers/specs/2026-08-12-stream-${stream:0:1}-${stream:2}.md   # stream $letter"
done
echo
echo "When all four are done, come back here and ask for the merge (order: A -> C -> B -> D)."
