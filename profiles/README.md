# Codex profiles (reference)

Reference copies of the headless `codex exec --profile` configs. Codex loads profiles from `~/.codex/<name>.config.toml`, not from this folder.

## Install

```bash
cp profiles/*.config.toml ~/.codex/
cp ../schemas/*.schema.json ~/.codex/schemas/
# or from plugin root:
bash scripts/install.sh
```

| Profile | Model | Reasoning | Sandbox | service_tier |
|---------|-------|-----------|---------|--------------|
| `review` | gpt-5.6-sol | high | read-only | `default` |
| `engineer` | gpt-5.6-sol | high | workspace-write | `default` |
| `implement` | gpt-5.6-luna | xhigh | workspace-write | `default` |
| `probe` | gpt-5.6-luna | medium | read-only | `default` |

`service_tier = "default"` is intentional: Fast mode (`fast` / legacy `priority`) is ~2× API cost for ~2.5× speed. Opt in per run with `-c service_tier="fast"` when latency matters.
