import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  codexStrictSchemaViolations,
  loadAndValidateSchema,
  loadBundledSchemaValidation,
  runSchemaPreflight,
} from './schema-preflight.mjs'

describe('schema-preflight', () => {
  it('bundled review + implement schemas pass Codex strict validation', () => {
    const review = loadBundledSchemaValidation('review')
    const implement = loadBundledSchemaValidation('implement')
    assert.equal(review.ok, true, review.violations?.join('; '))
    assert.equal(implement.ok, true, implement.violations?.join('; '))
  })

  it('flags stale schema missing required property keys', () => {
    const stale = {
      type: 'object',
      properties: {
        changed_files: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
        risks: { type: 'array', items: { type: 'string' } },
        recommended_verification: { type: 'array', items: { type: 'string' } },
      },
      required: ['changed_files', 'summary', 'risks'],
      additionalProperties: false,
    }
    const violations = codexStrictSchemaViolations(stale)
    assert.ok(violations.some(v => v.includes('recommended_verification')))
  })

  it('effective schema defaults to bundled (matches resolveStructuredSchema)', () => {
    const effective = loadAndValidateSchema('review')
    assert.equal(effective.source, 'bundled')
    assert.equal(effective.ok, true, effective.violations?.join('; '))
    assert.match(effective.path, /schemas\/reviewer-verdict\.schema\.json$/)
  })

  it('dry-run preflight reports bundled + effective checks without live calls', async () => {
    const result = await runSchemaPreflight({ kinds: ['review', 'implement'], dryRun: true })
    assert.ok(result.checks.some(c => c.phase === 'bundled_strict' && c.kind === 'review' && c.ok))
    assert.ok(result.checks.some(c => c.phase === 'bundled_strict' && c.kind === 'implement' && c.ok))
    assert.ok(result.checks.some(c => c.phase === 'effective_strict'))
    assert.ok(!result.checks.some(c => c.phase === 'live_probe'))
  })
})
