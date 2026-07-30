import type { KillReason } from "./errors.ts";

/** Default soft hang: 10 minutes with no progress (matches orchestrated-review SSOT). */
export const DEFAULT_MAX_QUIET_MS = 10 * 60 * 1000;

/** Disabled by default; set per-run for hard CI caps. */
export const DEFAULT_MAX_WALL_MS = 0;

export interface HangLimits {
  /** Kill if no JSONL/stderr progress for this long. 0 = disabled. */
  maxQuietMs: number;
  /** Kill if total wall time exceeds this. 0 = disabled. */
  maxWallMs: number;
}

export function resolveHangLimits(opts?: {
  maxQuietMs?: number;
  maxWallMs?: number;
}): HangLimits {
  return {
    maxQuietMs: opts?.maxQuietMs ?? DEFAULT_MAX_QUIET_MS,
    maxWallMs: opts?.maxWallMs ?? DEFAULT_MAX_WALL_MS,
  };
}

/** Pure decision — used by watcher + unit tests (prove quiet/wall triggers). */
export function shouldKillHang(
  now: number,
  startedAt: number,
  lastEventAt: number,
  limits: HangLimits,
): KillReason | null {
  if (limits.maxWallMs > 0 && now - startedAt >= limits.maxWallMs) {
    return "wall";
  }
  if (limits.maxQuietMs > 0 && now - lastEventAt >= limits.maxQuietMs) {
    return "quiet";
  }
  return null;
}

/**
 * How much wall time a hung process wastes without kill vs with kill.
 * Pure arithmetic for the proof test.
 */
export function hangWasteMs(opts: {
  hungForMs: number;
  maxQuietMs: number;
}): { withoutKillMs: number; withKillMs: number; savedMs: number } {
  const withKillMs = Math.min(opts.hungForMs, opts.maxQuietMs);
  const withoutKillMs = opts.hungForMs;
  return {
    withoutKillMs,
    withKillMs,
    savedMs: Math.max(0, withoutKillMs - withKillMs),
  };
}
