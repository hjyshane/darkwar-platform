#!/usr/bin/env bash
# Migrations a branch ADDS must be numbered above everything already on the base.
#
#   scripts/check-migration-order.sh [base-ref]      (default: origin/main)
#
# The existing "one version per file" check in CI cannot see this: two branches
# that each took the next free number are each unique on their own, both pass,
# and the collision only exists once the second one merges (0165, 0258, and 0262
# all went that way; the third time `db push` applied one and tripped on the
# other's version). Run against the base as it is NOW, this fails the branch that
# is behind with the number to move to. It cannot notice a base that moves after
# the last run, so the branch rule "require branches to be up to date" is the
# other half; and the plain duplicate check in the guard job still catches the
# collision on main itself.
set -euo pipefail

base="${1:-origin/main}"
dir="supabase/migrations"

if ! git rev-parse --verify --quiet "$base" >/dev/null; then
  echo "::error::cannot find $base to compare migrations against (fetch it first)"
  exit 2
fi

version() { basename "$1" | sed -E 's/_.*//'; }

highest=$(git ls-tree --name-only "$base" "$dir/" | while read -r f; do version "$f"; done | sort | tail -1)
added=$(git diff --name-only --diff-filter=A "$base" HEAD -- "$dir" || true)

if [ -z "$added" ]; then
  echo "no migrations added; nothing to order"
  exit 0
fi

next=$((10#$highest + 1))
status=0
while read -r f; do
  [ -z "$f" ] && continue
  v=$(version "$f")
  if [ $((10#$v)) -le $((10#$highest)) ]; then
    echo "::error file=$f::version $v is not above $base's highest ($highest); another branch got there first. Rename to $next (and fix the number in the file, its test and any comment that cites it)."
    status=1
  else
    echo "ok: $f (above $highest)"
  fi
done <<< "$added"

exit $status
