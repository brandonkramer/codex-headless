import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  armOrderForTrial,
  bootstrapMedianDiffCI,
  evidenceLabel,
  extractPathMentions,
  median,
  percentile,
  schedulingFromStages,
  summarizeJsonlMetrics,
  withEvidenceSuffix,
} from './review-brief-metrics.mjs'

describe('review-brief-metrics', () => {
  it('randomizes AB/BA deterministically per trial', () => {
    const a = armOrderForTrial(0, 42, 'A', 'B')
    const b = armOrderForTrial(0, 42, 'A', 'B')
    assert.deepEqual(a, b)
    const orders = new Set()
    for (let i = 0; i < 20; i++) orders.add(armOrderForTrial(i, 7, 'A', 'B').join(','))
    assert.ok(orders.has('A,B'))
    assert.ok(orders.has('B,A'))
  })

  it('scheduling models sequential work and parallel latency', () => {
    const s = schedulingFromStages({ prepMs: 100, stageMs: [50, 80, 40] })
    assert.equal(s.provider_work_ms, 270)
    assert.equal(s.user_latency_ms_parallel_model, 180)
  })

  it('summarizes JSONL turns/tools/usage', () => {
    const jsonl = [
      JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'command_execution', command: 'cat src/a.js' },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'mcp_tool_call', tool: 'probe' },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 10,
          cached_input_tokens: 2,
          output_tokens: 3,
          reasoning_output_tokens: 1,
        },
      }),
    ].join('\n')
    const m = summarizeJsonlMetrics(jsonl)
    assert.equal(m.turns, 1)
    assert.equal(m.toolLike, 2)
    assert.equal(m.usage?.input_tokens, 10)
  })

  it('median / percentile / bootstrap basics', () => {
    assert.equal(median([1, 3, 2]), 2)
    assert.equal(percentile([0, 10], 50), 5)
    const ci = bootstrapMedianDiffCI([10, 12, 11], [5, 6, 4], 200, 1)
    assert.ok(ci.diff != null && ci.diff < 0)
    assert.ok(ci.lo != null && ci.hi != null)
  })

  it('evidence label and path mentions', () => {
    assert.equal(evidenceLabel(3), 'exploratory')
    assert.equal(evidenceLabel(5), 'confirmatory')
    assert.equal(withEvidenceSuffix('PASS', 3), 'PASS_EXPLORATORY')
    assert.deepEqual(extractPathMentions(['command:cat src/math.js', 'docs/README.md']), [
      'docs/README.md',
      'src/math.js',
    ])
  })
})
