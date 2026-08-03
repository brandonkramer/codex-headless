#!/usr/bin/env node
/**
 * Paired live trials for optimization #2 (shared evidence review fan-out).
 * Sequential provider calls only. Parallel user latency is a derived model.
 *
 * Usage:
 *   node benchmarks/suites/review-fanout/review-fanout-live.mjs --dry-run --trials 3
 *   node --import tsx benchmarks/suites/review-fanout/review-fanout-live.mjs --trials 3 --seed 42
 */

import { mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  buildEvidencePacket,
  DEFAULT_LENSES,
  mergeFindings,
  buildLensReviewPrompt,
  EVIDENCE_BYTE_BUDGET,
} from '../../../workflows/lib/review-panel-core.js'
import {
  armOrderForTrial,
  bootstrapMedianDiffCI,
  collectEnvMetadata,
  evidenceLabel,
  markdownTable,
  median,
  PLUGIN_ROOT,
  readJson,
  schedulingFromStages,
  summarizeJsonlMetrics,
  withEvidenceSuffix,
} from '../shared/review-brief-metrics.mjs'
import { parseReviewPayload, scoreFindingsWithValidity } from './review-fanout-score.mjs'
import { runSchemaPreflight } from '../../harness/lib/schema-preflight.mjs'
import { detectJsonlInvalidity, mergeArmValidity, validArmValues, countValidArms } from '../../harness/lib/trial-validity.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixture')
const OUT_DEFAULT = join(HERE, 'results')

function parseArgs(argv) {
  const out = {
    trials: 3,
    seed: 42,
    dryRun: false,
    livePrep: false,
    skipPreflight: false,
    preflightOnly: false,
    outDir: OUT_DEFAULT,
    maxWallMs: 180_000,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--skip-preflight') out.skipPreflight = true
    else if (a === '--preflight-only') out.preflightOnly = true
    else if (a === '--live-prep') out.livePrep = true
    else if (a === '--trials') out.trials = Math.max(1, Number(argv[++i]) || 3)
    else if (a === '--seed') out.seed = Number(argv[++i]) || 42
    else if (a === '--out') out.outDir = String(argv[++i])
    else if (a === '--max-wall-ms') out.maxWallMs = Math.max(0, Number(argv[++i]) || 0)
    else if (a === '--help' || a === '-h') {
      console.log(`review-fanout-live.mjs [--dry-run] [--trials N] [--seed N] [--live-prep] [--out DIR]`)
      process.exit(0)
    }
  }
  return out
}

function loadFixture() {
  const known = readJson(join(FIXTURE, 'known-defects.json'))
  const sections = readJson(join(FIXTURE, 'evidence-sections.json'))
  return { known, sections, repoSrc: join(FIXTURE, 'repo') }
}

/**
 * @param {import('../../../workflows/lib/review-panel-core.js').DEFAULT_LENSES[number]} lens
 * @param {string} scope
 * @param {string} cwd
 */
function buildBaselineLensPrompt(lens, scope, cwd) {
  return `You are an independent review lens (${lens.id}: ${lens.title}).

Hard rules for this BASELINE arm:
- Discover evidence yourself from the workspace at ${JSON.stringify(cwd)}.
- Read src/auth.js, src/api.js, test/api.test.js and/or the unified diff under the workspace.
- Do NOT assume a shared evidence packet exists.
- Focus: ${lens.focus}
- Scope: ${scope}

Return structured JSON only with fields: lens, verdict, findings[{severity,location,why,fix}], notes.
Severity: blocker|major|minor|nit
Verdict: pass|pass-with-notes|fail|inconclusive
Set lens=${JSON.stringify(lens.id)}.`
}

/**
 * Materialize fixture repo into a temp git-ish tree (files only; no main-repo mutation).
 * @param {string} repoSrc
 */
async function materializeRepo(repoSrc) {
  const dir = await mkdtemp(join(tmpdir(), 'review-fanout-'))
  cpSync(repoSrc, dir, { recursive: true })
  // Copy frozen diff for discoverability
  writeFileSync(join(dir, 'CHANGES.diff'), readFileSync(join(FIXTURE, 'snapshot.diff')))
  return dir
}

/**
 * @param {{ dryRun: boolean, maxWallMs: number, prompt: string, cwd: string, label: string, jsonlPath: string, structured?: boolean, profile?: string }} opts
 */
async function runProvider(opts) {
  const started = Date.now()
  if (opts.dryRun) {
    const syntheticFindings =
      opts.label.includes('baseline') || opts.label.includes('lens')
        ? [
            {
              severity: 'major',
              location: 'src/auth.js:3',
              why: 'null token slice can crash',
              fix: 'guard token',
            },
            {
              severity: 'blocker',
              location: 'src/api.js:10',
              why: 'command injection via unsanitized user input to execSync shell',
              fix: 'use allowlist argv',
            },
            {
              severity: 'major',
              location: 'test/api.test.js',
              why: 'missing coverage for empty query edge case on runReport',
              fix: 'add test',
            },
          ]
        : []
    // Baseline rediscovery: pretend more tool use
    const toolLike = opts.label.includes('baseline') ? 4 : 0
    const wall = opts.label.includes('baseline') ? 1200 : 400
    const content = JSON.stringify({
      lens: 'correctness',
      verdict: 'fail',
      findings: syntheticFindings,
    })
    writeFileSync(
      opts.jsonlPath,
      [
        JSON.stringify({ type: 'thread.started', thread_id: 'dry' }),
        JSON.stringify({ type: 'turn.started' }),
        ...Array.from({ length: toolLike }, (_, i) =>
          JSON.stringify({
            type: 'item.completed',
            item: { type: 'command_execution', command: `cat src/file${i}.js` },
          }),
        ),
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: content },
        }),
        JSON.stringify({
          type: 'turn.completed',
          usage: {
            input_tokens: 800 + toolLike * 100,
            cached_input_tokens: 0,
            output_tokens: 200,
            reasoning_output_tokens: 50,
          },
        }),
      ].join('\n') + '\n',
    )
    return {
      ok: true,
      content,
      wallMs: wall,
      jsonlPath: opts.jsonlPath,
    }
  }

  const { runCodexExec } = await import('../../../src/run-codex.ts')
  const result = await runCodexExec({
    profile: /** @type {'review'|'probe'} */ (opts.profile || 'review'),
    prompt: opts.prompt,
    cwd: opts.cwd,
    structured: opts.structured !== false && opts.profile !== 'probe',
    json: true,
    jsonlPath: opts.jsonlPath,
    maxWallMs: opts.maxWallMs,
    ephemeral: true,
    onProgress: () => {},
  })
  return {
    ok: result.ok,
    content: result.content,
    wallMs: Date.now() - started,
    jsonlPath: opts.jsonlPath,
    usage: result.usage,
    exitCode: result.exitCode,
    turnError: result.turnError,
  }
}

/**
 * @param {object} args
 */
async function runBaselineArm(args) {
  const { lenses, scope, repoDir, trialDir, dryRun, maxWallMs } = args
  /** @type {number[]} */
  const stageMs = []
  /** @type {object[]} */
  const lensResults = []
  /** @type {string[]} */
  const jsonlTexts = []
  let turns = 0
  let toolLike = 0
  /** @type {import('../shared/review-brief-metrics.mjs').Usage | null} */
  let usageSum = {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  }
  let usageAny = false

  for (const lens of lenses) {
    const jsonlPath = join(trialDir, `baseline-${lens.id}.jsonl`)
    const prompt = buildBaselineLensPrompt(lens, scope, repoDir)
    const res = await runProvider({
      dryRun,
      maxWallMs,
      prompt,
      cwd: repoDir,
      label: `baseline-${lens.id}`,
      jsonlPath,
      structured: true,
      profile: 'review',
    })
    stageMs.push(res.wallMs)
    const jsonlText = readFileSync(jsonlPath, 'utf8')
    jsonlTexts.push(jsonlText)
    const metrics = summarizeJsonlMetrics(jsonlText)
    turns += metrics.turns
    toolLike += metrics.toolLike
    if (metrics.usage) {
      usageAny = true
      usageSum.input_tokens += metrics.usage.input_tokens
      usageSum.cached_input_tokens += metrics.usage.cached_input_tokens
      usageSum.output_tokens += metrics.usage.output_tokens
      usageSum.reasoning_output_tokens += metrics.usage.reasoning_output_tokens
    }
    const parsed = parseReviewPayload(res.content)
    lensResults.push({
      lens: lens.id,
      verdict: parsed.verdict,
      findings: parsed.findings.map(f => ({ ...f, lens: lens.id })),
      wallMs: res.wallMs,
      ok: res.ok,
    })
  }

  const merged = mergeFindings(lensResults)
  const sched = schedulingFromStages({ prepMs: 0, stageMs })
  const armValidity = mergeArmValidity(jsonlTexts)
  return {
    arm: 'independent_discovery',
    ...sched,
    turns,
    toolLike,
    usage: usageAny ? usageSum : null,
    lensResults,
    mergedFindings: merged,
    validity: armValidity.validity,
    validityReason: armValidity.reason,
    validityCode: armValidity.code,
  }
}

/**
 * @param {object} args
 */
async function runOptimizedArm(args) {
  const { lenses, scope, sections, repoDir, trialDir, dryRun, maxWallMs, livePrep } = args
  /** @type {number[]} */
  const stageMs = []
  let prepMs = 0
  let workingSections = { ...sections }

  if (livePrep && !dryRun) {
    const jsonlPath = join(trialDir, 'optimized-prep.jsonl')
    const prepPrompt = `Read-only probe. Summarize the defect-relevant diff in this workspace for review.
Return plain text with sections DIFF, CONTEXT, TESTS only. Workspace: ${repoDir}`
    const started = Date.now()
    const res = await runProvider({
      dryRun: false,
      maxWallMs,
      prompt: prepPrompt,
      cwd: repoDir,
      label: 'optimized-prep',
      jsonlPath,
      structured: false,
      profile: 'probe',
    })
    prepMs = Date.now() - started
    workingSections = {
      diff: res.content.slice(0, 5000),
      context: 'live prep probe',
      tests: 'see probe output',
    }
  } else if (livePrep && dryRun) {
    prepMs = 300
  }

  const packet = buildEvidencePacket(workingSections, EVIDENCE_BYTE_BUDGET)
  writeFileSync(
    join(trialDir, 'evidence-packet.json'),
    JSON.stringify(
      {
        bytesUsed: packet.bytesUsed,
        byteBudget: packet.byteBudget,
        truncated: packet.truncated,
        digest: packet.digest,
        fullBytes: packet.fullBytes,
      },
      null,
      2,
    ),
  )

  /** @type {object[]} */
  const lensResults = []
  /** @type {string[]} */
  const jsonlTexts = []
  let turns = 0
  let toolLike = 0
  let usageSum = {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  }
  let usageAny = false

  for (const lens of lenses) {
    const jsonlPath = join(trialDir, `optimized-${lens.id}.jsonl`)
    const prompt = buildLensReviewPrompt(lens, scope, repoDir, packet)
    const res = await runProvider({
      dryRun,
      maxWallMs,
      prompt,
      cwd: repoDir,
      label: `optimized-lens-${lens.id}`,
      jsonlPath,
      structured: true,
      profile: 'review',
    })
    stageMs.push(res.wallMs)
    const jsonlText = readFileSync(jsonlPath, 'utf8')
    jsonlTexts.push(jsonlText)
    const metrics = summarizeJsonlMetrics(jsonlText)
    turns += metrics.turns
    toolLike += metrics.toolLike
    if (metrics.usage) {
      usageAny = true
      usageSum.input_tokens += metrics.usage.input_tokens
      usageSum.cached_input_tokens += metrics.usage.cached_input_tokens
      usageSum.output_tokens += metrics.usage.output_tokens
      usageSum.reasoning_output_tokens += metrics.usage.reasoning_output_tokens
    }
    const parsed = parseReviewPayload(res.content)
    // Dry-run: specialize findings per lens lightly
    let findings = parsed.findings.map(f => ({ ...f, lens: lens.id }))
    if (dryRun) {
      findings = findings.filter(f => {
        if (lens.id === 'correctness') return /auth|token|null/i.test(f.why + f.location)
        if (lens.id === 'security') return /inject|exec|shell|command/i.test(f.why)
        return /missing|coverage|test|edge/i.test(f.why)
      })
      if (!findings.length) findings = parsed.findings.slice(0, 1).map(f => ({ ...f, lens: lens.id }))
    }
    lensResults.push({
      lens: lens.id,
      verdict: parsed.verdict,
      findings,
      wallMs: res.wallMs,
      ok: res.ok,
    })
  }

  const merged = mergeFindings(lensResults)
  const sched = schedulingFromStages({ prepMs, stageMs })
  const armValidity = mergeArmValidity(jsonlTexts)
  return {
    arm: 'shared_evidence_packet',
    packet: {
      bytesUsed: packet.bytesUsed,
      byteBudget: packet.byteBudget,
      truncated: packet.truncated,
      digest: packet.digest,
      fullBytes: packet.fullBytes,
    },
    ...sched,
    turns,
    toolLike,
    usage: usageAny ? usageSum : null,
    lensResults,
    mergedFindings: merged,
    validity: armValidity.validity,
    validityReason: armValidity.reason,
    validityCode: armValidity.code,
  }
}

/**
 * @param {object} report
 */
function evaluateGates(report) {
  const trials = report.trials
  const n = trials.length
  const medValid = (arm, key) => median(validArmValues(trials, arm, key))

  const structural = {
    packet_cap: trials.every(
      t => !t.arms.shared_evidence_packet?.packet || t.arms.shared_evidence_packet.packet.bytesUsed <= 6000,
    ),
    digest_stable: (() => {
      const digests = trials
        .map(t => t.arms.shared_evidence_packet?.packet?.digest)
        .filter(Boolean)
      return digests.length === 0 || digests.every(d => d === digests[0])
    })(),
  }

  const validBaseline = countValidArms(trials, 'independent_discovery')
  const validOptimized = countValidArms(trials, 'shared_evidence_packet')
  const invalidBaseline = n - validBaseline
  const invalidOptimized = n - validOptimized

  const baseRecall = medValid('independent_discovery', 'recall')
  const optRecall = medValid('shared_evidence_packet', 'recall')
  const baseWork = medValid('independent_discovery', 'provider_work_ms')
  const optWork = medValid('shared_evidence_packet', 'provider_work_ms')
  const baseLat = medValid('independent_discovery', 'user_latency_ms_parallel_model')
  const optLat = medValid('shared_evidence_packet', 'user_latency_ms_parallel_model')
  const baseTools = medValid('independent_discovery', 'toolLike')
  const optTools = medValid('shared_evidence_packet', 'toolLike')

  const hasQualitySamples = validBaseline > 0 && validOptimized > 0

  const quality = {
    valid_baseline_arms: validBaseline,
    valid_optimized_arms: validOptimized,
    invalid_baseline_arms: invalidBaseline,
    invalid_optimized_arms: invalidOptimized,
    has_quality_samples: hasQualitySamples,
    recall_gate:
      !hasQualitySamples
        ? null
        : baseRecall == null || optRecall == null
          ? false
          : optRecall >= baseRecall - 0.05,
    defect_floor: (() => {
      if (!hasQualitySamples) return null
      const recalls = trials
        .map(t => t.arms.shared_evidence_packet)
        .filter(a => a?.validity === 'valid')
        .map(a => a.recoveredCount ?? 0)
      const m = median(recalls)
      return m != null && m >= 2
    })(),
  }

  const hasSpeedSamples = baseWork != null && optWork != null
  const speed = {
    has_speed_samples: hasSpeedSamples,
    provider_or_latency:
      !hasSpeedSamples
        ? null
        : (baseWork != null && optWork != null && optWork <= baseWork * 0.75) ||
          (baseLat != null && optLat != null && optLat <= baseLat * 0.55),
    tools:
      baseTools != null && optTools != null ? optTools <= baseTools * 0.5 : null,
  }

  let label = 'PASS_SPEED_AND_QUALITY'
  if (!structural.packet_cap || !structural.digest_stable) label = 'FAIL_STRUCTURAL'
  else if (!hasQualitySamples) label = 'INCONCLUSIVE_INVALID'
  else if (quality.recall_gate === false || quality.defect_floor === false) label = 'FAIL_QUALITY'
  else if (speed.provider_or_latency === false || speed.tools === false) label = 'PASS_QUALITY_ONLY'

  return {
    structural,
    quality,
    speed,
    medians: {
      baseline_recall: baseRecall,
      optimized_recall: optRecall,
      baseline_provider_work_ms: baseWork,
      optimized_provider_work_ms: optWork,
      baseline_user_latency_ms_parallel_model: baseLat,
      optimized_user_latency_ms_parallel_model: optLat,
      baseline_toolLike: baseTools,
      optimized_toolLike: optTools,
    },
    bootstrap_provider_work_diff_opt_minus_base:
      validBaseline > 0 && validOptimized > 0
        ? bootstrapMedianDiffCI(
            validArmValues(trials, 'independent_discovery', 'provider_work_ms'),
            validArmValues(trials, 'shared_evidence_packet', 'provider_work_ms'),
            500,
            report.config.seed,
          )
        : { diff: null, lo: null, hi: null, B: 0 },
    label: withEvidenceSuffix(label, n),
    evidence: evidenceLabel(n),
    note:
      invalidBaseline + invalidOptimized > 0
        ? 'Invalid/schema-rejected arms excluded from quality and speed medians; not scored as 0% recall.'
        : undefined,
  }
}

function toMarkdown(report) {
  const g = report.gates
  const rows = report.trials.flatMap(t =>
    ['independent_discovery', 'shared_evidence_packet'].map(arm => {
      const a = t.arms[arm]
      return [
        t.trial,
        arm,
        a.provider_work_ms,
        a.user_latency_ms_parallel_model,
        a.toolLike,
        a.turns,
        a.recall?.toFixed?.(3) ?? a.recall,
        a.precision?.toFixed?.(3) ?? a.precision,
      ]
    }),
  )
  return [
    `# Review fan-out paired trial report`,
    ``,
    `- Result: **${g.label}** (${g.evidence})`,
    `- Trials/arm: ${report.config.trials}`,
    `- Dry-run: ${report.config.dryRun}`,
    `- Env: Codex \`${report.env.codexVersion}\`, git \`${report.env.gitSha.slice(0, 8)}\`, ${report.env.platform}`,
    ``,
    `## Gates (predeclared)`,
    `\`\`\`json`,
    JSON.stringify(g, null, 2),
    `\`\`\``,
    ``,
    `## Per-trial metrics`,
    markdownTable(
      [
        'trial',
        'arm',
        'provider_work_ms',
        'user_latency_parallel_model',
        'toolLike',
        'turns',
        'recall',
        'precision',
      ],
      rows,
    ),
    ``,
    `## Notes`,
    `- Live provider calls were sequential; \`user_latency_ms_parallel_model\` is derived.`,
    `- Optimized packet budget: ${EVIDENCE_BYTE_BUDGET} UTF-8 bytes.`,
  ].join('\n')
}

async function main() {
  const config = parseArgs(process.argv.slice(2))
  const { known, sections, repoSrc } = loadFixture()
  const lenses = DEFAULT_LENSES.map(l => ({ ...l }))
  mkdirSync(config.outDir, { recursive: true })

  if (!config.skipPreflight) {
    const preflight = await runSchemaPreflight({
      kinds: ['review'],
      dryRun: config.dryRun,
      cwd: PLUGIN_ROOT,
    })
    writeFileSync(
      join(config.outDir, 'schema-preflight.json'),
      JSON.stringify({ collectedAt: new Date().toISOString(), ...preflight }, null, 2),
    )
    if (!preflight.ok) {
      console.error('[review-fanout] schema preflight failed — aborting before trials')
      console.error(JSON.stringify(preflight.failed, null, 2))
      process.exit(2)
    }
    console.error('[review-fanout] schema preflight ok')
    if (config.preflightOnly) {
      console.log(JSON.stringify({ ok: true, preflightOnly: true, outDir: config.outDir }, null, 2))
      return
    }
  }

  const repoDir = await materializeRepo(repoSrc)
  /** @type {object[]} */
  const trials = []

  try {
    for (let t = 0; t < config.trials; t++) {
      const order = armOrderForTrial(
        t,
        config.seed,
        'independent_discovery',
        'shared_evidence_packet',
      )
      const trialDir = join(config.outDir, `trial-${t}`)
      mkdirSync(trialDir, { recursive: true })
      /** @type {Record<string, object>} */
      const arms = {}

      console.error(`[review-fanout] trial ${t + 1}/${config.trials} order=${order.join('→')}`)

      for (const arm of order) {
        console.error(`[review-fanout]   arm=${arm}`)
        const result =
          arm === 'independent_discovery'
            ? await runBaselineArm({
                lenses,
                scope: known.scope,
                repoDir,
                trialDir,
                dryRun: config.dryRun,
                maxWallMs: config.maxWallMs,
              })
            : await runOptimizedArm({
                lenses,
                scope: known.scope,
                sections,
                repoDir,
                trialDir,
                dryRun: config.dryRun,
                maxWallMs: config.maxWallMs,
                livePrep: config.livePrep,
              })
        const quality = scoreFindingsWithValidity(result.mergedFindings, known.defects, {
          validity: result.validity,
          validityReason: result.validityReason,
          validityCode: result.validityCode,
        })
        arms[arm] = {
          ...result,
          ...quality,
          recoveredCount: quality.validity === 'valid' ? quality.recovered.length : null,
        }
      }

      trials.push({ trial: t, order, arms })
      writeFileSync(join(trialDir, 'trial.json'), JSON.stringify(trials[t], null, 2))
    }
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }

  const report = {
    optimization: 2,
    name: 'shared_evidence_review_fanout',
    protocolVersion: 'v2',
    config,
    env: collectEnvMetadata(),
    fixtureId: known.fixtureId,
    pluginRoot: PLUGIN_ROOT,
    trials,
    gates: null,
  }
  report.gates = evaluateGates(report)

  const jsonPath = join(config.outDir, 'review-fanout-report.json')
  const mdPath = join(config.outDir, 'review-fanout-report.md')
  writeFileSync(jsonPath, JSON.stringify(report, null, 2))
  writeFileSync(mdPath, toMarkdown(report))
  console.log(JSON.stringify({ ok: true, label: report.gates.label, jsonPath, mdPath }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
