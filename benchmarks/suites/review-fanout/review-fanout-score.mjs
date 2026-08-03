/**
 * Score review findings against frozen known-defects.json.
 */

/**
 * @typedef {{ id: string, severity: string, location_patterns: string[], why_keywords: string[], lenses?: string[] }} Defect
 * @typedef {{ severity?: string, location?: string, why?: string, fix?: string, lens?: string }} Finding
 */

/**
 * @param {string} text
 */
function norm(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {Finding} finding
 * @param {Defect} defect
 */
export function findingMatchesDefect(finding, defect) {
  const loc = norm(finding.location)
  const why = norm(finding.why) + ' ' + norm(finding.fix)
  const locHit = (defect.location_patterns || []).some(p => loc.includes(norm(p)))
  if (!locHit) return false
  const keywords = defect.why_keywords || []
  if (!keywords.length) return locHit
  const hits = keywords.filter(k => why.includes(norm(k))).length
  // Require at least one keyword; prefer ≥2 when many listed
  const need = keywords.length >= 4 ? 2 : 1
  return hits >= need
}

/**
 * @param {Finding[]} findings
 * @param {Defect[]} defects
 */
export function scoreFindings(findings, defects) {
  const list = Array.isArray(findings) ? findings : []
  const defs = Array.isArray(defects) ? defects : []
  /** @type {string[]} */
  const recovered = []
  /** @type {string[]} */
  const missed = []
  /** @type {Map<string, string>} */
  const matchedBy = new Map()

  for (const d of defs) {
    const match = list.find(f => findingMatchesDefect(f, d))
    if (match) {
      recovered.push(d.id)
      matchedBy.set(d.id, String(match.location || ''))
    } else {
      missed.push(d.id)
    }
  }

  const truePositives = recovered.length
  // Precision: findings that match at least one defect
  const matchedFindings = list.filter(f => defs.some(d => findingMatchesDefect(f, d))).length
  const precision = list.length ? matchedFindings / list.length : 1
  const recall = defs.length ? truePositives / defs.length : 1
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)

  return {
    truePositives,
    falsePositives: Math.max(0, list.length - matchedFindings),
    recovered,
    missed,
    matchedBy: Object.fromEntries(matchedBy),
    precision,
    recall,
    f1,
    findingCount: list.length,
    defectCount: defs.length,
  }
}

/**
 * Score findings only when the provider arm completed validly.
 * Invalid/schema-rejected arms must not contribute 0% recall quality samples.
 * @param {Finding[]} findings
 * @param {Defect[]} defects
 * @param {{ validity?: 'valid'|'invalid'|'inconclusive', validityReason?: string | null, validityCode?: string | null }} [meta]
 */
export function scoreFindingsWithValidity(findings, defects, meta = {}) {
  const validity = meta.validity ?? 'valid'
  if (validity !== 'valid') {
    return {
      validity,
      validityReason: meta.validityReason ?? null,
      validityCode: meta.validityCode ?? null,
      truePositives: null,
      falsePositives: null,
      recovered: [],
      missed: (defects || []).map(d => d.id),
      matchedBy: {},
      precision: null,
      recall: null,
      f1: null,
      findingCount: Array.isArray(findings) ? findings.length : 0,
      defectCount: Array.isArray(defects) ? defects.length : 0,
    }
  }
  return { validity: 'valid', validityReason: null, validityCode: null, ...scoreFindings(findings, defects) }
}

/**
 * Best-effort parse of structured review JSON from model content.
 * @param {string} content
 */
export function parseReviewPayload(content) {
  const text = String(content || '').trim()
  if (!text) return { findings: [], verdict: 'inconclusive', raw: null }

  const tryParse = s => {
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }

  let obj = tryParse(text)
  if (!obj) {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fence) obj = tryParse(fence[1].trim())
  }
  if (!obj) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) obj = tryParse(text.slice(start, end + 1))
  }
  if (!obj || typeof obj !== 'object') {
    return { findings: [], verdict: 'inconclusive', raw: null }
  }

  const findings = Array.isArray(obj.findings) ? obj.findings : []
  return {
    findings,
    verdict: typeof obj.verdict === 'string' ? obj.verdict : 'inconclusive',
    lens: typeof obj.lens === 'string' ? obj.lens : undefined,
    raw: obj,
  }
}
