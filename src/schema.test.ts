import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  bundledSchemaPath,
  SCHEMA_SET_VERSION,
  schemaOverrideEnabled,
  StructuredSchemaError,
  validateStrictJsonSchema,
  resolveStructuredSchema,
} from "./schema.ts";

describe("validateStrictJsonSchema", () => {
  it("accepts bundled reviewer-verdict schema", async () => {
    const schema = JSON.parse(await readFile(bundledSchemaPath("review"), "utf8"));
    assert.deepEqual(validateStrictJsonSchema(schema), []);
  });

  it("accepts bundled implement-report schema", async () => {
    const schema = JSON.parse(await readFile(bundledSchemaPath("implement"), "utf8"));
    assert.deepEqual(validateStrictJsonSchema(schema), []);
  });

  it("rejects object missing required property keys", () => {
    const issues = validateStrictJsonSchema({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "string" },
      },
      required: ["a"],
      additionalProperties: false,
    });
    assert.ok(issues.some((i) => i.message.includes("Missing 'b'")));
  });

  it("rejects nested object missing required property keys", () => {
    const issues = validateStrictJsonSchema({
      type: "object",
      properties: {
        tests: {
          type: "array",
          items: {
            type: "object",
            properties: {
              command: { type: "string" },
              output_snippet: { type: "string" },
            },
            required: ["command"],
            additionalProperties: false,
          },
        },
      },
      required: ["tests"],
      additionalProperties: false,
    });
    assert.ok(
      issues.some(
        (i) =>
          i.context.includes("tests") &&
          i.context.includes("items") &&
          i.message.includes("output_snippet"),
      ),
    );
  });

  it("rejects object without additionalProperties: false", () => {
    const issues = validateStrictJsonSchema({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
    });
    assert.ok(
      issues.some((i) => i.message.includes("additionalProperties: false")),
    );
  });
});

describe("resolveStructuredSchema", () => {
  const priorOverride = process.env.CODEX_HEADLESS_SCHEMA_OVERRIDE;
  const priorHome = process.env.CODEX_HOME;

  before(() => {
    delete process.env.CODEX_HEADLESS_SCHEMA_OVERRIDE;
  });

  after(() => {
    if (priorOverride === undefined) {
      delete process.env.CODEX_HEADLESS_SCHEMA_OVERRIDE;
    } else {
      process.env.CODEX_HEADLESS_SCHEMA_OVERRIDE = priorOverride;
    }
    if (priorHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = priorHome;
    }
  });

  it("defaults to bundled schema when override is disabled", () => {
    assert.equal(schemaOverrideEnabled(), false);
    const path = resolveStructuredSchema("review");
    assert.equal(path, bundledSchemaPath("review"));
  });

  it("rejects stale user schema when override is enabled", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-home-stale-"));
    process.env.CODEX_HOME = codexHome;
    process.env.CODEX_HEADLESS_SCHEMA_OVERRIDE = "1";

    const staleImplement = {
      type: "object",
      properties: {
        changed_files: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
        risks: { type: "array", items: { type: "string" } },
        recommended_verification: { type: "array", items: { type: "string" } },
      },
      required: ["changed_files", "summary", "risks"],
      additionalProperties: false,
    };

    await mkdir(join(codexHome, "schemas"), { recursive: true });
    await writeFile(
      join(codexHome, "schemas", ".codex-headless-version"),
      `${SCHEMA_SET_VERSION}\n`,
      "utf8",
    );
    await writeFile(
      join(codexHome, "schemas", "implement-report.schema.json"),
      JSON.stringify(staleImplement),
      "utf8",
    );

    try {
      assert.throws(
        () => resolveStructuredSchema("implement"),
        (err: unknown) => {
          if (!(err instanceof StructuredSchemaError)) return false;
          assert.match(err.message, /recommended_verification/);
          assert.match(err.message, /install\.sh/);
          return true;
        },
      );
    } finally {
      await rm(codexHome, { recursive: true, force: true });
      delete process.env.CODEX_HOME;
      delete process.env.CODEX_HEADLESS_SCHEMA_OVERRIDE;
    }
  });

  it("uses valid user override when explicitly enabled", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-home-valid-"));
    process.env.CODEX_HOME = codexHome;
    process.env.CODEX_HEADLESS_SCHEMA_OVERRIDE = "1";

    const bundled = JSON.parse(await readFile(bundledSchemaPath("review"), "utf8"));

    await mkdir(join(codexHome, "schemas"), { recursive: true });
    await writeFile(
      join(codexHome, "schemas", ".codex-headless-version"),
      `${SCHEMA_SET_VERSION}\n`,
      "utf8",
    );
    const userPath = join(codexHome, "schemas", "reviewer-verdict.schema.json");
    await writeFile(userPath, JSON.stringify(bundled), "utf8");

    try {
      assert.equal(resolveStructuredSchema("review"), userPath);
    } finally {
      await rm(codexHome, { recursive: true, force: true });
      delete process.env.CODEX_HOME;
      delete process.env.CODEX_HEADLESS_SCHEMA_OVERRIDE;
    }
  });
});
