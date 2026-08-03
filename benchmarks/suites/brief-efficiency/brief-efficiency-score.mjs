/**
 * Score brief-efficiency trial outcomes (waste + quality).
 */

import { pathMatchesWriteScope } from '../../../src/implement-brief.ts'
import { extractPathMentions } from '../shared/review-brief-metrics.mjs'

/**
 * @param {string[]} changedFiles
 * @param {string[]} writeScope
 */
export function countOutOfScopeWrites(changedFiles, writeScope) {
  const violations = []
  for (const file of changedFiles || []) {
    const ok = (writeScope || []).some(scope => pathMatchesWriteScope(file, scope))
    if (!ok) violations.push(file)
  }
  return { count: violations.length, violations }
}

/**
 * @param {string[]} pathMentions
 * @param {string[]} allowedRoots — files + writeScope
 */
export function countOutOfScopeReads(pathMentions, allowedRoots) {
  const allowed = allowedRoots || []
  const violations = []
  for (const p of pathMentions || []) {
    const ok = allowed.some(scope => pathMatchesWriteScope(p, scope) || p === scope)
    if (!ok) violations.push(p)
  }
  return { count: violations.length, violations }
}

/**
 * @param {{ outOfScopeWrites: number, outOfScopeReads: number, toolLike: number }} m
 */
export function wasteScore(m) {
  return 10 * (m.outOfScopeWrites || 0) + 2 * (m.outOfScopeReads || 0) + (m.toolLike || 0)
}

/**
 * @param {object} opts
 * @param {string[]} opts.changedFiles
 * @param {string[]} opts.writeScope
 * @param {string[]} opts.startFiles
 * @param {string[]} opts.toolSummaries
 * @param {number} opts.toolLike
 * @param {boolean | null} [opts.testsPassed]
 * @param {'valid'|'invalid'|'inconclusive'} [opts.validity]
 * @param {string | null} [opts.validityReason]
 * @param {string | null} [opts.validityCode]
 */
export function scoreBriefTrial(opts) {
  const validity = opts.validity ?? 'valid'
  if (validity !== 'valid') {
    return {
      validity,
      validityReason: opts.validityReason ?? null,
      validityCode: opts.validityCode ?? null,
      testsPassed: null,
      quality: null,
      outOfScopeWrites: null,
      outOfScopeWritePaths: [],
      outOfScopeReads: null,
      outOfScopeReadPaths: [],
      pathMentions: [],
      toolLike: opts.toolLike || 0,
      waste: null,
    }
  }

  const writes = countOutOfScopeWrites(opts.changedFiles, opts.writeScope)
  const mentions = extractPathMentions(opts.toolSummaries || [])
  const allowed = [...new Set([...(opts.startFiles || []), ...(opts.writeScope || [])])]
  const reads = countOutOfScopeReads(mentions, allowed)
  const waste = wasteScore({
    outOfScopeWrites: writes.count,
    outOfScopeReads: reads.count,
    toolLike: opts.toolLike || 0,
  })
  return {
    validity: 'valid',
    validityReason: null,
    validityCode: null,
    testsPassed: Boolean(opts.testsPassed),
    quality: opts.testsPassed ? 1 : 0,
    outOfScopeWrites: writes.count,
    outOfScopeWritePaths: writes.violations,
    outOfScopeReads: reads.count,
    outOfScopeReadPaths: reads.violations,
    pathMentions: mentions,
    toolLike: opts.toolLike || 0,
    waste,
  }
}
