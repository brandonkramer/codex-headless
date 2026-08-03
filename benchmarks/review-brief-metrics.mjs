/**
 * Shared metrics helpers for review-fanout + brief-efficiency paired trials.
 * Distinct filename to avoid colliding with a general benchmarks/ harness.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const BENCHMARKS_ROOT = HERE
export const PLUGIN_ROOT = join(HERE, '..')

/** @typedef {{ input_tokens: number, cached_input_tokens: number, output_tokens: number, reasoning_output_tokens: number }} Usage */

/**
 * Mulberry32 PRNG — deterministic shuffle for AB/BA order.
 * @param {number} seed
 */
export function mulberry32(seed) {
  let t = seed >>> 0
  return function next() {
    t += 0x6d2b79f5
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @template T
 * @param {T[]} items
 * @param {() => number} rng
 */
export function shuffleInPlace(items, rng) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/**
 * Per-trial arm order: AB or BA.
 * @param {number} trialIndex
 * @param {number} seed
 * @param {string} armA
 * @param {string} armB
 */
export function armOrderForTrial(trialIndex, seed, armA, armB) {
  const rng = mulberry32((seed + trialIndex * 9973) >>> 0)
  return rng() < 0.5 ? [armA, armB] : [armB, armA]
}

/**
 * @param {number[]} values
 */
export function median(values) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

/**
 * Percentile with linear interpolation (p in [0,100]).
 * @param {number[]} values
 * @param {number} p
 */
export function percentile(values, p) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  if (s.length === 1) return s[0]
  const rank = (p / 100) * (s.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return s[lo]
  const w = rank - lo
  return s[lo] * (1 - w) + s[hi] * w
}

/**
 * Naive bootstrap CI for the median difference (B samples).
 * @param {number[]} a
 * @param {number[]} b
 * @param {number} [B]
 * @param {number} [seed]
 */
export function bootstrapMedianDiffCI(a, b, B = 1000, seed = 1) {
  if (!a.length || !b.length) {
    return { diff: null, lo: null, hi: null, B: 0 }
  }
  const rng = mulberry32(seed)
  /** @param {number[]} arr */
  const sample = arr => {
    const out = []
    for (let i = 0; i < arr.length; i++) out.push(arr[Math.floor(rng() * arr.length)])
    return median(out)
  }
  const diffs = []
  for (let i = 0; i < B; i++) {
    const ma = sample(a)
    const mb = sample(b)
    if (ma == null || mb == null) continue
    diffs.push(mb - ma)
  }
  const diff = (median(b) ?? 0) - (median(a) ?? 0)
  return {
    diff,
    lo: percentile(diffs, 2.5),
    hi: percentile(diffs, 97.5),
    B: diffs.length,
  }
}

/**
 * Count provider turns + tool-like items from Codex JSONL text.
 * @param {string} jsonlText
 */
export function summarizeJsonlMetrics(jsonlText) {
  const lines = String(jsonlText || '').split(/\r?\n/).filter(l => l.trim())
  let turns = 0
  let toolLike = 0
  /** @type {string[]} */
  const toolSummaries = []
  /** @type {Usage} */
  const usage = {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  }
  let usageReported = false
  let threadId
  let firstEventMs = null
  let lastAgentMessage = ''

  for (const line of lines) {
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (!obj || typeof obj !== 'object') continue
    const type = obj.type
    if (type === 'thread.started' && typeof obj.thread_id === 'string') {
      threadId = obj.thread_id
    }
    if (type === 'turn.completed') {
      turns += 1
      if (Object.prototype.hasOwnProperty.call(obj, 'usage') && obj.usage) {
        usageReported = true
        const u = obj.usage
        usage.input_tokens += Number(u.input_tokens) || 0
        usage.cached_input_tokens += Number(u.cached_input_tokens) || 0
        usage.output_tokens += Number(u.output_tokens) || 0
        usage.reasoning_output_tokens += Number(u.reasoning_output_tokens) || 0
      }
    }
    if (type === 'item.started' || type === 'item.completed') {
      if (firstEventMs == null) firstEventMs = Date.now()
      const item = obj.item && typeof obj.item === 'object' ? obj.item : null
      const itemType = item && typeof item.type === 'string' ? item.type : ''
      if (
        itemType === 'command_execution' ||
        itemType === 'mcp_tool_call' ||
        itemType === 'file_change'
      ) {
        if (type === 'item.completed') {
          toolLike += 1
          const summary =
            itemType === 'command_execution' && typeof item.command === 'string'
              ? `command:${item.command.slice(0, 160)}`
              : itemType === 'mcp_tool_call' && typeof item.tool === 'string'
                ? `mcp:${item.tool}`
                : itemType
          toolSummaries.push(summary)
        }
      }
      if (
        type === 'item.completed' &&
        itemType === 'agent_message' &&
        typeof item.text === 'string' &&
        item.text.trim()
      ) {
        lastAgentMessage = item.text
      }
    }
  }

  return {
    turns,
    toolLike,
    toolSummaries,
    usage: usageReported ? usage : null,
    usageReported,
    threadId,
    lastAgentMessage,
    lineCount: lines.length,
  }
}

/**
 * Scheduling models from sequential stage walls.
 * @param {{ prepMs?: number, stageMs: number[] }} parts
 */
export function schedulingFromStages(parts) {
  const prepMs = Math.max(0, Number(parts.prepMs) || 0)
  const stageMs = (parts.stageMs || []).map(n => Math.max(0, Number(n) || 0))
  const sum = stageMs.reduce((a, b) => a + b, 0)
  const max = stageMs.length ? Math.max(...stageMs) : 0
  return {
    provider_work_ms: prepMs + sum,
    user_latency_ms_parallel_model: prepMs + max,
    prep_ms: prepMs,
    stage_ms: stageMs,
  }
}

/**
 * @param {number} trials
 */
export function evidenceLabel(trials) {
  return trials < 5 ? 'exploratory' : 'confirmatory'
}

/**
 * @param {string} label
 * @param {number} trials
 */
export function withEvidenceSuffix(label, trials) {
  return trials < 5 ? `${label}_EXPLORATORY` : label
}

export function collectEnvMetadata() {
  let gitSha = 'unknown'
  let codexVersion = 'unknown'
  try {
    gitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
    }).trim()
  } catch {
    // ignore
  }
  try {
    codexVersion = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim()
  } catch {
    // ignore
  }
  return {
    collectedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cwd: process.cwd(),
    pluginRoot: PLUGIN_ROOT,
    gitSha,
    codexVersion,
  }
}

/**
 * Stable SHA-256 hex of utf8 text.
 * @param {string} text
 */
export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Extract path-like tokens from JSONL tool summaries for out-of-scope heuristics.
 * @param {string[]} toolSummaries
 */
export function extractPathMentions(toolSummaries) {
  /** @type {Set<string>} */
  const paths = new Set()
  const re = /(?:^|[\s"'`])((?:\.\/)?(?:src|test|tests|lib|docs|scripts|benchmarks)\/[\w./+-]+)/g
  for (const s of toolSummaries) {
    let m
    const str = String(s)
    while ((m = re.exec(str))) {
      paths.add(m[1].replace(/^\.\//, ''))
    }
  }
  return [...paths].sort()
}

/**
 * @param {string} path
 */
export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Markdown table helper.
 * @param {string[]} headers
 * @param {Array<Array<string|number|null|undefined>>} rows
 */
export function markdownTable(headers, rows) {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map(r => `| ${r.map(c => (c == null ? '' : String(c))).join(' | ')} |`)
  return [head, sep, ...body].join('\n')
}
