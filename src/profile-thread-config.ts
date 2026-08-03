/**
 * Map headless profiles → app-server `thread/start` params.
 * App-server CLI has no `-p` / `--profile`; overlays come from verified profile TOML.
 */

import type { HeadlessProfile } from "./run-codex.ts";
import type { ThreadStartParamsLite } from "./persistent-runner.ts";

export type ProfileThreadConfig = {
  model: string;
  /** model_reasoning_effort from profiles/*.config.toml — advisory in config overlay. */
  modelReasoningEffort: string;
  approvalPolicy: string;
  sandbox: string;
};

const PROFILE_CONFIG: Record<HeadlessProfile, ProfileThreadConfig> = {
  review: {
    model: "gpt-5.6-sol",
    modelReasoningEffort: "high",
    approvalPolicy: "never",
    sandbox: "read-only",
  },
  implement: {
    model: "gpt-5.6-luna",
    modelReasoningEffort: "xhigh",
    approvalPolicy: "never",
    sandbox: "workspace-write",
  },
  engineer: {
    model: "gpt-5.6-sol",
    modelReasoningEffort: "high",
    approvalPolicy: "never",
    sandbox: "workspace-write",
  },
  probe: {
    model: "gpt-5.6-luna",
    modelReasoningEffort: "medium",
    approvalPolicy: "never",
    sandbox: "read-only",
  },
};

export function getProfileThreadConfig(profile: HeadlessProfile): ProfileThreadConfig {
  return PROFILE_CONFIG[profile];
}

/**
 * Build `thread/start` params for a headless profile.
 * Does not invent unsupported CLI flags; uses ThreadStartParamsLite fields only.
 */
export function threadStartParamsForProfile(
  profile: HeadlessProfile,
  opts?: {
    cwd?: string;
    /** Default true (matches headless one-shot). Set false to persist server-side thread files. */
    ephemeral?: boolean;
  },
): ThreadStartParamsLite {
  const cfg = getProfileThreadConfig(profile);
  return {
    cwd: opts?.cwd ?? null,
    ephemeral: opts?.ephemeral !== false,
    approvalPolicy: cfg.approvalPolicy,
    sandbox: cfg.sandbox,
    model: cfg.model,
    config: {
      model_reasoning_effort: cfg.modelReasoningEffort,
    },
  };
}
