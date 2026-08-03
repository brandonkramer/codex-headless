import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  implementBriefInputSchema,
} from "../../implement-brief.ts";
import {
  buildSessionKey,
  type RunTurnResult,
} from "../../persistent-runner.ts";
import {
  canSafelyFallbackToExec,
  runPersistentTurn,
} from "../../persistent-service.ts";
import { threadStartParamsForProfile } from "../../profile-thread-config.ts";
import {
  runCodexExec,
  type HeadlessProfile,
  type RunCodexResult,
} from "../../run-codex.ts";
import {
  assertSessionFlagsCompatible,
  maybeValidateWriteScope,
  mcpErrorResult,
  McpInputError,
  resolveImplementPromptInput,
} from "../tool-helpers.ts";

const cwdField = z
  .string()
  .optional()
  .describe("Working directory (defaults to server cwd)");

const promptField = z
  .string()
  .optional()
  .describe("Self-contained Codex prompt. Required unless using built-in review flags.");

const jsonField = z
  .boolean()
  .optional()
  .default(true)
  .describe(
    "Capture JSONL (default true): durable last agent_message when -o is empty, usage telemetry, progress events",
  );

const jsonlPathField = z
  .string()
  .optional()
  .describe(
    "Path to write the full JSONL event stream. When omitted and json=true, a temp file under os.tmpdir() is created and returned as jsonlPath",
  );

const ephemeralField = z
  .boolean()
  .optional()
  .describe(
    "Default true: pass --ephemeral (no disk session). Set false to persist for later resumeThreadId / exec resume.",
  );

const resumeThreadIdField = z
  .string()
  .optional()
  .describe(
    "Resume a prior non-ephemeral exec thread by id (`codex exec resume <id>`). Incompatible with ephemeral=true and persistentSessionKey.",
  );

const persistentSessionKeyField = z
  .string()
  .optional()
  .describe(
    "Opt-in app-server session key. Reuses one `codex app-server` process (60s idle lease, one in-flight turn/session). Incompatible with resumeThreadId. Default path stays `codex exec`.",
  );

const briefField = implementBriefInputSchema
  .optional()
  .describe(
    "Typed implementation brief (change + files/writeScope/…). Assembled into the prompt; timeoutMs maps to maxWallMs. Provide brief and/or prompt.",
  );

function toolResult(
  result: RunCodexResult,
  extra?: Record<string, unknown>,
) {
  const usageNote = result.usage
    ? `\n\n---\nusage: input=${result.usage.input_tokens} cached=${result.usage.cached_input_tokens} output=${result.usage.output_tokens} reasoning=${result.usage.reasoning_output_tokens}`
    : "";
  return {
    content: [{ type: "text" as const, text: `${result.content}${usageNote}` }],
    structuredContent: { ...result, ...extra },
  };
}

function mapAppServerTurn(
  turn: RunTurnResult,
  profile: HeadlessProfile,
): RunCodexResult {
  return {
    ok: turn.ok,
    exitCode: turn.ok ? 0 : 1,
    content: turn.content || turn.error || "",
    profile,
    command: "codex app-server --listen stdio:// (persistent)",
    contentSource: turn.content.trim() ? "jsonl-agent-message" : "empty",
    usageReported: false,
    turnError: turn.ok ? undefined : turn.error,
    threadId: turn.threadId || undefined,
    parseErrors: 0,
    retrySafe: false,
  };
}

async function runViaAppServerOrExec(opts: {
  profile: HeadlessProfile;
  prompt: string;
  cwd?: string;
  persistentSessionKey: string;
  ephemeral?: boolean;
  structured?: boolean;
  json?: boolean;
  jsonlPath?: string;
  maxWallMs?: number;
}): Promise<{ result: RunCodexResult; meta: Record<string, unknown> }> {
  const workDir = opts.cwd ?? process.cwd();
  const sessionKey =
    opts.persistentSessionKey.trim() ||
    buildSessionKey({
      cwd: workDir,
      profile: opts.profile,
      sandbox: threadStartParamsForProfile(opts.profile).sandbox ?? "",
      model: threadStartParamsForProfile(opts.profile).model ?? "",
    });

  const threadStart = threadStartParamsForProfile(opts.profile, {
    cwd: workDir,
    ephemeral: opts.ephemeral,
  });

  // Structured outputSchema on turn/start is supported by protocol, but event
  // aggregation into full RunCodexResult (usage/JSONL/retrySafe) is incomplete.
  // Prefer dedicated tool for raw app-server turns; here we still attempt the turn
  // and fall back to exec only when safe (before mutation).
  const turn = await runPersistentTurn({
    sessionKey,
    input: [{ type: "text", text: opts.prompt }],
    cwd: workDir,
    model: threadStart.model,
    threadStart,
  });

  if (turn.ok) {
    return {
      result: mapAppServerTurn(turn, opts.profile),
      meta: {
        transport: "app-server",
        persistentSessionKey: sessionKey,
        reusedProcess: turn.reusedProcess,
        reusedThread: turn.reusedThread,
        turnId: turn.turnId,
        note: "app-server path: usage/JSONL/retrySafe not fully aggregated; prefer structured exec for reports",
      },
    };
  }

  if (canSafelyFallbackToExec(turn.fallback, { turnId: turn.turnId })) {
    const result = await runCodexExec({
      profile: opts.profile,
      prompt: opts.prompt,
      cwd: opts.cwd,
      structured: opts.structured,
      json: opts.json,
      jsonlPath: opts.jsonlPath,
      maxWallMs: opts.maxWallMs,
      ephemeral: opts.ephemeral,
    });
    return {
      result,
      meta: {
        transport: "exec-fallback",
        persistentSessionKey: sessionKey,
        appServerFallback: turn.fallback,
        appServerError: turn.error,
      },
    };
  }

  return {
    result: mapAppServerTurn(turn, opts.profile),
    meta: {
      transport: "app-server",
      persistentSessionKey: sessionKey,
      appServerFallback: turn.fallback,
      reusedProcess: turn.reusedProcess,
      reusedThread: turn.reusedThread,
      turnId: turn.turnId,
      note: "app-server failed after possible mutation boundary; no silent exec fallback",
    },
  };
}

export function registerCodexHeadlessTools(server: McpServer): void {
  server.registerTool(
    "codex_headless_review",
    {
      description:
        "Read-only Codex review via codex exec --profile review (default --ephemeral) --ignore-user-config --ignore-rules (gpt-5.6-sol, high; no global MCP/rules). Use review_uncommitted/review_base for built-in diff review, or prompt for custom scope. Set structured=true for reviewer-verdict JSON schema. JSONL capture + usage telemetry on by default.",
      inputSchema: {
        prompt: promptField,
        cwd: cwdField,
        structured: z.boolean().optional().default(false),
        review_uncommitted: z.boolean().optional().default(false),
        review_base: z.string().optional().describe("Base branch for codex exec review --base"),
        json: jsonField,
        jsonl_path: jsonlPathField,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ prompt, cwd, structured, review_uncommitted, review_base, json, jsonl_path }) =>
      toolResult(
        await runCodexExec({
          profile: "review",
          prompt,
          cwd,
          structured,
          reviewUncommitted: review_uncommitted,
          reviewBase: review_base,
          json,
          jsonlPath: jsonl_path,
        }),
      ),
  );

  server.registerTool(
    "codex_headless_implement",
    {
      description:
        "Codex implementation via codex exec (workspace-write; default --ephemeral). Default profile implement (gpt-5.6-luna, xhigh). Pass profile=engineer for gpt-5.6-sol high. Optional brief (typed change/files/writeScope; timeoutMs→maxWallMs). Optional ephemeral=false + resumeThreadId for exec resume. Optional persistentSessionKey for opt-in app-server reuse (not combined with resumeThreadId). Write-scope validation reported only when structured changed_files parse reliably — never enforced/rolled back. Legacy prompt-only calls unchanged.",
      inputSchema: {
        prompt: z.string().min(1).optional(),
        brief: briefField,
        cwd: cwdField,
        profile: z
          .enum(["implement", "engineer"])
          .optional()
          .default("implement")
          .describe("implement = Luna workers (default); engineer = Sol (planner / bounded edits)"),
        structured: z.boolean().optional().default(false),
        json: jsonField,
        jsonl_path: jsonlPathField,
        ephemeral: ephemeralField,
        resumeThreadId: resumeThreadIdField,
        persistentSessionKey: persistentSessionKeyField,
      },
      annotations: { destructiveHint: true },
    },
    async ({
      prompt,
      brief,
      cwd,
      profile,
      structured,
      json,
      jsonl_path,
      ephemeral,
      resumeThreadId,
      persistentSessionKey,
    }) => {
      try {
        assertSessionFlagsCompatible({
          resumeThreadId,
          persistentSessionKey,
          ephemeral,
        });
        const resolved = resolveImplementPromptInput({ prompt, brief });
        const sessionKey = persistentSessionKey?.trim();

        if (sessionKey) {
          const { result, meta } = await runViaAppServerOrExec({
            profile,
            prompt: resolved.prompt,
            cwd,
            persistentSessionKey: sessionKey,
            ephemeral,
            structured,
            json,
            jsonlPath: jsonl_path,
            maxWallMs: resolved.maxWallMs,
          });
          const scope = maybeValidateWriteScope(result, resolved.brief);
          return toolResult(result, { ...meta, ...scope });
        }

        const result = await runCodexExec({
          profile,
          prompt: resolved.prompt,
          cwd,
          structured,
          json,
          jsonlPath: jsonl_path,
          maxWallMs: resolved.maxWallMs,
          ephemeral,
          resumeThreadId: resumeThreadId?.trim() || undefined,
        });
        const scope = maybeValidateWriteScope(result, resolved.brief);
        return toolResult(result, { ...scope });
      } catch (err) {
        if (err instanceof McpInputError) return mcpErrorResult(err.message);
        throw err;
      }
    },
  );

  server.registerTool(
    "codex_headless_probe",
    {
      description:
        "Cheap Codex exploratory pass via codex exec --profile probe (default --ephemeral; gpt-5.6-luna, medium, read-only). Optional ephemeral=false + resumeThreadId for multi-step probe. Optional persistentSessionKey for opt-in app-server reuse (read-only; incompatible with resumeThreadId). Rerun on implement/review before shipping. JSONL + usage telemetry on by default.",
      inputSchema: {
        prompt: z.string().min(1),
        cwd: cwdField,
        json: jsonField,
        jsonl_path: jsonlPathField,
        ephemeral: ephemeralField,
        resumeThreadId: resumeThreadIdField,
        persistentSessionKey: persistentSessionKeyField,
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      prompt,
      cwd,
      json,
      jsonl_path,
      ephemeral,
      resumeThreadId,
      persistentSessionKey,
    }) => {
      try {
        assertSessionFlagsCompatible({
          resumeThreadId,
          persistentSessionKey,
          ephemeral,
        });
        const sessionKey = persistentSessionKey?.trim();
        if (sessionKey) {
          const { result, meta } = await runViaAppServerOrExec({
            profile: "probe",
            prompt,
            cwd,
            persistentSessionKey: sessionKey,
            ephemeral,
            json,
            jsonlPath: jsonl_path,
          });
          return toolResult(result, meta);
        }
        return toolResult(
          await runCodexExec({
            profile: "probe",
            prompt,
            cwd,
            json,
            jsonlPath: jsonl_path,
            ephemeral,
            resumeThreadId: resumeThreadId?.trim() || undefined,
          }),
        );
      } catch (err) {
        if (err instanceof McpInputError) return mcpErrorResult(err.message);
        throw err;
      }
    },
  );

  server.registerTool(
    "codex_headless_app_server_turn",
    {
      description:
        "Opt-in persistent Codex app-server turn (`codex app-server --listen stdio://`). Process singleton with 60s idle lease and one in-flight turn per sessionKey. Returns app-server fields (threadId/turnId/reused*). Does NOT fully normalize usage/JSONL/retrySafe to exec RunCodexResult — use default implement/probe exec path for that. On initialize failure before mutation, set fallbackToExec=true to run one-shot exec instead.",
      inputSchema: {
        prompt: z.string().min(1),
        sessionKey: z
          .string()
          .min(1)
          .describe("Stable session key (e.g. cwd|profile). Reuses thread when possible."),
        cwd: cwdField,
        profile: z
          .enum(["implement", "engineer", "probe", "review"])
          .optional()
          .default("implement"),
        ephemeral: z
          .boolean()
          .optional()
          .default(true)
          .describe("thread/start.ephemeral (default true)"),
        fallbackToExec: z
          .boolean()
          .optional()
          .default(false)
          .describe("If true, safe pre-mutation failures fall back to codex exec"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ prompt, sessionKey, cwd, profile, ephemeral, fallbackToExec }) => {
      const workDir = cwd ?? process.cwd();
      const threadStart = threadStartParamsForProfile(profile, {
        cwd: workDir,
        ephemeral,
      });
      const turn = await runPersistentTurn({
        sessionKey,
        input: [{ type: "text", text: prompt }],
        cwd: workDir,
        model: threadStart.model,
        threadStart,
      });

      if (
        !turn.ok &&
        fallbackToExec &&
        canSafelyFallbackToExec(turn.fallback, { turnId: turn.turnId })
      ) {
        const result = await runCodexExec({
          profile,
          prompt,
          cwd,
          ephemeral,
        });
        return toolResult(result, {
          transport: "exec-fallback",
          appServerFallback: turn.fallback,
          persistentSessionKey: sessionKey,
        });
      }

      const result = mapAppServerTurn(turn, profile);
      return {
        content: [
          {
            type: "text" as const,
            text: result.content,
          },
        ],
        structuredContent: {
          ...result,
          transport: "app-server",
          persistentSessionKey: sessionKey,
          turnId: turn.turnId,
          reusedProcess: turn.reusedProcess,
          reusedThread: turn.reusedThread,
          fallback: turn.fallback,
          error: turn.error,
        },
        ...(turn.ok ? {} : { isError: true as const }),
      };
    },
  );
}
