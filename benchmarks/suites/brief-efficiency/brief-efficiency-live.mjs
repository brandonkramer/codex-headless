#!/usr/bin/env node
/**
 * Paired live trials for optimization #4 (implementation-ready briefs).
 * Disposable temp git repos only — never mutates the plugin repo.
 *
 * Usage:
 *   node --import tsx benchmarks/suites/brief-efficiency/brief-efficiency-live.mjs --dry-run --trials 3
 *   node --import tsx benchmarks/suites/brief-efficiency/brief-efficiency-live.mjs --trials 3 --seed 42
 */

import {
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  assembleImplementPrompt,
  parseImplementBrief,
} from '../../../src/implement-brief.ts'
import {
  armOrderForTrial,
  bootstrapMedianDiffCI,
  collectEnvMetadata,
  evidenceLabel,
  markdownTable,
  median,
  PLUGIN_ROOT,
  readJson,
  summarizeJsonlMetrics,
  withEvidenceSuffix,
} from '../shared/review-brief-metrics.mjs'
import { scoreBriefTrial } from './brief-efficiency-score.mjs'
import { runSchemaPreflight } from '../../harness/lib/schema-preflight.mjs'
import { detectJsonlInvalidity, validArmValues, countValidArms } from '../../harness/lib/trial-validity.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixture')
const OUT_DEFAULT = join(HERE, 'results')

function parseArgs(argv) {
  const out = {
    trials: 3,
    seed: 42,
    dryRun: false,
    skipPreflight: false,
    preflightOnly: false,
    outDir: OUT_DEFAULT,
    maxWallMs: 180_000,
    profile: 'engineer',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--skip-preflight') out.skipPreflight = true
    else if (a === '--preflight-only') out.preflightOnly = true
    else if (a === '--trials') out.trials = Math.max(1, Number(argv[++i]) || 3)
    else if (a === '--seed') out.seed = Number(argv[++i]) || 42
    else if (a === '--out') out.outDir = String(argv[++i])
    else if (a === '--max-wall-ms') out.maxWallMs = Math.max(0, Number(argv[++i]) || 0)
    else if (a === '--profile') out.profile = String(argv[++i] || 'engineer')
    else if (a === '--help' || a === '-h') {
      console.log(`brief-efficiency-live.mjs [--dry-run] [--trials N] [--seed N] [--out DIR]`)
      process.exit(0)
    }
  }
  return out
}

function assertOutsidePlugin(tempDir) {
  const plugin = resolve(PLUGIN_ROOT)
  const temp = resolve(tempDir)
  if (temp === plugin || temp.startsWith(plugin + '/')) {
    throw new Error(`refusing to use temp dir inside plugin root: ${temp}`)
  }
}

/**
 * @param {string} seedDir
 */
async function createTempGitRepo(seedDir) {
  const dir = await mkdtemp(join(tmpdir(), 'brief-efficiency-'))
  assertOutsidePlugin(dir)
  cpSync(seedDir, dir, { recursive: true })
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'bench@example.com'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'bench'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'seed'], { cwd: dir, stdio: 'ignore' })
  return dir
}

/**
 * @param {string} cwd
 */
function gitChangedFiles(cwd) {
  const out = execFileSync('git', ['status', '--porcelain', '-uall'], {
    cwd,
    encoding: 'utf8',
  })
  return out
    .split('\n')
    .filter(Boolean)
    .map(l => {
      // Do not trim first — porcelain is "XY PATH" (two status chars + space).
      if (l.startsWith('?? ')) return l.slice(3).trim()
      if (l.length >= 4) {
        const pathPart = l.slice(3).trim()
        // renames: "old -> new"
        const arrow = pathPart.lastIndexOf(' -> ')
        return (arrow >= 0 ? pathPart.slice(arrow + 4) : pathPart).replace(/^"|"$/g, '')
      }
      return l.trim()
    })
    .filter(Boolean)
    .sort()
}

/**
 * @param {string} cwd
 */
function runAcceptance(cwd) {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const r = spawnSync(process.execPath, ['--test', 'test/math.test.js'], {
    cwd,
    encoding: 'utf8',
    env,
  })
  return { ok: r.status === 0, status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
}

/**
 * Dry-run: apply golden only for brief arm (simulates disciplined edit);
 * loose arm also patches math but "touches" noise via synthetic JSONL.
 * @param {string} cwd
 * @param {'loose_prompt'|'typed_brief'} arm
 */
function applyDryRunEdits(cwd, arm) {
  const golden = readFileSync(join(FIXTURE, 'golden/src/math.js'), 'utf8')
  writeFileSync(join(cwd, 'src/math.js'), golden)
  if (arm === 'loose_prompt') {
    // Simulate wasteful touch
    const noise = readFileSync(join(cwd, 'src/noise.js'), 'utf8')
    writeFileSync(join(cwd, 'src/noise.js'), noise + '\n// touched by loose agent\n')
    writeFileSync(join(cwd, 'docs/README.md'), '# edited by loose\n')
  }
}

/**
 * @param {object} opts
 */
async function runArm(opts) {
  const { arm, prompt, cwd, trialDir, dryRun, maxWallMs, profile, briefMeta } = opts
  const jsonlPath = join(trialDir, `${arm}.jsonl`)
  const started = Date.now()

  if (dryRun) {
    applyDryRunEdits(cwd, arm)
    const toolLines =
      arm === 'loose_prompt'
        ? [
            { type: 'command_execution', command: 'cat src/noise.js' },
            { type: 'command_execution', command: 'cat docs/README.md' },
            { type: 'command_execution', command: 'cat src/math.js' },
            { type: 'file_change' },
            { type: 'file_change' },
            { type: 'file_change' },
          ]
        : [
            { type: 'command_execution', command: 'cat src/math.js' },
            { type: 'command_execution', command: 'node --test test/math.test.js' },
            { type: 'file_change' },
          ]
    writeFileSync(
      jsonlPath,
      [
        JSON.stringify({ type: 'thread.started', thread_id: 'dry' }),
        JSON.stringify({ type: 'turn.started' }),
        ...toolLines.map(item => JSON.stringify({ type: 'item.completed', item })),
        JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: JSON.stringify({
              changed_files: gitChangedFiles(cwd),
              summary: 'dry-run',
              risks: [],
              recommended_verification: ['node --test test/math.test.js'],
            }),
          },
        }),
        JSON.stringify({
          type: 'turn.completed',
          usage: {
            input_tokens: arm === 'loose_prompt' ? 2000 : 1200,
            cached_input_tokens: 0,
            output_tokens: 400,
            reasoning_output_tokens: 100,
          },
        }),
      ].join('\n') + '\n',
    )
  } else {
    const { runCodexExec } = await import('../../../src/run-codex.ts')
    await runCodexExec({
      profile: /** @type {'engineer'|'implement'} */ (profile),
      prompt,
      cwd,
      structured: true,
      json: true,
      jsonlPath,
      maxWallMs,
      ephemeral: true,
      onProgress: () => {},
    })
  }

  const wallMs = Date.now() - started
  const jsonlText = existsSync(jsonlPath) ? readFileSync(jsonlPath, 'utf8') : ''
  const metrics = summarizeJsonlMetrics(jsonlText)
  const armValidity = dryRun
    ? { valid: true, validity: 'valid', reason: null, code: null }
    : detectJsonlInvalidity(jsonlText)
  const changed = gitChangedFiles(cwd)
  const acceptance = runAcceptance(cwd)
  const scored = scoreBriefTrial({
    changedFiles: changed,
    writeScope: briefMeta.writeScope,
    startFiles: briefMeta.files,
    toolSummaries: metrics.toolSummaries,
    toolLike: metrics.toolLike,
    testsPassed: acceptance.ok,
    validity: armValidity.validity,
    validityReason: armValidity.reason,
    validityCode: armValidity.code,
  })

  return {
    arm,
    wallMs,
    turns: metrics.turns,
    toolLike: metrics.toolLike,
    usage: metrics.usage,
    changedFiles: changed,
    acceptanceOk: acceptance.ok,
    ...scored,
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
    temp_outside_plugin: true,
    brief_has_scope: report.briefPreamble.includes('Write scope'),
    seed_red_golden_green: report.structuralChecks.seedFails && report.structuralChecks.goldenPasses,
  }

  const validLoose = countValidArms(trials, 'loose_prompt')
  const validBrief = countValidArms(trials, 'typed_brief')
  const hasQualitySamples = validLoose > 0 && validBrief > 0

  const loosePassRate = hasQualitySamples
    ? trials.filter(t => t.arms.loose_prompt?.validity === 'valid' && t.arms.loose_prompt?.testsPassed)
        .length / validLoose
    : null
  const briefPassRate = hasQualitySamples
    ? trials.filter(t => t.arms.typed_brief?.validity === 'valid' && t.arms.typed_brief?.testsPassed)
        .length / validBrief
    : null

  const quality = {
    valid_loose_arms: validLoose,
    valid_brief_arms: validBrief,
    invalid_loose_arms: n - validLoose,
    invalid_brief_arms: n - validBrief,
    has_quality_samples: hasQualitySamples,
    equal_or_better:
      !hasQualitySamples ? null : briefPassRate != null && loosePassRate != null && briefPassRate >= loosePassRate,
    loosePassRate,
    briefPassRate,
  }

  const looseWaste = medValid('loose_prompt', 'waste')
  const briefWaste = medValid('typed_brief', 'waste')
  const looseOosW = medValid('loose_prompt', 'outOfScopeWrites')
  const briefOosW = medValid('typed_brief', 'outOfScopeWrites')
  const hasWasteSamples = looseWaste != null && briefWaste != null

  const efficiency = {
    has_waste_samples: hasWasteSamples,
    lower_waste: !hasWasteSamples ? null : briefWaste < looseWaste,
    writes_not_worse:
      looseOosW != null && briefOosW != null ? briefOosW <= looseOosW : null,
  }

  let label = 'PASS_LOWER_WASTE_EQUAL_QUALITY'
  if (!structural.brief_has_scope || !structural.seed_red_golden_green) {
    label = 'FAIL_STRUCTURAL'
  } else if (!hasQualitySamples) {
    label = 'INCONCLUSIVE_INVALID'
  } else if (quality.equal_or_better === false) {
    label = 'FAIL_QUALITY'
  } else if (efficiency.lower_waste === false || efficiency.writes_not_worse === false) {
    label = 'FAIL_WASTE'
  }

  return {
    structural,
    quality,
    efficiency,
    medians: {
      loose_waste: looseWaste,
      brief_waste: briefWaste,
      loose_wall_ms: medValid('loose_prompt', 'wallMs'),
      brief_wall_ms: medValid('typed_brief', 'wallMs'),
      loose_toolLike: medValid('loose_prompt', 'toolLike'),
      brief_toolLike: medValid('typed_brief', 'toolLike'),
      loose_outOfScopeWrites: looseOosW,
      brief_outOfScopeWrites: briefOosW,
    },
    bootstrap_waste_diff_brief_minus_loose:
      validLoose > 0 && validBrief > 0
        ? bootstrapMedianDiffCI(
            validArmValues(trials, 'loose_prompt', 'waste'),
            validArmValues(trials, 'typed_brief', 'waste'),
            500,
            report.config.seed,
          )
        : { diff: null, lo: null, hi: null, B: 0 },
    note: 'Wall time is reported independently and is NOT a pass gate. Invalid/schema-rejected arms excluded from quality and waste medians.',
    label: withEvidenceSuffix(label, n),
    evidence: evidenceLabel(n),
  }
}

function toMarkdown(report) {
  const g = report.gates
  const rows = report.trials.flatMap(t =>
    ['loose_prompt', 'typed_brief'].map(arm => {
      const a = t.arms[arm]
      return [
        t.trial,
        arm,
        a.wallMs,
        a.waste,
        a.toolLike,
        a.outOfScopeWrites,
        a.outOfScopeReads,
        a.testsPassed,
        a.usage?.input_tokens ?? '',
      ]
    }),
  )
  return [
    `# Brief efficiency paired trial report`,
    ``,
    `- Result: **${g.label}** (${g.evidence})`,
    `- Trials/arm: ${report.config.trials}`,
    `- Dry-run: ${report.config.dryRun}`,
    `- Wall time is informational only (not a pass gate).`,
    ``,
    `## Gates`,
    `\`\`\`json`,
    JSON.stringify(g, null, 2),
    `\`\`\``,
    ``,
    `## Per-trial`,
    markdownTable(
      [
        'trial',
        'arm',
        'wallMs',
        'waste',
        'toolLike',
        'oosWrites',
        'oosReads',
        'testsPassed',
        'input_tokens',
      ],
      rows,
    ),
  ].join('\n')
}

async function main() {
  const config = parseArgs(process.argv.slice(2))
  mkdirSync(config.outDir, { recursive: true })

  if (!config.skipPreflight) {
    const preflight = await runSchemaPreflight({
      kinds: ['implement'],
      dryRun: config.dryRun,
      cwd: PLUGIN_ROOT,
    })
    writeFileSync(
      join(config.outDir, 'schema-preflight.json'),
      JSON.stringify({ collectedAt: new Date().toISOString(), ...preflight }, null, 2),
    )
    if (!preflight.ok) {
      console.error('[brief-efficiency] schema preflight failed — aborting before trials')
      console.error(JSON.stringify(preflight.failed, null, 2))
      process.exit(2)
    }
    console.error('[brief-efficiency] schema preflight ok')
    if (config.preflightOnly) {
      console.log(JSON.stringify({ ok: true, preflightOnly: true, outDir: config.outDir }, null, 2))
      return
    }
  }

  const briefInput = readJson(join(FIXTURE, 'brief.json'))
  const brief = parseImplementBrief(briefInput)
  const briefPrompt = assembleImplementPrompt(brief)
  const loosePrompt = readFileSync(join(FIXTURE, 'loose-prompt.txt'), 'utf8')
  const seedDir = join(FIXTURE, 'seed')

  // Structural seed red / golden green (temp copies)
  const seedCheck = await createTempGitRepo(seedDir)
  let seedFails = false
  let goldenPasses = false
  try {
    seedFails = !runAcceptance(seedCheck).ok
    writeFileSync(
      join(seedCheck, 'src/math.js'),
      readFileSync(join(FIXTURE, 'golden/src/math.js'), 'utf8'),
    )
    goldenPasses = runAcceptance(seedCheck).ok
  } finally {
    await rm(seedCheck, { recursive: true, force: true })
  }

  /** @type {object[]} */
  const trials = []
  const briefMeta = { files: brief.files, writeScope: brief.writeScope }

  for (let t = 0; t < config.trials; t++) {
    const order = armOrderForTrial(t, config.seed, 'loose_prompt', 'typed_brief')
    const trialDir = join(config.outDir, `trial-${t}`)
    mkdirSync(trialDir, { recursive: true })
    /** @type {Record<string, object>} */
    const arms = {}

    console.error(`[brief-efficiency] trial ${t + 1}/${config.trials} order=${order.join('→')}`)

    for (const arm of order) {
      console.error(`[brief-efficiency]   arm=${arm}`)
      const cwd = await createTempGitRepo(seedDir)
      try {
        const prompt = arm === 'typed_brief' ? briefPrompt : loosePrompt
        arms[arm] = await runArm({
          arm,
          prompt,
          cwd,
          trialDir,
          dryRun: config.dryRun,
          maxWallMs: config.maxWallMs,
          profile: config.profile,
          briefMeta,
        })
      } finally {
        await rm(cwd, { recursive: true, force: true })
      }
    }

    trials.push({ trial: t, order, arms })
    writeFileSync(join(trialDir, 'trial.json'), JSON.stringify(trials[t], null, 2))
  }

  const report = {
    optimization: 4,
    name: 'implementation_ready_briefs',
    protocolVersion: 'v2',
    config,
    env: collectEnvMetadata(),
    briefPreamble: briefPrompt,
    structuralChecks: { seedFails, goldenPasses },
    trials,
    gates: null,
  }
  report.gates = evaluateGates(report)

  const jsonPath = join(config.outDir, 'brief-efficiency-report.json')
  const mdPath = join(config.outDir, 'brief-efficiency-report.md')
  writeFileSync(jsonPath, JSON.stringify(report, null, 2))
  writeFileSync(mdPath, toMarkdown(report))
  console.log(JSON.stringify({ ok: true, label: report.gates.label, jsonPath, mdPath }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
