import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  detectJsonlInvalidity,
  mergeArmValidity,
  validArmValues,
  countValidArms,
} from './trial-validity.mjs'
import { scoreFindingsWithValidity } from '../review-fanout/review-fanout-score.mjs'
import { scoreBriefTrial } from '../brief-efficiency/brief-efficiency-score.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const V1_BRIEF_JSONL = join(HERE, '../out/brief-efficiency/trial-0/typed_brief.jsonl')
const V1_REVIEW_JSONL = join(HERE, '../out/review-fanout/trial-0/baseline-correctness.jsonl')

const SCHEMA_400 = [
  JSON.stringify({ type: 'thread.started', thread_id: 'x' }),
  JSON.stringify({
    type: 'error',
    message: JSON.stringify({
      error: {
        code: 'invalid_json_schema',
        message: "Missing 'recommended_verification'.",
        status: 400,
      },
    }),
  }),
  JSON.stringify({
    type: 'turn.failed',
    error: { message: 'invalid_json_schema' },
  }),
].join('\n')

describe('trial-validity', () => {
  it('detects v1 live schema-400 JSONL as invalid', () => {
    const brief = detectJsonlInvalidity(readFileSync(V1_BRIEF_JSONL, 'utf8'))
    assert.equal(brief.validity, 'invalid')
    assert.equal(brief.code, 'invalid_json_schema')

    const review = detectJsonlInvalidity(readFileSync(V1_REVIEW_JSONL, 'utf8'))
    assert.equal(review.validity, 'invalid')
    assert.equal(review.code, 'invalid_json_schema')
  })

  it('does not score invalid review arms as 0% recall', () => {
    const scored = scoreFindingsWithValidity([], [{ id: 'D1' }], {
      validity: 'invalid',
      validityReason: 'invalid_json_schema',
      validityCode: 'invalid_json_schema',
    })
    assert.equal(scored.validity, 'invalid')
    assert.equal(scored.recall, null)
    assert.equal(scored.precision, null)
  })

  it('does not score invalid brief arms as quality 0', () => {
    const scored = scoreBriefTrial({
      changedFiles: [],
      writeScope: ['src/math.js'],
      startFiles: ['src/math.js'],
      toolSummaries: [],
      toolLike: 0,
      testsPassed: false,
      validity: 'invalid',
      validityReason: 'invalid_json_schema',
      validityCode: 'invalid_json_schema',
    })
    assert.equal(scored.validity, 'invalid')
    assert.equal(scored.quality, null)
    assert.equal(scored.waste, null)
  })

  it('mergeArmValidity fails closed on any invalid stage', () => {
    const validJsonl = [
      JSON.stringify({ type: 'turn.completed' }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: '{"verdict":"fail","findings":[]}' },
      }),
    ].join('\n')
    assert.equal(detectJsonlInvalidity(validJsonl).validity, 'valid')
    const merged = mergeArmValidity([SCHEMA_400, validJsonl])
    assert.equal(merged.validity, 'invalid')
  })

  it('validArmValues excludes invalid arms from medians', () => {
    const trials = [
      {
        arms: {
          loose_prompt: { validity: 'invalid', waste: 0 },
          typed_brief: { validity: 'valid', waste: 3 },
        },
      },
      {
        arms: {
          loose_prompt: { validity: 'valid', waste: 10 },
          typed_brief: { validity: 'valid', waste: 2 },
        },
      },
    ]
    assert.deepEqual(validArmValues(trials, 'loose_prompt', 'waste'), [10])
    assert.equal(countValidArms(trials, 'loose_prompt'), 1)
  })
})
