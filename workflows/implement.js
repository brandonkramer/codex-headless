export const meta = {
  name: 'implement',
  description:
    'Fan out codex-headless workers (probe / engineer plan / implement) for a clear-spec task; Claude parent integrates',
  whenToUse:
    'Invoked by /codex-implement when the Workflow tool is available. Requires args {task, cwd}. Optional: slices, repo, baseRef, worktreeParent. Harness may pass args as a JSON string — this script parses that. Do NOT use Workflow isolation:worktree against a different repo than cwd.',
  phases: [
    { title: 'Decompose', detail: 'split task into independent slices if not provided' },
    { title: 'Workers', detail: 'one thin Claude agent per slice; each must call codex_headless_* MCP' },
  ],
}

/** Workflow harness sometimes delivers `args` as a JSON string (or twice-encoded). */
function parseArgs(raw) {
  let value = raw
  for (let i = 0; i < 3; i++) {
    if (typeof value !== 'string') break
    const trimmed = value.replace(/^\uFEFF/, '').trim()
    if (!trimmed) break
    try {
      value = JSON.parse(trimmed)
    } catch {
      break
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      'implement workflow requires args as an object (or JSON string of an object): {task, cwd, ...}',
    )
  }
  return value
}

const ARGS = parseArgs(typeof args === 'undefined' ? null : args)

const task = ARGS.task
const cwd = ARGS.cwd
if (!task || typeof task !== 'string' || !task.trim()) {
  throw new Error('implement workflow requires args: {task: "<assignment>", cwd: "<workspace>"}')
}
if (!cwd || typeof cwd !== 'string') {
  throw new Error('implement workflow requires args.cwd (absolute workspace path)')
}

/** Git repo to attach worktrees to (defaults to cwd). Use when the chat cwd ≠ target repo. */
const repo = typeof ARGS.repo === 'string' && ARGS.repo.trim() ? ARGS.repo.trim() : cwd
/** Commit/branch/ref for detached worktrees (optional). */
const baseRef =
  typeof ARGS.baseRef === 'string' && ARGS.baseRef.trim() ? ARGS.baseRef.trim() : null
/** Directory that will hold sibling worktrees (optional). */
const worktreeParent =
  typeof ARGS.worktreeParent === 'string' && ARGS.worktreeParent.trim()
    ? ARGS.worktreeParent.trim()
    : null

const TOOLS = new Set(['codex_headless_implement', 'codex_headless_probe'])
const PROFILES = new Set(['implement', 'engineer'])

function normalizeSlice(s, i) {
  if (!s || typeof s !== 'object') return null
  const goal = String(s.goal || s.prompt || '').trim()
  if (!goal) return null
  let tool = String(s.tool || 'codex_headless_implement').trim()
  if (!TOOLS.has(tool)) tool = 'codex_headless_implement'
  let profile = String(s.profile || (tool === 'codex_headless_implement' ? 'implement' : '')).trim()
  if (tool === 'codex_headless_implement' && !PROFILES.has(profile)) profile = 'implement'
  if (tool === 'codex_headless_probe') profile = ''
  const label =
    String(s.label || s.worktree || `codex-impl-${i + 1}`)
      .trim()
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `codex-impl-${i + 1}`
  const worktreePath =
    typeof s.worktreePath === 'string' && s.worktreePath.trim()
      ? s.worktreePath.trim()
      : null
  const worktree =
    s.worktree === undefined || s.worktree === null
      ? tool === 'codex_headless_implement' && profile === 'implement'
        ? label
        : null
      : s.worktree
  const structured =
    s.structured === undefined || s.structured === null
      ? tool === 'codex_headless_implement'
      : Boolean(s.structured)
  return { goal, tool, profile, worktree, worktreePath, label, structured }
}

const SLICE_SCHEMA = {
  type: 'object',
  required: ['slices'],
  properties: {
    slices: {
      type: 'array',
      items: {
        type: 'object',
        required: ['goal', 'tool'],
        properties: {
          goal: { type: 'string' },
          tool: {
            type: 'string',
            enum: ['codex_headless_implement', 'codex_headless_probe'],
          },
          profile: {
            type: 'string',
            enum: ['implement', 'engineer'],
            description:
              'implement = Luna workers (default); engineer = Sol plan-only or bounded Sol edits',
          },
          label: { type: 'string' },
          worktree: { type: 'string' },
          worktreePath: { type: 'string' },
          structured: { type: 'boolean' },
        },
      },
    },
  },
}

const WORKER_SCHEMA = {
  type: 'object',
  required: ['tool', 'summary', 'ok'],
  properties: {
    tool: { type: 'string' },
    profile: { type: 'string' },
    worktree: { type: 'string' },
    cwdUsed: { type: 'string' },
    ok: { type: 'boolean' },
    summary: {
      type: 'string',
      description: 'Compact structured summary from the codex-headless worker',
    },
    changedFiles: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' },
  },
}

const MCP_DISCIPLINE = `
You are a thin wrapper. You MUST use the codex-headless MCP tools
(codex_headless_probe / codex_headless_implement). Do NOT implement edits with
your own Write/Edit tools. Do NOT run tests, installs, builds, or dev servers
unless the slice prompt explicitly requires it.

Profile routing is already decided for you. Pass MCP arguments EXACTLY as given
below (after any required worktree prep). Do NOT substitute a different profile
or tool.

For plan-only engineer slices: the prompt MUST say plan only — do not edit,
create, or delete files.

Return a compact summary only — workers do not see parent history.
`

let slices = Array.isArray(ARGS.slices)
  ? ARGS.slices.map(normalizeSlice).filter(Boolean)
  : []

if (slices.length === 0) {
  phase('Decompose')
  log('No slices provided — decomposing task into parallel codex-headless workers')
  const plan = await agent(
    `Decompose this implementation task into 2–6 independent slices for
codex-headless workers. Each slice must be self-contained.

Task:
<<<TASK
${task}
TASK>>>

Routing:
- codex_headless_probe = cheap Luna read-only survey
- codex_headless_implement + profile=engineer = Sol plan-only or tiny bounded Sol edit
- codex_headless_implement + profile=implement = Luna write workers (default for most slices)
- Prefer structured=true on implement slices
- Suggest a short label/worktree name for each Luna implement slice

Return JSON slices only.`,
    {
      label: 'decompose',
      phase: 'Decompose',
      schema: SLICE_SCHEMA,
    },
  )
  slices = ((plan && plan.slices) || []).map(normalizeSlice).filter(Boolean)
}

if (slices.length === 0) {
  throw new Error('Decomposition produced no slices — provide args.slices or a clearer task')
}

if (slices.length > 8) {
  log(`Capping slices from ${slices.length} to 8`)
  slices = slices.slice(0, 8)
}

phase('Workers')
log(
  `Launching ${slices.length} codex-headless worker(s); cwd=${cwd}; repo=${repo}` +
    (baseRef ? `; baseRef=${baseRef}` : ''),
)

const results = await parallel(
  slices.map((slice, i) => () => {
    const needsWorktreePrep =
      !slice.worktreePath &&
      slice.tool === 'codex_headless_implement' &&
      slice.worktree &&
      baseRef

    const preparedPath =
      slice.worktreePath ||
      (needsWorktreePrep && worktreeParent
        ? `${worktreeParent.replace(/[\\/]+$/, '')}/${slice.label}`
        : needsWorktreePrep
          ? null
          : null)

    const workerCwd = slice.worktreePath || preparedPath || cwd

    const prepBlock = needsWorktreePrep
      ? `
## Worktree prep (required BEFORE MCP)
Do NOT use Workflow isolation:worktree — it binds to the chat session repo, which
may not be the target. Create the worktree yourself:

\`\`\`bash
REPO=${JSON.stringify(repo)}
REF=${JSON.stringify(baseRef)}
WT=${JSON.stringify(
        preparedPath || `${repo.replace(/[\\/]+$/, '')}/.codex-worktrees/${slice.label}`,
      )}
git -C "$REPO" worktree add --detach "$WT" "$REF"
# install deps in the fresh worktree if the project needs them (pnpm/npm/bun)
\`\`\`

Then call MCP with cwd set to that worktree path (absolute).
`
      : slice.worktreePath
        ? `\nUse existing worktreePath as cwd: ${JSON.stringify(slice.worktreePath)}\n`
        : slice.worktree
          ? `\nNo baseRef provided — stay in cwd=${JSON.stringify(cwd)}; keep changes surgical (label ${JSON.stringify(slice.worktree)}).\n`
          : `\n(no worktree — runs in cwd)\n`

    const mcpArgs = {
      cwd: workerCwd,
      ...(slice.tool === 'codex_headless_implement'
        ? {
            profile: slice.profile || 'implement',
            structured: slice.structured,
          }
        : {}),
    }

    return agent(
      `${MCP_DISCIPLINE}

Slice ${i + 1}/${slices.length}
Tool: ${slice.tool}
${slice.profile ? `Profile: ${slice.profile}` : ''}
${prepBlock}

Call ${slice.tool} with EXACTLY these argument values after prep
(add only your expanded \`prompt\`; update cwd if you created a worktree):
${JSON.stringify(mcpArgs, null, 2)}

Overall task (context only):
<<<TASK
${task}
TASK>>>

Your slice goal:
<<<GOAL
${slice.goal}
GOAL>>>

Call the MCP tool now with a self-contained prompt derived from the goal.
Then return ok/summary/changedFiles/risks/error/cwdUsed.`,
      {
        label: `worker:${i + 1}:${slice.label || slice.tool}`,
        phase: 'Workers',
        schema: WORKER_SCHEMA,
      },
    ).then(r =>
      r
        ? {
            index: i + 1,
            goal: slice.goal,
            requested: slice,
            ...r,
          }
        : {
            index: i + 1,
            goal: slice.goal,
            requested: slice,
            ok: false,
            tool: slice.tool,
            profile: slice.profile,
            summary: '',
            error: 'worker agent returned no result',
          },
    )
  }),
)

const workers = results.filter(Boolean)
const failed = workers.filter(w => !w.ok)
log(
  `Workers done: ${workers.length - failed.length}/${workers.length} ok` +
    (failed.length ? `; failed: ${failed.map(w => w.index).join(', ')}` : ''),
)

return {
  cwd,
  repo,
  baseRef,
  task,
  workers,
  failedIndexes: failed.map(w => w.index),
  note:
    'Parent session must integrate worker summaries into the user-facing result. Prefer /codex-review-loop or codex-reviewer for final verification. Never rely on Workflow isolation:worktree when chat cwd ≠ target repo — pass repo+baseRef (and ideally worktreeParent) instead.',
}
