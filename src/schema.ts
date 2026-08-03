import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type StructuredSchemaKind = "review" | "implement";

/** Bump when bundled schema shape changes; override sidecar must match. */
export const SCHEMA_SET_VERSION = 1;

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const STRUCTURED_SCHEMA_FILES: Record<StructuredSchemaKind, string> = {
  review: "reviewer-verdict.schema.json",
  implement: "implement-report.schema.json",
};

export interface StrictSchemaIssue {
  context: string;
  message: string;
}

export class StructuredSchemaError extends Error {
  readonly kind: StructuredSchemaKind;
  readonly schemaPath: string;
  readonly issues: StrictSchemaIssue[];

  constructor(
    kind: StructuredSchemaKind,
    schemaPath: string,
    message: string,
    issues: StrictSchemaIssue[] = [],
  ) {
    super(message);
    this.name = "StructuredSchemaError";
    this.kind = kind;
    this.schemaPath = schemaPath;
    this.issues = issues;
  }
}

export function pluginSchemaDir(): string {
  return join(PLUGIN_ROOT, "schemas");
}

export function bundledSchemaPath(kind: StructuredSchemaKind): string {
  return join(pluginSchemaDir(), STRUCTURED_SCHEMA_FILES[kind]);
}

export function userSchemaDir(): string {
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  return join(codexHome, "schemas");
}

export function userSchemaPath(kind: StructuredSchemaKind): string {
  return join(userSchemaDir(), STRUCTURED_SCHEMA_FILES[kind]);
}

export function userSchemaVersionPath(): string {
  return join(userSchemaDir(), ".codex-headless-version");
}

export function schemaOverrideEnabled(): boolean {
  const raw = process.env.CODEX_HEADLESS_SCHEMA_OVERRIDE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function formatContext(context: string[]): string {
  if (context.length === 0) return "()";
  return `(${context.map((part) => `'${part}'`).join(", ")})`;
}

function readJsonSchema(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new StructuredSchemaError(
      "review",
      path,
      `schema file is not valid JSON: ${path} (${detail})`,
    );
  }
}

/**
 * Codex / OpenAI strict JSON-schema rules (recursive):
 * - object nodes need properties, required listing every property key, additionalProperties: false
 * - array nodes validate items when present
 */
export function validateStrictJsonSchema(
  schema: unknown,
  context: string[] = [],
): StrictSchemaIssue[] {
  const issues: StrictSchemaIssue[] = [];
  const ctx = formatContext(context);

  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    issues.push({ context: ctx, message: "schema node must be an object" });
    return issues;
  }

  const node = schema as Record<string, unknown>;
  const type = node.type;

  if (type === "object") {
    if (node.additionalProperties !== false) {
      issues.push({
        context: ctx,
        message: "object must set additionalProperties: false",
      });
    }

    const properties = node.properties;
    if (
      typeof properties !== "object" ||
      properties === null ||
      Array.isArray(properties)
    ) {
      issues.push({ context: ctx, message: "object must define properties" });
      return issues;
    }

    const propKeys = Object.keys(properties);
    const required = node.required;
    if (!Array.isArray(required)) {
      issues.push({
        context: ctx,
        message: "'required' must be supplied and be an array",
      });
    } else {
      const requiredSet = new Set(
        required.filter((key): key is string => typeof key === "string"),
      );
      for (const key of propKeys) {
        if (!requiredSet.has(key)) {
          issues.push({
            context: ctx,
            message: `'required' must include every key in properties. Missing '${key}'.`,
          });
        }
      }
    }

    for (const [key, subschema] of Object.entries(properties)) {
      issues.push(
        ...validateStrictJsonSchema(subschema, [...context, "properties", key]),
      );
    }
    return issues;
  }

  if (type === "array") {
    if (node.items !== undefined) {
      issues.push(
        ...validateStrictJsonSchema(node.items, [...context, "items"]),
      );
    }
    return issues;
  }

  if (Array.isArray(type)) {
    for (const branch of type) {
      if (typeof branch === "string" && branch !== "null") {
        issues.push(
          ...validateStrictJsonSchema({ ...node, type: branch }, context),
        );
      }
    }
  }

  return issues;
}

function assertBundledSchemaValid(kind: StructuredSchemaKind, path: string): void {
  const schema = readJsonSchema(path);
  const issues = validateStrictJsonSchema(schema);
  if (issues.length === 0) return;

  const detail = issues.map((i) => `${i.context}: ${i.message}`).join("; ");
  throw new StructuredSchemaError(
    kind,
    path,
    `bundled schema failed strict validation: ${path} (${detail})`,
    issues,
  );
}

function readUserSchemaVersion(): number | undefined {
  const path = userSchemaVersionPath();
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, "utf8").trim();
  const version = Number.parseInt(raw, 10);
  return Number.isFinite(version) ? version : undefined;
}

function formatOverrideHelp(kind: StructuredSchemaKind): string {
  return (
    `Fix: bash scripts/install.sh (updates ${userSchemaDir()}/) ` +
    `or unset CODEX_HEADLESS_SCHEMA_OVERRIDE to use bundled plugin schemas. ` +
    `Bundled ${STRUCTURED_SCHEMA_FILES[kind]} is at ${bundledSchemaPath(kind)}.`
  );
}

function resolveUserOverride(kind: StructuredSchemaKind, bundledPath: string): string {
  const userPath = userSchemaPath(kind);
  if (!existsSync(userPath)) return bundledPath;

  const userVersion = readUserSchemaVersion();
  if (userVersion !== SCHEMA_SET_VERSION) {
    throw new StructuredSchemaError(
      kind,
      userPath,
      `schema override requires ${userSchemaVersionPath()}=${SCHEMA_SET_VERSION} ` +
        `(found ${userVersion ?? "missing"}). ${formatOverrideHelp(kind)}`,
    );
  }

  const schema = readJsonSchema(userPath);
  const issues = validateStrictJsonSchema(schema);
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.context}: ${i.message}`).join("; ");
    throw new StructuredSchemaError(
      kind,
      userPath,
      `schema override failed Codex strict validation: ${userPath} (${detail}). ${formatOverrideHelp(kind)}`,
      issues,
    );
  }

  return userPath;
}

/**
 * Resolve JSON schema path for structured Codex output.
 * Default: bundled plugin schema (deterministic, validated).
 * Opt-in override: CODEX_HEADLESS_SCHEMA_OVERRIDE=1 + version sidecar + strict-valid user file.
 */
export function resolveStructuredSchema(kind: StructuredSchemaKind): string {
  const bundledPath = bundledSchemaPath(kind);
  if (!existsSync(bundledPath)) {
    throw new StructuredSchemaError(
      kind,
      bundledPath,
      `bundled schema missing: ${bundledPath}`,
    );
  }

  assertBundledSchemaValid(kind, bundledPath);

  if (!schemaOverrideEnabled()) {
    return bundledPath;
  }

  return resolveUserOverride(kind, bundledPath);
}
