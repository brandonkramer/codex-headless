/**
 * Shared MCP argument validation / brief wiring / write-scope reporting.
 */

import {
  assembleImplementPrompt,
  BriefValidationError,
  parseImplementBrief,
  validateWriteScope,
  type ImplementBriefInput,
  type ResolvedImplementBrief,
  type WriteScopeValidation,
} from "../implement-brief.ts";
import type { RunCodexResult } from "../run-codex.ts";

export class McpInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpInputError";
  }
}

export type ImplementPromptResolution = {
  prompt: string;
  brief: ResolvedImplementBrief | null;
  maxWallMs: number | undefined;
};

/** Require prompt and/or brief; assemble brief preamble when brief present. */
export function resolveImplementPromptInput(input: {
  prompt?: string;
  brief?: ImplementBriefInput | null;
}): ImplementPromptResolution {
  const promptTrimmed = input.prompt?.trim() ?? "";
  const hasPrompt = promptTrimmed.length > 0;
  const hasBrief = input.brief != null;

  if (!hasPrompt && !hasBrief) {
    throw new McpInputError("provide prompt and/or brief (at least one required)");
  }

  if (!hasBrief) {
    return { prompt: promptTrimmed, brief: null, maxWallMs: undefined };
  }

  let brief: ResolvedImplementBrief;
  try {
    brief = parseImplementBrief(input.brief);
  } catch (err) {
    if (err instanceof BriefValidationError) {
      throw new McpInputError(`brief.${err.field}: ${err.message}`);
    }
    throw err;
  }

  const assembled = assembleImplementPrompt(
    brief,
    hasPrompt ? promptTrimmed : undefined,
  );
  const maxWallMs = brief.timeoutMs > 0 ? brief.timeoutMs : undefined;
  return { prompt: assembled, brief, maxWallMs };
}

/**
 * Reject incompatible session controls.
 * Explicit exec resume + app-server session key are undefined together.
 */
export function assertSessionFlagsCompatible(flags: {
  resumeThreadId?: string;
  persistentSessionKey?: string;
  ephemeral?: boolean;
}): void {
  const resume = flags.resumeThreadId?.trim();
  const sessionKey = flags.persistentSessionKey?.trim();
  if (resume && sessionKey) {
    throw new McpInputError(
      "resumeThreadId cannot combine with persistentSessionKey (undefined semantics)",
    );
  }
  if (resume && flags.ephemeral === true) {
    throw new McpInputError("resumeThreadId is incompatible with ephemeral=true");
  }
}

/** Parse implement-report JSON for changed_files when reliably present. */
export function extractChangedFilesFromContent(
  content: string,
): string[] | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const changed = (parsed as { changed_files?: unknown }).changed_files;
    if (!Array.isArray(changed)) return null;
    if (!changed.every((x): x is string => typeof x === "string")) return null;
    return changed;
  } catch {
    return null;
  }
}

export type WriteScopeReport = {
  /** Present only when changed files were derived from structured report JSON. */
  writeScopeValidation?: WriteScopeValidation & {
    /** Honest: validation only — never enforcement or rollback. */
    enforced: false;
    rolledBack: false;
  };
  writeScopeSkippedReason?: string;
};

/**
 * Attach write-scope validation only when changed_files are reliably parseable.
 * Never claims enforcement or rollback.
 */
export function maybeValidateWriteScope(
  result: RunCodexResult,
  brief: ResolvedImplementBrief | null,
): WriteScopeReport {
  if (!brief) return {};
  if (!result.ok) {
    return {
      writeScopeSkippedReason: "run failed; write-scope not evaluated",
    };
  }
  const changed = extractChangedFilesFromContent(result.content);
  if (!changed) {
    return {
      writeScopeSkippedReason:
        "changed_files not reliably derived from structured report; write-scope not evaluated",
    };
  }
  const validation = validateWriteScope(changed, brief.writeScope);
  return {
    writeScopeValidation: {
      ...validation,
      enforced: false,
      rolledBack: false,
    },
  };
}

export function mcpErrorResult(message: string): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}
