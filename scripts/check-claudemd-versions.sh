#!/usr/bin/env bash
#
# Verify that the package table in CLAUDE.md matches the actual
# package.json versions in the monorepo. Exits non-zero on drift.
#
# Usage:
#   ./scripts/check-claudemd-versions.sh      # from repo root
#   make claudemd-check                        # via Makefile target

set -euo pipefail

CLAUDE_MD="CLAUDE.md"
DRIFT=0

if [ ! -f "$CLAUDE_MD" ]; then
  echo "error: $CLAUDE_MD not found (run from repo root)" >&2
  exit 1
fi

for pkg_dir in packages/*/; do
  pkg_json="${pkg_dir}package.json"
  [ -f "$pkg_json" ] || continue

  name=$(awk -F'"' '/"name"/{print $4; exit}' "$pkg_json")
  actual=$(awk -F'"' '/"version"/{print $4; exit}' "$pkg_json")

  # Table rows: | `@centient/foo` | 1.2.3 | description |
  # Extract the version field (column 3) from the row matching this package name.
  table_version=$(awk -F'|' -v pkg="\`${name}\`" \
    '$2 ~ pkg { gsub(/^[ \t]+|[ \t]+$/, "", $3); print $3 }' "$CLAUDE_MD")

  if [ -z "$table_version" ]; then
    echo "MISSING  $name  (actual: $actual, not in CLAUDE.md table)"
    DRIFT=1
  elif [ "$table_version" != "$actual" ]; then
    echo "DRIFT    $name  (CLAUDE.md: $table_version, actual: $actual)"
    DRIFT=1
  else
    echo "OK       $name  ($actual)"
  fi
done

if [ "$DRIFT" -ne 0 ]; then
  echo ""
  echo "CLAUDE.md package table is out of sync. Update it and open a docs PR."
  exit 1
else
  echo ""
  echo "All package versions in CLAUDE.md match."
fi
