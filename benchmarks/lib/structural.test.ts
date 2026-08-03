import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runStructuralProofs } from "./structural.ts";

describe("structural proofs", () => {
  it("pass all four deterministic checks", () => {
    const proofs = runStructuralProofs();
    for (const id of ["1", "2", "3", "4"] as const) {
      const p = proofs[id];
      assert.equal(p.passed, true, `claim ${id} structural: ${p.notes.join("; ")}`);
    }
  });
});
