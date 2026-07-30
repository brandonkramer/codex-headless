/**
 * Never auto-retry after the run has committed (thread/tools started).
 * Duplicate retries after item.* can double-apply edits.
 */

export interface RetrySafetyState {
  /** Process spawned successfully. */
  spawned: boolean;
  /** Saw JSONL thread.started (session exists server-side). */
  sawThreadStarted: boolean;
  /** Saw item.started / item.completed (tools/edits may have run). */
  sawItemActivity: boolean;
}

export function updateRetrySafetyFromEvent(
  state: RetrySafetyState,
  kind: string,
): void {
  if (kind === "thread.started") state.sawThreadStarted = true;
  if (kind === "item.started" || kind === "item.completed") {
    state.sawItemActivity = true;
  }
}

/** True only for pre-commit failures (spawn fail / exit before thread.started). */
export function isRetrySafe(state: RetrySafetyState): boolean {
  if (!state.spawned) return true;
  if (state.sawThreadStarted) return false;
  if (state.sawItemActivity) return false;
  return true;
}
