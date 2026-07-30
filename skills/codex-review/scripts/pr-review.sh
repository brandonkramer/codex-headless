#!/usr/bin/env bash
# Review a GitHub PR with Codex and post the result as a PR review.
#
# Usage:
#   pr-review.sh <pr-number> [repo-root]
#
# Env (optional):
#   CODEX_REVIEW_MODEL=gpt-5.6-sol
#   CODEX_PR_REVIEW_DRY_RUN=1          # print body, do not post
#   CODEX_PR_REVIEW_EVENT=auto         # auto | approve | comment | request-changes
#   CODEX_PR_REVIEW_ALWAYS_COMMENT=1   # force --comment (ignore verdict mapping)
#   CODEX_STREAM=1                     # 0 or --no-stream on codex-pty.py to buffer
#   CODEX_MAX_SECS=600                 # wall-clock wait before kill

set -euo pipefail

PR="${1:?PR number required}"
REPO_ROOT="${2:-.}"
MODEL="${CODEX_REVIEW_MODEL:-gpt-5.6-sol}"
VERDICT_NORM=""
REVIEW_EVENT=""
POSTED=0
DONE_EMITTED=0

emit_done_sentinel() {
  local exit_code="${1:-$?}"
  if [ "$DONE_EMITTED" -eq 1 ]; then
    return
  fi
  DONE_EMITTED=1
  printf 'CODEX_PR_REVIEW_DONE exit=%s pr=%s verdict=%s event=%s dry_run=%s posted=%s\n' \
    "$exit_code" \
    "$PR" \
    "${VERDICT_NORM:-unknown}" \
    "${REVIEW_EVENT:-unknown}" \
    "${CODEX_PR_REVIEW_DRY_RUN:-0}" \
    "$POSTED" \
    >&2
}

trap 'emit_done_sentinel $?' EXIT

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI required" >&2
  exit 1
fi
if ! command -v codex >/dev/null 2>&1; then
  echo "error: codex CLI required" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq required" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 required" >&2
  exit 1
fi

cd "$REPO_ROOT"

PR_META="$(gh pr view "$PR" --json title,headRefName,url,headRefOid,number)"
PR_TITLE="$(jq -r '.title + " (" + .headRefName + ")"' <<<"$PR_META")"
PR_URL="$(jq -r .url <<<"$PR_META")"
HEAD_SHA="$(jq -r .headRefOid <<<"$PR_META")"
HEAD_SHA_SHORT="${HEAD_SHA:0:7}"
REVIEWED_AT="$(date -u +"%Y-%m-%d %H:%M UTC")"

DIFF_FILE="$(mktemp)"
PROMPT_FILE="$(mktemp)"
OUT_FILE="$(mktemp)"
BODY_FILE="$(mktemp)"
trap 'rm -f "$DIFF_FILE" "$PROMPT_FILE" "$OUT_FILE" "$BODY_FILE"' EXIT

gh pr diff "$PR" >"$DIFF_FILE"

cat >"$PROMPT_FILE" <<EOF
Review this pull request for the repository at $REPO_ROOT.

PR #${PR}: ${PR_TITLE}
Head commit: ${HEAD_SHA_SHORT}

Read AGENTS.md or CLAUDE.md first if present.

Analyze ONLY the diff below — not other local changes, not other open PRs.
Do not edit files. Do not run tests or dev servers.

## Output format (strict)

Line 1 MUST be exactly one machine-readable verdict (no markdown on this line):
VERDICT: approve
VERDICT: approve-with-nits
VERDICT: request-changes

Then a blank line, then GitHub-flavored markdown for the review body.

Use Conventional Comments labels for every finding: praise:, issue:, suggestion:, question:, nitpick:, thought:
Add decorations when helpful: (blocking), (non-blocking), (security), (if-minor).
Each finding MUST include a \`path:line\` reference when the diff allows it.

Required markdown structure:

1. \`## :memo: Summary\` — 2-3 sentences (no separate verdict block — the script adds that).

2. Severity counts table:

| Severity | Count |
|----------|------:|
| :rotating_light: Blocking | N |
| :warning: Major | N |
| :bulb: Suggestion | N |
| :nail_care: Nitpick | N |

3. \`## :sparkles: Strengths\` — at least one **praise:** bullet (prefix line with :sparkles: when listing).

4. \`<details>\` block titled \`:mag: Findings (N)\` (N = total findings) containing subsections:
   - \`### :rotating_light: Blocking\` — lines start with :rotating_light: then **issue (blocking):**
   - \`### :warning: Major\` — lines start with :warning: then **issue:**
   - \`### :bulb: Suggestions\` — lines start with :bulb: then **suggestion (non-blocking):**
   - \`### :nail_care: Nitpicks\` — lines start with :nail_care: then **nitpick (non-blocking):**
   - \`### :question: Questions\` — if any **question (non-blocking):** (lines start with :question:)
   - \`### :lock: Security\` — if any **issue (security):** or **suggestion (security):** (lines start with :lock:)
   Use blank lines inside \`<details>\` per GitHub markdown rules (blank line after \`</summary>\`).

5. \`## :test_tube: Verification gaps\` — markdown task list \`- [ ] ...\` for missing tests/checks; use \`- [x] :white_check_mark: None identified\` if none.

Use GitHub emoji shortcodes (e.g. \`:bug:\`, \`:fire:\`) — not raw Unicode symbols. One leading emoji per finding line is enough; do not emoji every word.

Do NOT wrap output in outer code fences. Do NOT include a model footer — the script adds metadata.

--- DIFF START ---
$(cat "$DIFF_FILE")
--- DIFF END ---
EOF

# Profile review: high reasoning, read-only. PTY streams progress; -o captures final body.
python3 "$SCRIPT_DIR/codex-pty.py" \
  -f "$PROMPT_FILE" \
  --max-secs "${CODEX_MAX_SECS:-600}" \
  --profile review --ephemeral --ignore-user-config --ignore-rules \
  -m "$MODEL" \
  -o "$OUT_FILE" \
  -

REVIEW_BODY="$(cat "$OUT_FILE")"
if [ -z "$REVIEW_BODY" ]; then
  echo "error: Codex returned empty review" >&2
  exit 1
fi

# Strip machine-readable verdict line (expected on line 1); map to gh pr review event.
VERDICT_RAW=""
if printf '%s\n' "$REVIEW_BODY" | head -1 | grep -qE '^VERDICT:[[:space:]]*'; then
  VERDICT_RAW="$(printf '%s\n' "$REVIEW_BODY" | head -1)"
  REVIEW_BODY="$(printf '%s\n' "$REVIEW_BODY" | tail -n +2)"
fi
VERDICT_NORM="$(printf '%s' "$VERDICT_RAW" | sed -E 's/^VERDICT:[[:space:]]*//; s/[[:space:]]+$//; s/[[:space:]]+/-/g; y/A-Z/a-z/')"

resolve_review_event() {
  if [ "${CODEX_PR_REVIEW_ALWAYS_COMMENT:-}" = "1" ]; then
    echo "comment"
    return
  fi
  case "${CODEX_PR_REVIEW_EVENT:-auto}" in
    approve | comment | request-changes)
      echo "${CODEX_PR_REVIEW_EVENT}"
      return
      ;;
    auto) ;;
    *)
      echo "error: CODEX_PR_REVIEW_EVENT must be auto, approve, comment, or request-changes" >&2
      exit 1
      ;;
  esac
  case "$VERDICT_NORM" in
    approve) echo "approve" ;;
    approve-with-nits | approve-with-nit) echo "approve" ;;
    request-changes | request-change) echo "request-changes" ;;
    *)
      echo "comment"
      ;;
  esac
}

REVIEW_EVENT="$(resolve_review_event)"

verdict_callout() {
  case "$VERDICT_NORM" in
    approve)
      echo "> [!NOTE]"
      echo "> :white_check_mark: **Verdict:** Approve"
      ;;
    approve-with-nits | approve-with-nit)
      echo "> [!TIP]"
      echo "> :white_check_mark: **Verdict:** Approve with nits"
      ;;
    request-changes | request-change)
      echo "> [!CAUTION]"
      echo "> :x: **Verdict:** Request changes"
      ;;
    *)
      echo "> [!IMPORTANT]"
      echo "> :speech_balloon: **Verdict:** Review posted (no explicit approve/block)"
      ;;
  esac
}

{
  echo "> [!NOTE]"
  echo "> :robot: **Automated review** (Codex · \`review\` profile · \`${MODEL}\`)"
  echo "> Reviewed [\`${HEAD_SHA_SHORT}\`](${PR_URL}/commits/${HEAD_SHA}) · [PR #${PR}](${PR_URL}) · ${REVIEWED_AT}"
  echo
  verdict_callout
  echo
  echo "$REVIEW_BODY"
  echo
  echo "---"
  echo "<sub>Generated by Codex headless · Findings are advisory — verify before merge · Dry run: \`CODEX_PR_REVIEW_DRY_RUN=1 pr-review.sh ${PR}\`</sub>"
} >"$BODY_FILE"

if [ "${CODEX_PR_REVIEW_DRY_RUN:-}" = "1" ]; then
  echo "# dry-run: would post gh pr review --${REVIEW_EVENT} (verdict=${VERDICT_NORM:-unknown})" >&2
  cat "$BODY_FILE"
  exit 0
fi

case "$REVIEW_EVENT" in
  approve)
    gh pr review "$PR" --approve --body-file "$BODY_FILE"
    ;;
  request-changes)
    gh pr review "$PR" --request-changes --body-file "$BODY_FILE"
    ;;
  *)
    gh pr review "$PR" --comment --body-file "$BODY_FILE"
    ;;
esac

POSTED=1
echo "Posted Codex review on PR #${PR} (event=${REVIEW_EVENT}, verdict=${VERDICT_NORM:-unknown}, model=${MODEL})"
