#!/usr/bin/env bash
# Remove merged parallel feature worktrees (productize, fundability, harden, hitl-web-ui).
# Safe by default: prints what would be removed; pass --force to execute.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAIN_REPO="$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null | sed 's|/\.git/worktrees/.*||; s|/\.git$||')"
MAIN_REPO="${MAIN_REPO:-$(git -C "$ROOT" worktree list --porcelain 2>/dev/null | awk '/^worktree / {print $2; exit}')}"

# Merged parallel tracks (see docs/build-status.md). Paths are siblings of the main repo.
OLD_WORKTREES=(
  "durabl-productize"
  "durabl-fundability"
  "durabl-harden"
  "durabl-hitl-web-ui"
)

FORCE=0
if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $0 [--force]" >&2
  exit 1
fi

parent_dir="$(dirname "$MAIN_REPO")"
current="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || pwd)"

targets=()
for name in "${OLD_WORKTREES[@]}"; do
  path="${parent_dir}/${name}"
  [[ -d "$path" ]] || continue
  [[ "$(cd "$path" && pwd)" == "$current" ]] && continue
  targets+=("$path")
done

if [[ ${#targets[@]} -eq 0 ]]; then
  echo "No old parallel worktrees found under ${parent_dir}/."
  echo "Expected one of: ${OLD_WORKTREES[*]}"
  exit 0
fi

echo "Old parallel worktrees to remove:"
for path in "${targets[@]}"; do
  branch="$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")"
  echo "  ${path}  (${branch})"
done
echo ""

if [[ "$FORCE" -ne 1 ]]; then
  echo "Dry run — no changes made."
  echo "Re-run with --force to remove these worktrees:"
  echo "  npm run cleanup:worktrees -- --force"
  exit 0
fi

for path in "${targets[@]}"; do
  echo "==> removing ${path}"
  if git -C "$MAIN_REPO" worktree list --porcelain 2>/dev/null | grep -q "^worktree ${path}$"; then
    git -C "$MAIN_REPO" worktree remove --force "$path"
  elif [[ -f "${path}/.git" ]]; then
    git -C "$MAIN_REPO" worktree remove --force "$path" 2>/dev/null || rm -rf "$path"
  else
    echo "    skip: not a git worktree (${path})"
  fi
done

echo ""
echo "Done. Remaining worktrees:"
git -C "$MAIN_REPO" worktree list
