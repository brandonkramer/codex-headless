import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getProfileThreadConfig,
  threadStartParamsForProfile,
} from "./profile-thread-config.ts";

describe("profile → thread/start mapping", () => {
  it("maps implement to luna + workspace-write", () => {
    const cfg = getProfileThreadConfig("implement");
    assert.equal(cfg.model, "gpt-5.6-luna");
    assert.equal(cfg.sandbox, "workspace-write");
    const params = threadStartParamsForProfile("implement", { cwd: "/r" });
    assert.equal(params.model, "gpt-5.6-luna");
    assert.equal(params.sandbox, "workspace-write");
    assert.equal(params.approvalPolicy, "never");
    assert.equal(params.ephemeral, true);
    assert.equal(params.cwd, "/r");
    assert.deepEqual(params.config, { model_reasoning_effort: "xhigh" });
  });

  it("maps review/probe to read-only", () => {
    assert.equal(threadStartParamsForProfile("review").sandbox, "read-only");
    assert.equal(threadStartParamsForProfile("probe").sandbox, "read-only");
  });

  it("honors ephemeral=false", () => {
    const params = threadStartParamsForProfile("engineer", { ephemeral: false });
    assert.equal(params.ephemeral, false);
    assert.equal(params.model, "gpt-5.6-sol");
  });
});
