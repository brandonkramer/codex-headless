#!/usr/bin/env bash
# Install Codex headless profiles and JSON schemas to ~/.codex/
#
# Usage: bash scripts/install.sh [--dry-run]

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
DRY_RUN=0

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "would run: $*"
  else
    "$@"
  fi
}

echo "Codex headless install → $CODEX_HOME"

missing=0
for cmd in codex; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "warning: '$cmd' not on PATH" >&2
    missing=1
  fi
done

run mkdir -p "$CODEX_HOME/schemas"

for f in "$ROOT/profiles/"*.config.toml; do
  base="$(basename "$f")"
  echo "  profile: $base"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    → $CODEX_HOME/$base"
  else
    cp "$f" "$CODEX_HOME/$base"
  fi
done

for f in "$ROOT/schemas/"*.schema.json; do
  base="$(basename "$f")"
  echo "  schema:  $base"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    → $CODEX_HOME/schemas/$base"
  else
    cp "$f" "$CODEX_HOME/schemas/$base"
  fi
done

echo "  schema version sidecar → $CODEX_HOME/schemas/.codex-headless-version"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "    (from SCHEMA_SET_VERSION in src/schema.ts — keep in sync)"
else
  # Keep aligned with SCHEMA_SET_VERSION in src/schema.ts
  echo "1" > "$CODEX_HOME/schemas/.codex-headless-version"
fi

if [[ -x "$ROOT/bin/codex-headless" ]]; then
  echo "  cli:     bin/codex-headless (already in plugin)"
else
  echo "  cli:     run 'chmod +x $ROOT/bin/codex-headless' after install"
fi

if [[ "$missing" == "1" ]]; then
  echo ""
  echo "Install copied files, but install Codex CLI: https://developers.openai.com/codex/" >&2
  exit 1
fi

echo "Done."
