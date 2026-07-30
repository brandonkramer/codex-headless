import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runCodexExec } from "../../run-codex.ts";

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
  .describe("Optional path to write the full JSONL event stream");

function toolResult(result: Awaited<ReturnType<typeof runCodexExec>>) {
  const usageNote = result.usage
    ? `\n\n---\nusage: input=${result.usage.input_tokens} cached=${result.usage.cached_input_tokens} output=${result.usage.output_tokens} reasoning=${result.usage.reasoning_output_tokens}`
    : "";
  return {
    content: [{ type: "text" as const, text: `${result.content}${usageNote}` }],
    structuredContent: { ...result },
  };
}

export function registerCodexHeadlessTools(server: McpServer): void {
  server.registerTool(
    "codex_headless_review",
    {
      description:
        "Read-only Codex review via codex exec --profile review --ephemeral --ignore-user-config --ignore-rules (gpt-5.6-sol, high; no global MCP/rules). Use review_uncommitted/review_base for built-in diff review, or prompt for custom scope. Set structured=true for reviewer-verdict JSON schema. JSONL capture + usage telemetry on by default.",
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
        "Codex implementation via codex exec --profile implement --ephemeral (gpt-5.6-luna, xhigh, workspace-write). Set structured=true for implement-report JSON schema. JSONL + usage telemetry on by default.",
      inputSchema: {
        prompt: z.string().min(1),
        cwd: cwdField,
        structured: z.boolean().optional().default(false),
        json: jsonField,
        jsonl_path: jsonlPathField,
      },
      annotations: { destructiveHint: true },
    },
    async ({ prompt, cwd, structured, json, jsonl_path }) =>
      toolResult(
        await runCodexExec({
          profile: "implement",
          prompt,
          cwd,
          structured,
          json,
          jsonlPath: jsonl_path,
        }),
      ),
  );

  server.registerTool(
    "codex_headless_probe",
    {
      description:
        "Cheap Codex exploratory pass via codex exec --profile probe --ephemeral (gpt-5.6-luna, medium, read-only). Rerun on implement/review before shipping. JSONL + usage telemetry on by default.",
      inputSchema: {
        prompt: z.string().min(1),
        cwd: cwdField,
        json: jsonField,
        jsonl_path: jsonlPathField,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ prompt, cwd, json, jsonl_path }) =>
      toolResult(
        await runCodexExec({
          profile: "probe",
          prompt,
          cwd,
          json,
          jsonlPath: jsonl_path,
        }),
      ),
  );
}
