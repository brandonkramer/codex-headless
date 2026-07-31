export const meta = {
  name: 'review-loop',
  description:
    'Codex reviews via codex_headless_review; codex_headless_implement workers fix blocker/major findings until clean or cap',
  whenToUse:
    'Invoked by /codex-review-loop when the Workflow tool is available. Requires args {scope, cwd}. Optional maxIterations (default 5). Review uses Codex MCP (structured); fixes use codex_headless_implement.',
  phases: [
    { title: 'Review', detail: 'thin Claude wrapper calls codex_headless_review (structured)' },
    { title: 'Fix', detail: 'codex_headless_implement workers address blocker/major findings' },
  ],
}

const ARGS =
  typeof args === 'string'
    ? (() => {
        try {
          return JSON.parse(args)
        } catch {
          return args
        }
      })()
    : args

const scope = ARGS && ARGS.scope
const cwd = ARGS && ARGS.cwd
if (!scope || typeof scope !== 'string' || !scope.trim()) {
  throw new Error(
    'review-loop workflow requires args: {scope: "<what to review>", cwd: "<workspace>"}',
  )
}
if (!cwd || typeof cwd !== 'string') {
  throw new Error('review-loop workflow requires args.cwd (absolute workspace path)')
}

let maxIterations = Number(ARGS.maxIterations)
if (!Number.isFinite(maxIterations) || maxIterations < 1) maxIterations = 5
maxIterations = Math.min(Math.floor(maxIterations), 5)

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['verdict', 'findings'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['pass', 'pass-with-notes', 'fail', 'inconclusive'],
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'location', 'why', 'fix'],
        properties: {
          severity: {
            type: 'string',
            enum: ['blocker', 'major', 'minor', 'nit'],
          },
          location: { type: 'string' },
          why: { type: 'string' },
          fix: { type: 'string' },
          accepted: { type: 'boolean' },
        },
      },
    },
    notes: { type: 'string' },
    tests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          passed: { type: 'boolean' },
          output_snippet: { type: 'string' },
        },
      },
    },
  },
}

const FIX_SCHEMA = {
  type: 'object',
  required: ['ok', 'summary'],
  properties: {
    ok: { type: 'boolean' },
    summary: { type: 'string' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' },
  },
}

const MCP_REVIEW = `
You are a thin review wrapper. You MUST call codex_headless_review
(codex-headless MCP) with structured=true. Do NOT invent a full review without
the tool. Do NOT edit files.

Prefer:
- review_uncommitted: true when scope is uncommitted / working tree
- OR prompt embedding the stated scope + relevant diff context

Always pass cwd=${JSON.stringify(cwd)} and structured=true.

You may run a small targeted test command via shell first (separate gate from
Codex agreement). Map the MCP structured verdict into the schema: verdict,
findings (severity/location/why/fix/accepted), notes, tests.
Treat schema "minor" as major-or-nit judgment for the loop (blocker/major drive fixes).
`

const MCP_FIX = `
You are a thin fix worker. You MUST call codex_headless_implement
(codex-headless MCP) to apply the fix. Do NOT edit files with your own
Write/Edit tools unless the MCP tools are unavailable — if unavailable, set
ok=false and explain.

Always pass cwd=${JSON.stringify(cwd)}, profile="implement", structured=true.
Keep the prompt surgical: fix this finding only. Do not run tests/builds/installs
unless the fix brief requires it.
`

function actionable(findings) {
  return (findings || []).filter(
    f => f && (f.severity === 'blocker' || f.severity === 'major'),
  )
}

function isClean(review) {
  if (!review) return false
  if (review.verdict === 'fail' || review.verdict === 'inconclusive') return false
  return actionable(review.findings).length === 0
}

const iterations = []
let lastReview = null

for (let iteration = 1; iteration <= maxIterations; iteration++) {
  phase('Review')
  log(`Iteration ${iteration}: Codex review of scope`)

  const prior =
    iterations.length === 0
      ? ''
      : `\nPrior iterations (summary):\n${iterations
          .map(
            it =>
              `- iter ${it.iteration}: verdict=${it.review.verdict}, fixed=${(it.fixes || []).length}, remaining blockers/majors=${actionable(it.review.findings).length}`,
          )
          .join('\n')}\nFocus this pass on touched areas + prior findings; do not dump the whole repo.`

  lastReview = await agent(
    `${MCP_REVIEW}

Workspace: ${cwd}
Scope:
<<<SCOPE
${scope}
SCOPE>>>
${prior}

Severity mapping for the loop:
- blocker / major → must/should fix before done
- minor / nit → optional; do not fail the loop on nits alone

Verdict:
- pass: no blocker/major
- pass-with-notes: no blocker/major but noteworthy notes
- fail: one or more blocker/major
- inconclusive: Codex hang/cancel/unavailable — do not invent findings`,
    {
      label: `review:${iteration}`,
      phase: 'Review',
      schema: REVIEW_SCHEMA,
    },
  )

  if (!lastReview) {
    throw new Error(`Review agent returned no result on iteration ${iteration}`)
  }

  const todo = actionable(lastReview.findings)
  log(
    `Iteration ${iteration}: verdict=${lastReview.verdict}, actionable=${todo.length}, nits=${(lastReview.findings || []).filter(f => f.severity === 'nit' || f.severity === 'minor').length}`,
  )

  if (isClean(lastReview)) {
    iterations.push({ iteration, review: lastReview, fixes: [] })
    break
  }

  if (iteration === maxIterations) {
    iterations.push({ iteration, review: lastReview, fixes: [], stopped: 'max-iterations' })
    break
  }

  if (lastReview.verdict === 'inconclusive') {
    iterations.push({ iteration, review: lastReview, fixes: [], stopped: 'inconclusive' })
    break
  }

  phase('Fix')
  const fixSlices = todo.slice(0, 6)
  if (todo.length > 6) {
    log(`Capping fix workers from ${todo.length} to 6 this iteration`)
  }
  log(`Launching ${fixSlices.length} codex_headless_implement fix worker(s)`)

  const fixes = await parallel(
    fixSlices.map((finding, i) => () =>
      agent(
        `${MCP_FIX}

Finding ${i + 1}/${fixSlices.length}
Severity: ${finding.severity}
Location: ${finding.location}
Why: ${finding.why}
Required fix: ${finding.fix}
Out of scope: everything else

Call codex_headless_implement with a self-contained prompt for this fix only.
Return ok/summary/changedFiles/error.`,
        {
          label: `fix:${iteration}:${i + 1}`,
          phase: 'Fix',
          schema: FIX_SCHEMA,
        },
      ).then(r =>
        r
          ? { finding, ...r }
          : {
              finding,
              ok: false,
              summary: '',
              error: 'fix worker returned no result',
            },
      ),
    ),
  )

  iterations.push({
    iteration,
    review: lastReview,
    fixes: (fixes || []).filter(Boolean),
  })
}

const final = lastReview || { verdict: 'fail', findings: [], notes: 'no review' }
const remaining = actionable(final.findings)

return {
  cwd,
  scope,
  iterations: iterations.length,
  finalVerdict: isClean(final) ? final.verdict : final.verdict === 'inconclusive' ? 'inconclusive' : 'fail',
  remainingActionable: remaining,
  nits: (final.findings || []).filter(f => f.severity === 'nit' || f.severity === 'minor'),
  history: iterations,
  note:
    'Parent session should present the final summary to the user. Reviews used Codex MCP; fixes used codex_headless_implement via thin wrappers.',
}
