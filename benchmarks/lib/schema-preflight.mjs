/**
 * Preflight gate: abort expensive benchmark runs when structured schemas would be rejected.
 * Dry-run: local Codex-strict validation of the schema file runCodexExec will pass.
 * Live: one minimal structured provider call per profile (review | implement).
 *
 * Resolution mirrors src/schema.ts resolveStructuredSchema (bundled-first; opt-in user override).
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../review-brief-metrics.mjs'

/** @typedef {'review'|'implement'} SchemaKind */

const SCHEMA_SET_VERSION = 1

const SCHEMA_FILES = {
  review: 'reviewer-verdict.schema.json',
  implement: 'implement-report.schema.json',
}

function schemaOverrideEnabled() {
  const raw = process.env.CODEX_HEADLESS_SCHEMA_OVERRIDE?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function codexHomeDir() {
  return process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
}

function bundledSchemaPath(kind) {
  return join(PLUGIN_ROOT, 'schemas', SCHEMA_FILES[kind])
}

function userSchemaPath(kind) {
  return join(codexHomeDir(), 'schemas', SCHEMA_FILES[kind])
}

function userSchemaVersionPath() {
  return join(codexHomeDir(), 'schemas', '.codex-headless-version')
}

function readUserSchemaVersion() {
  const path = userSchemaVersionPath()
  if (!existsSync(path)) return undefined
  const raw = readFileSync(path, 'utf8').trim()
  const version = Number.parseInt(raw, 10)
  return Number.isFinite(version) ? version : undefined
}

/**
 * Mirror src/schema.ts resolveStructuredSchema without importing production code (sync for dry-run tests).
 * @param {SchemaKind} kind
 * @returns {{ path: string, source: 'bundled'|'user'|'missing', overrideEnabled: boolean }}
 */
export function resolveEffectiveSchemaPath(kind) {
  const bundled = bundledSchemaPath(kind)
  const overrideEnabled = schemaOverrideEnabled()

  if (!existsSync(bundled)) {
    return { path: bundled, source: 'missing', overrideEnabled }
  }

  if (!overrideEnabled) {
    return { path: bundled, source: 'bundled', overrideEnabled }
  }

  const userPath = userSchemaPath(kind)
  if (!existsSync(userPath)) {
    return { path: bundled, source: 'bundled', overrideEnabled }
  }

  const userVersion = readUserSchemaVersion()
  if (userVersion !== SCHEMA_SET_VERSION) {
    return {
      path: userPath,
      source: 'user',
      overrideEnabled,
      versionMismatch: true,
      expectedVersion: SCHEMA_SET_VERSION,
      foundVersion: userVersion ?? null,
    }
  }

  return { path: userPath, source: 'user', overrideEnabled }
}

/**
 * Codex 0.146 strict rule: every properties key must appear in required[] at each object node.
 * @param {unknown} node
 * @param {string[]} pathParts
 * @returns {string[]}
 */
export function codexStrictSchemaViolations(node, pathParts = []) {
  /** @type {string[]} */
  const out = []
  if (!node || typeof node !== 'object' || Array.isArray(node)) return out
  const obj = /** @type {Record<string, unknown>} */ (node)

  if (obj.type === 'object') {
    if (obj.additionalProperties !== false) {
      const ctx = pathParts.length ? `(${pathParts.join(', ')})` : '()'
      out.push(`In context=${ctx}, object must set additionalProperties: false.`)
    }
    if (obj.properties && typeof obj.properties === 'object') {
      const props = /** @type {Record<string, unknown>} */ (obj.properties)
      const propKeys = Object.keys(props)
      const req = Array.isArray(obj.required) ? obj.required.map(String) : []
      const ctx = pathParts.length ? `(${pathParts.join(', ')})` : '()'
      if (!Array.isArray(obj.required)) {
        out.push(`In context=${ctx}, 'required' must be supplied and be an array.`)
      }
      for (const key of propKeys) {
        if (!req.includes(key)) {
          out.push(`In context=${ctx}, 'required' must include every properties key. Missing '${key}'.`)
        }
      }
      for (const key of propKeys) {
        out.push(...codexStrictSchemaViolations(props[key], [...pathParts, 'properties', key]))
      }
    }
  }

  if (obj.type === 'array' && obj.items) {
    out.push(...codexStrictSchemaViolations(obj.items, [...pathParts, 'items']))
  }

  if (Array.isArray(obj.type)) {
    for (const branch of obj.type) {
      if (typeof branch === 'string' && branch !== 'null') {
        out.push(...codexStrictSchemaViolations({ ...obj, type: branch }, pathParts))
      }
    }
  }

  for (const comb of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(obj[comb])) {
      for (let i = 0; i < obj[comb].length; i++) {
        out.push(...codexStrictSchemaViolations(obj[comb][i], [...pathParts, comb, String(i)]))
      }
    }
  }

  if (obj.$defs && typeof obj.$defs === 'object') {
    for (const [name, def] of Object.entries(obj.$defs)) {
      out.push(...codexStrictSchemaViolations(def, [...pathParts, '$defs', name]))
    }
  }

  if (obj.definitions && typeof obj.definitions === 'object') {
    for (const [name, def] of Object.entries(obj.definitions)) {
      out.push(...codexStrictSchemaViolations(def, [...pathParts, 'definitions', name]))
    }
  }

  return out
}

/**
 * @param {SchemaKind} kind
 */
export function loadBundledSchemaValidation(kind) {
  const path = bundledSchemaPath(kind)
  if (!existsSync(path)) {
    return { ok: false, kind, path, source: 'bundled', violations: [`missing bundled schema: ${path}`] }
  }
  const schema = JSON.parse(readFileSync(path, 'utf8'))
  const violations = codexStrictSchemaViolations(schema)
  return { ok: violations.length === 0, kind, path, source: 'bundled', violations }
}

/**
 * Validate the exact schema path runCodexExec would pass (bundled-first unless override enabled).
 * @param {SchemaKind} kind
 */
export function loadAndValidateSchema(kind) {
  const resolved = resolveEffectiveSchemaPath(kind)

  if (resolved.source === 'missing') {
    return {
      ok: false,
      kind,
      ...resolved,
      violations: [`bundled schema missing: ${resolved.path}`],
    }
  }

  if (resolved.versionMismatch) {
    return {
      ok: false,
      kind,
      ...resolved,
      violations: [
        `schema override requires ${userSchemaVersionPath()}=${SCHEMA_SET_VERSION} ` +
          `(found ${resolved.foundVersion ?? 'missing'}). ` +
          `Fix: bash scripts/install.sh or unset CODEX_HEADLESS_SCHEMA_OVERRIDE to use bundled schemas.`,
      ],
    }
  }

  if (!existsSync(resolved.path)) {
    return {
      ok: false,
      kind,
      ...resolved,
      violations: [`schema file missing: ${resolved.path}`],
    }
  }

  let schema
  try {
    schema = JSON.parse(readFileSync(resolved.path, 'utf8'))
  } catch (err) {
    return {
      ok: false,
      kind,
      ...resolved,
      violations: [`schema parse error: ${err instanceof Error ? err.message : String(err)}`],
    }
  }

  const violations = codexStrictSchemaViolations(schema)
  return { ok: violations.length === 0, kind, ...resolved, violations }
}

/**
 * @param {{ kinds?: SchemaKind[], dryRun?: boolean, cwd?: string, maxWallMs?: number }} opts
 */
export async function runSchemaPreflight(opts = {}) {
  const kinds = opts.kinds ?? ['review', 'implement']
  const dryRun = Boolean(opts.dryRun)
  /** @type {object[]} */
  const checks = []

  for (const kind of kinds) {
    const bundled = loadBundledSchemaValidation(kind)
    checks.push({ phase: 'bundled_strict', ...bundled })
    const effective = loadAndValidateSchema(kind)
    checks.push({ phase: 'effective_strict', ...effective })
    if (!effective.ok) continue

    if (!dryRun) {
      const live = await liveSchemaProbe(kind, {
        cwd: opts.cwd || process.cwd(),
        maxWallMs: opts.maxWallMs ?? 60_000,
      })
      checks.push({ phase: 'live_probe', kind, ...live })
    }
  }

  const failed = checks.filter(c => c.ok === false)
  return {
    ok: failed.length === 0,
    dryRun,
    checks,
    failed,
  }
}

/**
 * One minimal structured call to confirm provider accepts the schema.
 * Uses runCodexExec so the schema path matches production exactly.
 * @param {SchemaKind} kind
 * @param {{ cwd: string, maxWallMs: number }} opts
 */
async function liveSchemaProbe(kind, opts) {
  const { runCodexExec } = await import('../../src/run-codex.ts')
  const { resolveStructuredSchema } = await import('../../src/schema.ts')
  const schemaPath = resolveStructuredSchema(kind)
  const jsonlPath = join(opts.cwd, `.schema-preflight-${kind}.jsonl`)
  const profile = kind === 'review' ? 'review' : 'engineer'
  const prompt =
    kind === 'review'
      ? 'Schema preflight only. Return verdict=inconclusive, empty findings/tests, summary="preflight".'
      : 'Schema preflight only. Return changed_files=[], summary="preflight", risks=[], recommended_verification=[].'

  const result = await runCodexExec({
    profile,
    prompt,
    cwd: opts.cwd,
    structured: true,
    json: true,
    jsonlPath,
    maxWallMs: opts.maxWallMs,
    ephemeral: true,
    onProgress: () => {},
  })

  const jsonlText = existsSync(jsonlPath) ? readFileSync(jsonlPath, 'utf8') : ''
  const { detectJsonlInvalidity } = await import('./trial-validity.mjs')
  const validity = detectJsonlInvalidity(jsonlText)

  return {
    ok: result.ok && validity.valid,
    profile,
    schemaPath,
    exitCode: result.exitCode,
    turnError: result.turnError,
    validity,
  }
}
