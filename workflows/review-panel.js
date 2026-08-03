/**
 * review-panel workflow — self-contained (no relative imports).
 * Claude Workflow harness does not resolve ESM `./lib` imports; pure helpers
 * for Node unit tests live in `./lib/review-panel-core.js` (crypto sha256).
 * Keep behavioral logic in sync; digest algorithm may differ (harness-safe).
 */

export const meta = {
  name: 'review-panel',
  description:
    'One bounded probe prep → shared evidence packet → parallel tool-light review lenses; host merges verdict',
  whenToUse:
    'Invoked when parallel lens review over a single capped evidence packet is desired. Requires args {scope, cwd}. Optional lenses (default correctness/security/tests-api). Prep uses codex_headless_probe once; lenses do not rediscover the repo.',
  phases: [
    { title: 'Prepare', detail: 'single codex_headless_probe produces capped shared evidence packet' },
    { title: 'Review', detail: 'parallel tool-light lens agents over the same packet' },
    { title: 'Merge', detail: 'host dedupes findings and derives final verdict' },
  ],
}

/* ---- inlined from lib/review-panel-core.js (test source of truth) ---- */
/* No imports: Workflow harness may not resolve ESM (node: or relative). */

/** Target UTF-8 byte budget for the shared evidence packet body. */
const EVIDENCE_BYTE_BUDGET = 6000

/** Default parallel review lenses (tool-light; same evidence packet). */
const DEFAULT_LENSES = [
  {
    id: 'correctness',
    title: 'Correctness',
    focus: 'logic bugs, edge cases, error handling, regressions, incorrect assumptions',
  },
  {
    id: 'security',
    title: 'Security',
    focus: 'injection, authn/authz, secrets exposure, unsafe APIs, trust boundaries',
  },
  {
    id: 'tests-api',
    title: 'Tests & API',
    focus: 'test gaps, API contract breaks, missing coverage on changed paths',
  },
]

const MAX_LENSES = 5

const SEVERITY_RANK = Object.freeze({
  blocker: 4,
  major: 3,
  minor: 2,
  nit: 1,
})

/** Workflow harness sometimes delivers `args` as a JSON string (or twice-encoded). */
function parseWorkflowArgs(raw) {
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
      'review-panel workflow requires args as an object (or JSON string of an object): {scope, cwd, ...}',
    )
  }
  return value
}

/** Require a non-empty scope string. */
function requireScope(scope) {
  if (!scope || typeof scope !== 'string' || !scope.trim()) {
    throw new Error(
      'review-panel workflow requires args: {scope: "<what to review>", cwd: "<absolute workspace path>"}',
    )
  }
  return scope.trim()
}

/** Require an absolute workspace path (posix or Windows drive). */
function requireAbsoluteCwd(cwd) {
  if (!cwd || typeof cwd !== 'string') {
    throw new Error('review-panel workflow requires args.cwd (absolute workspace path)')
  }
  const trimmed = cwd.trim()
  if (!/^([A-Za-z]:[\\/]|\/)/.test(trimmed)) {
    throw new Error('review-panel workflow requires args.cwd as an absolute path')
  }
  return trimmed
}

/** Stable non-crypto digest for packet identity (harness-safe; no node:crypto). */
function sha256(text) {
  let h1 = 0x811c9dc5
  let h2 = 0x1000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 ^= c
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= c
    h2 = Math.imul(h2, 0x01000193) >>> 0
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0') +
    Math.imul(h1 ^ h2, 0x9e3779b9 >>> 0)
      .toString(16)
      .padStart(8, '0') +
    ((h1 + h2) >>> 0).toString(16).padStart(8, '0')
  )
}

/** Truncate `text` to at most `maxBytes` UTF-8 bytes without splitting code units mid-surrogate. */
function capUtf8Bytes(text, maxBytes) {
  if (maxBytes <= 0) return ''
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= maxBytes) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo)
}

/**
 * Build a deterministic evidence packet from prep sections.
 * @param {{ diff?: string, context?: string, tests?: string }} sections
 * @param {number} [budget]
 */
function buildEvidencePacket(sections, budget = EVIDENCE_BYTE_BUDGET) {
  const ordered = [
    ['DIFF', String(sections?.diff ?? '').trim()],
    ['CONTEXT', String(sections?.context ?? '').trim()],
    ['TESTS', String(sections?.tests ?? '').trim()],
  ]
  const parts = ordered
    .filter(([, content]) => content.length > 0)
    .map(([name, content]) => `--- ${name} ---\n${content}`)
  const full = parts.length > 0 ? parts.join('\n\n') : '--- EMPTY ---\n(no evidence sections produced)'
  const digest = sha256(full)
  const fullBytes = Buffer.byteLength(full, 'utf8')

  if (fullBytes <= budget) {
    return {
      body: full,
      bytesUsed: fullBytes,
      byteBudget: budget,
      truncated: false,
      digest,
      fullBytes,
    }
  }

  let prefix = capUtf8Bytes(full, budget)
  let shownBytes = Buffer.byteLength(prefix, 'utf8')
  let suffix = `\n\n[EVIDENCE TRUNCATED: ${shownBytes}/${fullBytes} UTF-8 bytes; full_digest=${digest}]`
  let body = prefix + suffix

  while (Buffer.byteLength(body, 'utf8') > budget) {
    const over = Buffer.byteLength(body, 'utf8') - budget
    prefix = capUtf8Bytes(prefix, Math.max(0, shownBytes - over))
    shownBytes = Buffer.byteLength(prefix, 'utf8')
    suffix = `\n\n[EVIDENCE TRUNCATED: ${shownBytes}/${fullBytes} UTF-8 bytes; full_digest=${digest}]`
    body = prefix + suffix
  }

  const bytesUsed = Buffer.byteLength(body, 'utf8')

  return {
    body,
    bytesUsed,
    byteBudget: budget,
    truncated: true,
    digest,
    fullBytes,
  }
}

/**
 * Normalize caller-provided lenses; fall back to defaults; cap count.
 * @param {unknown} raw
 * @param {number} [maxLenses]
 */
function normalizeLenses(raw, maxLenses = MAX_LENSES) {
  let lenses = DEFAULT_LENSES.map(l => ({ ...l }))

  if (Array.isArray(raw) && raw.length > 0) {
    const parsed = raw
      .map((item, i) => {
        if (!item || typeof item !== 'object') return null
        const id = String(item.id || item.lens || `lens-${i + 1}`)
          .trim()
          .replace(/[^\w.-]+/g, '-')
        const title = String(item.title || id).trim()
        const focus = String(item.focus || item.prompt || title).trim()
        if (!id || !focus) return null
        return { id, title, focus }
      })
      .filter(Boolean)
    if (parsed.length > 0) lenses = parsed
  }

  if (lenses.length > maxLenses) lenses = lenses.slice(0, maxLenses)
  return lenses
}

/** @param {Record<string, unknown>} raw @param {string} lensId */
function normalizeFinding(raw, lensId) {
  if (!raw || typeof raw !== 'object') return null
  const severity = String(raw.severity || '').trim()
  if (!SEVERITY_RANK[severity]) return null

  const file = raw.file != null ? String(raw.file).trim() : ''
  const line = Number.isFinite(raw.line) ? Number(raw.line) : null
  const locationRaw = raw.location != null ? String(raw.location).trim() : ''
  const location =
    locationRaw ||
    (file && line != null ? `${file}:${line}` : file) ||
    'unknown'

  const why = String(raw.why || raw.failure_mode || '').trim()
  const fix = String(raw.fix || raw.suggested_fix || '').trim()
  if (!why) return null

  return {
    severity,
    location,
    why,
    fix,
    lens: lensId,
    accepted: raw.accepted === true,
  }
}

/** @param {{ location?: string, why?: string }} finding */
function findingDedupeKey(finding) {
  const loc = String(finding.location || 'unknown')
    .toLowerCase()
    .replace(/\\/g, '/')
    .trim()
  const why = String(finding.why || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return `${loc}::${why}`
}

/** @param {Array<Record<string, unknown>>} findings @param {string} lensId */
function normalizeFindings(findings, lensId) {
  return (findings || [])
    .map(f => normalizeFinding(f, lensId))
    .filter(Boolean)
}

/**
 * Deterministically merge and dedupe findings from all lenses.
 * @param {Array<{ lens: string, findings?: Array<Record<string, unknown>> }>} lensResults
 */
function mergeFindings(lensResults) {
  /** @type {Map<string, { severity: string, location: string, why: string, fix: string, lens: string, accepted: boolean, lenses: string[] }>} */
  const map = new Map()

  for (const result of lensResults || []) {
    const lensId = String(result?.lens || 'unknown')
    for (const finding of normalizeFindings(result?.findings, lensId)) {
      const key = findingDedupeKey(finding)
      const existing = map.get(key)
      if (!existing) {
        map.set(key, { ...finding, lenses: [finding.lens] })
        continue
      }
      if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[existing.severity]) {
        existing.severity = finding.severity
      }
      if (!existing.lenses.includes(finding.lens)) existing.lenses.push(finding.lens)
      if (finding.why.length > existing.why.length) existing.why = finding.why
      if (finding.fix.length > existing.fix.length) existing.fix = finding.fix
      existing.accepted = existing.accepted || finding.accepted
    }
  }

  return [...map.values()].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (bySeverity !== 0) return bySeverity
    return findingDedupeKey(a).localeCompare(findingDedupeKey(b))
  })
}

/**
 * Host-side final verdict from lens outputs + merged findings.
 * @param {Array<{ verdict?: string }>} lensResults
 * @param {Array<{ severity?: string }>} mergedFindings
 */
function deriveFinalVerdict(lensResults, mergedFindings) {
  const verdicts = (lensResults || []).map(r => String(r?.verdict || 'inconclusive'))

  if (verdicts.includes('fail')) return 'fail'

  const actionable = (mergedFindings || []).some(
    f => f.severity === 'blocker' || f.severity === 'major',
  )
  if (actionable) return 'fail'

  if (verdicts.length > 0 && verdicts.every(v => v === 'inconclusive')) return 'inconclusive'
  if (verdicts.includes('inconclusive')) return 'inconclusive'

  const hasNotes =
    verdicts.includes('pass-with-notes') ||
    (mergedFindings || []).some(f => f.severity === 'minor' || f.severity === 'nit')
  if (hasNotes) return 'pass-with-notes'

  return 'pass'
}

/** @param {string} scope @param {string} cwd */
function buildPrepPrompt(scope, cwd) {
  return `You are a thin evidence-prep wrapper. Run EXACTLY ONE bounded codex_headless_probe
call (read-only). Do NOT launch reviews. Do NOT edit files. Do NOT fan out workers.

Goal: produce raw evidence sections for a shared review packet about this scope:
<<<SCOPE
${scope}
SCOPE>>>

Workspace (absolute): ${cwd}

Probe discipline:
- Prefer review_uncommitted-style diff context when scope implies working tree / uncommitted
- Otherwise embed the smallest sufficient diff + file context for the stated scope
- Include any test output ONLY if you ran a small targeted test command first (optional, max one command)
- Stay focused: no whole-repo tours, no broad file discovery

Return structured sections:
- diff: unified diff or change summary (primary)
- context: brief surrounding context / intent (secondary)
- tests: test command output snippets or "not run" (tertiary)
- summary: one-line prep status
- probeOk: true when probe succeeded; false on MCP failure

Call codex_headless_probe once with cwd=${JSON.stringify(cwd)} and a self-contained prompt.`
}

/**
 * @param {{ id: string, title: string, focus: string }} lens
 * @param {string} scope
 * @param {string} cwd
 * @param {{ body: string, truncated: boolean, digest: string, bytesUsed: number, byteBudget: number }} packet
 */
function buildLensReviewPrompt(lens, scope, cwd, packet) {
  return `You are a tool-light review lens (${lens.id}: ${lens.title}).

Hard rules:
- Review ONLY the evidence packet below. Do NOT use MCP tools, shell, or repository search.
- Do NOT rediscover the codebase or broaden scope beyond: ${JSON.stringify(scope)}
- If evidence is insufficient, return verdict=inconclusive with zero invented findings.
- Output structured JSON only (schema enforced).

Lens focus: ${lens.focus}

Workspace (context only, do not access): ${cwd}

Evidence packet (${packet.bytesUsed}/${packet.byteBudget} UTF-8 bytes${packet.truncated ? ', truncated' : ''}; digest=${packet.digest}):
<<<EVIDENCE
${packet.body}
EVIDENCE>>>

Severity guide: blocker | major | minor | nit
Verdict guide:
- pass: no blocker/major for this lens
- pass-with-notes: only minor/nit findings
- fail: one or more blocker/major for this lens
- inconclusive: insufficient evidence

Set lens=${JSON.stringify(lens.id)} in your response.`
}

const PREP_SCHEMA = {
  type: 'object',
  required: ['summary', 'sections', 'probeOk'],
  properties: {
    summary: { type: 'string' },
    probeOk: { type: 'boolean' },
    error: { type: 'string' },
    sections: {
      type: 'object',
      required: ['diff', 'context', 'tests'],
      properties: {
        diff: { type: 'string' },
        context: { type: 'string' },
        tests: { type: 'string' },
      },
    },
  },
}

const LENS_REVIEW_SCHEMA = {
  type: 'object',
  required: ['lens', 'verdict', 'findings'],
  properties: {
    lens: { type: 'string' },
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
  },
}

const ARGS = parseWorkflowArgs(typeof args === 'undefined' ? null : args)

const scope = requireScope(ARGS.scope)
const cwd = requireAbsoluteCwd(ARGS.cwd)
const lenses = normalizeLenses(ARGS.lenses)

phase('Prepare')
log(`review-panel: prep probe for scope (${lenses.length} lens(es) queued)`)

const prep = await agent(buildPrepPrompt(scope, cwd), {
  label: 'prep:evidence',
  phase: 'Prepare',
  schema: PREP_SCHEMA,
})

if (!prep) {
  throw new Error('review-panel prep agent returned no result')
}

const packet = buildEvidencePacket(prep.sections || {})
log(
  `Evidence packet: ${packet.bytesUsed}/${packet.byteBudget} UTF-8 bytes` +
    (packet.truncated ? ' (truncated)' : '') +
    `; digest=${packet.digest.slice(0, 12)}…`,
)

if (!prep.probeOk) {
  log(`Prep probe reported failure: ${prep.error || prep.summary || 'unknown'}`)
}

phase('Review')
log(`Launching ${lenses.length} parallel tool-light review lens(es)`)

const lensResults = await parallel(
  lenses.map(lens => () =>
    agent(buildLensReviewPrompt(lens, scope, cwd, packet), {
      label: `lens:${lens.id}`,
      phase: 'Review',
      schema: LENS_REVIEW_SCHEMA,
    }).then(result =>
      result
        ? { ...result, lens: result.lens || lens.id }
        : {
            lens: lens.id,
            verdict: 'inconclusive',
            findings: [],
            notes: 'lens agent returned no result',
          },
    ),
  ),
)

phase('Merge')
const mergedFindings = mergeFindings(lensResults)
const finalVerdict = deriveFinalVerdict(lensResults, mergedFindings)
const actionable = mergedFindings.filter(
  f => f.severity === 'blocker' || f.severity === 'major',
)

log(
  `Merged: verdict=${finalVerdict}; findings=${mergedFindings.length}; actionable=${actionable.length}`,
)

return {
  cwd,
  scope,
  prep: {
    summary: prep.summary,
    probeOk: prep.probeOk,
    error: prep.error || null,
  },
  evidence: {
    byteBudget: packet.byteBudget,
    bytesUsed: packet.bytesUsed,
    truncated: packet.truncated,
    digest: packet.digest,
    fullBytes: packet.fullBytes,
  },
  lenses: lenses.map(l => l.id),
  lensResults: lensResults.map(r => ({
    lens: r.lens,
    verdict: r.verdict,
    findingsCount: (r.findings || []).length,
    notes: r.notes || '',
  })),
  finalVerdict,
  findings: mergedFindings,
  remainingActionable: actionable,
  note:
    'Parent session should present merged findings. One probe prep fed all lenses; lenses were tool-light (evidence-only).',
}

