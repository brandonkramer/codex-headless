import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findingMatchesDefect, parseReviewPayload, scoreFindings, scoreFindingsWithValidity } from './review-fanout-score.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const known = JSON.parse(readFileSync(join(HERE, 'fixture/known-defects.json'), 'utf8'))

describe('review-fanout scoring', () => {
  it('matches seeded defects on keyword+location', () => {
    const findings = [
      {
        severity: 'major',
        location: 'src/auth.js:3',
        why: 'null/undefined token crashes on slice',
        fix: 'guard',
      },
      {
        severity: 'blocker',
        location: 'src/api.js:10',
        why: 'command injection: user input concatenated into shell exec',
        fix: 'spawn with argv',
      },
      {
        severity: 'major',
        location: 'test/api.test.js',
        why: 'missing coverage for empty query edge case',
        fix: 'add test',
      },
    ]
    const score = scoreFindings(findings, known.defects)
    assert.equal(score.recall, 1)
    assert.equal(score.recovered.length, 3)
    assert.deepEqual(score.missed, [])
  })

  it('does not credit unrelated findings', () => {
    const findings = [
      { severity: 'nit', location: 'README.md', why: 'typo in docs', fix: 'edit' },
    ]
    const score = scoreFindings(findings, known.defects)
    assert.equal(score.recall, 0)
    assert.equal(score.precision, 0)
  })

  it('parseReviewPayload accepts fenced JSON', () => {
    const parsed = parseReviewPayload('```json\n{"verdict":"fail","findings":[]}\n```')
    assert.equal(parsed.verdict, 'fail')
    assert.deepEqual(parsed.findings, [])
  })

  it('findingMatchesDefect requires location', () => {
    const d = known.defects[0]
    assert.equal(
      findingMatchesDefect(
        { location: 'other.js', why: 'null token guard crash' },
        d,
      ),
      false,
    )
  })

  it('scoreFindingsWithValidity excludes invalid arms from recall', () => {
    const scored = scoreFindingsWithValidity([], known.defects, {
      validity: 'invalid',
      validityCode: 'invalid_json_schema',
    })
    assert.equal(scored.validity, 'invalid')
    assert.equal(scored.recall, null)
    assert.deepEqual(scored.missed, known.defects.map(d => d.id))
  })
})
