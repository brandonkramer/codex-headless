# Surface routing (Codex desktop app)

| Surface | Invoke | Best for |
|---------|--------|----------|
| Built-in Browser | `@Browser` | Localhost, file previews, public pages without sign-in |
| Chrome extension | `@Chrome` | Signed-in sites (Gmail, Salesforce, internal tools) |
| Computer Use | `@Computer`, `@AppName` | Desktop GUIs, multi-app flows |

**Rule:** Local dev servers → built-in Browser first. Signed-in state → Chrome. Desktop apps → Computer Use.

Computer Use requires Codex desktop app plugins — not all capabilities exist in bare `codex exec`.

Permissions: macOS Screen Recording + Accessibility; manage sites/apps in Codex app Settings.

## Verify profile (CLI orchestration)

Headless from Cursor: `--profile review --ephemeral` (read-only, high).

Fix after verify (explicit user request only): `--profile implement` (workspace-write).

## Exec rules

- One-shot verify: `--ephemeral`
- `< /dev/null` on prompt-as-argument runs
- Background: `run_in_background: true`, `-o <file>`, wait for notification
