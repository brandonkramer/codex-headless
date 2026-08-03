import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import {
  assembleImplementPrompt,
  parseImplementBrief,
} from '../../src/implement-brief.ts'
import {
  countOutOfScopeReads,
  countOutOfScopeWrites,
  scoreBriefTrial,
  wasteScore,
} from './brief-efficiency-score.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixture')

describe('brief-efficiency scoring + fixture', () => {
  it('parses brief and preamble includes write scope + checks', () => {
    const brief = parseImplementBrief(
      JSON.parse(readFileSync(join(FIXTURE, 'brief.json'), 'utf8')),
    )
    const preamble = assembleImplementPrompt(brief)
    assert.match(preamble, /Write scope/)
    assert.match(preamble, /src\/math\.js/)
    assert.match(preamble, /node --test test\/math\.test\.js/)
  })

  it('seed fails acceptance; golden passes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brief-score-'))
    // Clear NODE_TEST_CONTEXT so nested `node --test` is not a silent child of this runner.
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    try {
      cpSync(join(FIXTURE, 'seed'), dir, { recursive: true })
      let r = spawnSync(process.execPath, ['--test', 'test/math.test.js'], {
        cwd: dir,
        encoding: 'utf8',
        env,
      })
      assert.notEqual(r.status, 0)
      writeFileSync(
        join(dir, 'src/math.js'),
        readFileSync(join(FIXTURE, 'golden/src/math.js'), 'utf8'),
      )
      r = spawnSync(process.execPath, ['--test', 'test/math.test.js'], {
        cwd: dir,
        encoding: 'utf8',
        env,
      })
      assert.equal(r.status, 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('counts out-of-scope writes and computes waste', () => {
    const writes = countOutOfScopeWrites(
      ['src/math.js', 'src/noise.js', 'docs/README.md'],
      ['src/math.js', 'test/math.test.js'],
    )
    assert.equal(writes.count, 2)
    const reads = countOutOfScopeReads(
      ['src/noise.js', 'src/math.js'],
      ['src/math.js', 'test/math.test.js'],
    )
    assert.equal(reads.count, 1)
    assert.equal(wasteScore({ outOfScopeWrites: 2, outOfScopeReads: 1, toolLike: 5 }), 27)
  })

  it('scoreBriefTrial prefers scoped low-waste outcomes', () => {
    const loose = scoreBriefTrial({
      changedFiles: ['src/math.js', 'src/noise.js'],
      writeScope: ['src/math.js', 'test/math.test.js'],
      startFiles: ['src/math.js', 'test/math.test.js'],
      toolSummaries: ['command:cat src/noise.js', 'command:cat docs/README.md'],
      toolLike: 6,
      testsPassed: true,
    })
    const brief = scoreBriefTrial({
      changedFiles: ['src/math.js'],
      writeScope: ['src/math.js', 'test/math.test.js'],
      startFiles: ['src/math.js', 'test/math.test.js'],
      toolSummaries: ['command:cat src/math.js'],
      toolLike: 2,
      testsPassed: true,
    })
    assert.equal(loose.quality, brief.quality)
    assert.ok(brief.waste < loose.waste)
  })

  it('invalid provider arm returns null quality/waste not zero', () => {
    const invalid = scoreBriefTrial({
      changedFiles: [],
      writeScope: ['src/math.js'],
      startFiles: ['src/math.js'],
      toolSummaries: [],
      toolLike: 0,
      testsPassed: false,
      validity: 'invalid',
      validityCode: 'invalid_json_schema',
    })
    assert.equal(invalid.validity, 'invalid')
    assert.equal(invalid.quality, null)
    assert.equal(invalid.waste, null)
  })
})
