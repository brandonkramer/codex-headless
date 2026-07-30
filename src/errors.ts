/**
 * Redact secrets and bound error detail before surfacing to orchestrators.
 */

const SECRET_PATTERNS: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT-ish
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
  /\bOPENAI_API_KEY\s*=\s*\S+/gi,
  /\bAuthorization:\s*\S+/gi,
];

const MAX_ERROR_CHARS = 500;

export function sanitizeErrorBody(body: string): string {
  let out = body.trim();
  if (!out) return "";
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[redacted]");
  }
  // Strip most control chars (keep \n \t)
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (out.length > MAX_ERROR_CHARS) {
    out = `${out.slice(0, MAX_ERROR_CHARS)}…[truncated]`;
  }
  return out;
}

export function formatCodexFailure(opts: {
  exitCode: number;
  stderr: string;
  turnError?: string;
  killReason?: KillReason;
}): string {
  if (opts.killReason === "quiet") {
    return `codex hang: no progress (quiet timeout); exit=${opts.exitCode}`;
  }
  if (opts.killReason === "wall") {
    return `codex hang: wall-clock timeout; exit=${opts.exitCode}`;
  }
  const turn = opts.turnError?.trim();
  if (turn) {
    return sanitizeErrorBody(`turn.failed: ${turn}`);
  }
  const stderr = sanitizeErrorBody(opts.stderr);
  if (stderr) return stderr;
  return `codex exited ${opts.exitCode}`;
}

export type KillReason = "quiet" | "wall";
