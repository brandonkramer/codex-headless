# Codex JSON schemas (reference)

Structured output schemas for orchestration. Codex loads these via `--output-schema`.

## Plugin default (codex-headless / MCP)

`codex-headless` and MCP tools **always use bundled plugin schemas** from this directory — not `~/.codex/schemas/` — unless you explicitly opt in:

```bash
export CODEX_HEADLESS_SCHEMA_OVERRIDE=1   # opt-in only
bash scripts/install.sh                    # copies schemas + version sidecar
```

Override requires:

1. `CODEX_HEADLESS_SCHEMA_OVERRIDE=1`
2. `~/.codex/schemas/.codex-headless-version` matching `SCHEMA_SET_VERSION` in `src/schema.ts`
3. User schema files passing Codex strict validation (`required` lists every `properties` key recursively; `additionalProperties: false` on objects)

Stale or invalid user schemas **cannot** break plugin structured calls by default.

## Direct `codex exec --output-schema`

Install reference copies to `~/.codex/schemas/` for raw Codex CLI use:

```bash
bash scripts/install.sh
# or: cp schemas/*.schema.json ~/.codex/schemas/
echo 1 > ~/.codex/schemas/.codex-headless-version
```

| File | Used by |
|------|---------|
| `reviewer-verdict.schema.json` | codex-reviewer agent, `codex-headless review --structured` |
| `implement-report.schema.json` | Parallel workers, `codex-headless implement --structured` |
