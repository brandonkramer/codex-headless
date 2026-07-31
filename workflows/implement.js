export const meta = {
  name: 'implement',
  description:
    'Fan out codex-headless workers (probe / engineer plan / implement) for a clear-spec task; Claude parent integrates',
  whenToUse:
    'Invoked by /codex-implement when the Workflow tool is available. Requires args {task, cwd}. Optional slices: [{goal, tool?, profile?, worktree?}]. Returns worker summaries for the parent to integrate.',
  phases: [
    { title: 'Decompose', detail: 'split task into independent slices if not provided' },
    { title: 'Workers', detail: 'one thin Claude agent per slice; each must call codex_headless_* MCP' },
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

const task = ARGS && ARGS.task
const cwd = ARGS && ARGS.cwd
if (!task || typeof task !== 'string' || !task.trim()) {
  throw new Error('implement workflow requires args: {task: "<assignment>", cwd: "<workspace>"}')
}
if (!cwd || typeof cwd !== 'string') {
  throw new Error('implement workflow requires args.cwd (absolute workspace path)')
}

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
  const worktree =
    s.worktree === undefined || s.worktree === null
      ? tool === 'codex_headless_implement' && profile === 'implement'
        ? `codex-impl-${i + 1}`
        : null
      : s.worktree
  const structured =
    s.structured === undefined || s.structured === null
      ? tool === 'codex_headless_implement'
      : Boolean(s.structured)
  return { goal, tool, profile, worktree, structured }
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
          worktree: { type: 'string' },
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
below. Do NOT substitute a different profile or tool.

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
- Suggest a short worktree name for each Luna implement slice

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
log(`Launching ${slices.length} codex-headless worker(s) under ${cwd}`)

const results = await parallel(
  slices.map((slice, i) => () => {
    const mcpArgs = {
      cwd,
      ...(slice.tool === 'codex_headless_implement'
        ? {
            profile: slice.profile || 'implement',
            structured: slice.structured,
          }
        : {}),
    }
    const worktreeNote =
      slice.tool === 'codex_headless_implement' && slice.worktree
        ? `\nIsolation: prefer worktree/name ${JSON.stringify(slice.worktree)} if the parent already created one; otherwise stay in cwd and keep changes surgical.`
        : slice.tool === 'codex_headless_implement'
          ? '\n(no worktree — this slice runs in-tree)'
          : ''

    return agent(
      `${MCP_DISCIPLINE}

Slice ${i + 1}/${slices.length}
Tool: ${slice.tool}
${slice.profile ? `Profile: ${slice.profile}` : ''}

Call ${slice.tool} with EXACTLY these argument values, copied verbatim
(add only your expanded \`prompt\`):
${JSON.stringify(mcpArgs, null, 2)}
${worktreeNote}

Overall task (context only):
<<<TASK
${task}
TASK>>>

Your slice goal:
<<<GOAL
${slice.goal}
GOAL>>>

Call the MCP tool now with a self-contained prompt derived from the goal.
Then return ok/summary/changedFiles/risks/error.`,
      {
        label: `worker:${i + 1}:${slice.tool}`,
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
  task,
  workers,
  failedIndexes: failed.map(w => w.index),
  note:
    'Parent session must integrate worker summaries into the user-facing result. Prefer /codex-review-loop or codex-reviewer for final verification.',
}
