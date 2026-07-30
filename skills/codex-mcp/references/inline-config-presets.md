# Inline config presets

Built-in MCP tools **`codex`** and **`codex-reply`** do not accept `--profile`. Mirror profile files via top-level fields + nested `config`.

`config.profile` is **rejected** — use inline keys.

Default `service_tier` is `default` (standard API pricing). Opt into `fast` (legacy alias `priority`) only when wall-clock latency matters — Fast mode is ~2× API cost for ~2.5× speed.

## Review (mirrors `--profile review`)

```json
{
  "prompt": "…",
  "approval-policy": "never",
  "sandbox": "read-only",
  "model": "gpt-5.6-sol",
  "config": {
    "model_reasoning_effort": "high",
    "service_tier": "default"
  }
}
```

## Implement (mirrors `--profile implement`)

```json
{
  "prompt": "…",
  "approval-policy": "never",
  "sandbox": "workspace-write",
  "model": "gpt-5.6-luna",
  "config": {
    "model_reasoning_effort": "xhigh",
    "service_tier": "default"
  }
}
```

## Engineer (mirrors `--profile engineer`)

```json
{
  "prompt": "…",
  "approval-policy": "never",
  "sandbox": "workspace-write",
  "model": "gpt-5.6-sol",
  "config": {
    "model_reasoning_effort": "high",
    "service_tier": "default"
  }
}
```

## Probe (mirrors `--profile probe`)

```json
{
  "prompt": "…",
  "approval-policy": "never",
  "sandbox": "read-only",
  "model": "gpt-5.6-luna",
  "config": {
    "model_reasoning_effort": "medium",
    "service_tier": "default"
  }
}
```

Profile file reference: `~/.codex/*.config.toml` — see [config-advanced](https://developers.openai.com/codex/config-advanced).
