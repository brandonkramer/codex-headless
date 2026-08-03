import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EVIDENCE_BYTE_BUDGET,
  DEFAULT_LENSES,
  MAX_LENSES,
  buildEvidencePacket,
  capUtf8Bytes,
  deriveFinalVerdict,
  findingDedupeKey,
  mergeFindings,
  normalizeLenses,
  parseWorkflowArgs,
  requireAbsoluteCwd,
  requireScope,
  sha256,
} from './lib/review-panel-core.js'

describe('parseWorkflowArgs', () => {
  it('parses object args', () => {
    assert.deepEqual(parseWorkflowArgs({ scope: 'x', cwd: '/tmp' }), { scope: 'x', cwd: '/tmp' })
  })

  it('parses JSON string args (including double-encoded)', () => {
    const once = JSON.stringify({ scope: 'a', cwd: '/a' })
    assert.deepEqual(parseWorkflowArgs(once), { scope: 'a', cwd: '/a' })
    assert.deepEqual(parseWorkflowArgs(JSON.stringify(once)), { scope: 'a', cwd: '/a' })
  })

  it('rejects non-object args', () => {
    assert.throws(() => parseWorkflowArgs(null), /requires args as an object/)
    assert.throws(() => parseWorkflowArgs('not-json'), /requires args as an object/)
  })
})

describe('requireScope / requireAbsoluteCwd', () => {
  it('requires non-empty scope', () => {
    assert.equal(requireScope('  diff '), 'diff')
    assert.throws(() => requireScope(''), /requires args.*scope/)
  })

  it('requires absolute cwd', () => {
    assert.equal(requireAbsoluteCwd('/Users/x/repo'), '/Users/x/repo')
    assert.throws(() => requireAbsoluteCwd('relative/path'), /absolute path/)
    assert.throws(() => requireAbsoluteCwd(null), /requires args\.cwd/)
  })
})

describe('buildEvidencePacket byte cap', () => {
  it('passes through small packets unchanged', () => {
    const packet = buildEvidencePacket({
      diff: 'file.ts: +1',
      context: 'small change',
      tests: 'not run',
    })
    assert.equal(packet.truncated, false)
    assert.ok(packet.bytesUsed <= EVIDENCE_BYTE_BUDGET)
    assert.ok(packet.body.includes('--- DIFF ---'))
    assert.equal(packet.digest, sha256(packet.body))
  })

  it('truncates deterministically with digest metadata', () => {
    const big = 'x'.repeat(EVIDENCE_BYTE_BUDGET * 2)
    const packet = buildEvidencePacket({ diff: big, context: 'ctx', tests: 't' })
    assert.equal(packet.truncated, true)
    assert.ok(packet.bytesUsed <= EVIDENCE_BYTE_BUDGET)
    assert.ok(packet.body.includes('[EVIDENCE TRUNCATED:'))
    assert.ok(packet.body.includes(`full_digest=${packet.digest}`))
    const again = buildEvidencePacket({ diff: big, context: 'ctx', tests: 't' })
    assert.equal(again.digest, packet.digest)
    assert.equal(again.body, packet.body)
  })

  it('capUtf8Bytes respects UTF-8 byte boundaries', () => {
    const text = 'é'.repeat(10)
    const capped = capUtf8Bytes(text, 5)
    assert.ok(Buffer.byteLength(capped, 'utf8') <= 5)
  })
})

describe('normalizeLenses', () => {
  it('defaults to correctness/security/tests-api', () => {
    const lenses = normalizeLenses(undefined)
    assert.deepEqual(
      lenses.map(l => l.id),
      DEFAULT_LENSES.map(l => l.id),
    )
  })

  it('caps custom lens count', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `l${i}`,
      title: `L${i}`,
      focus: `focus ${i}`,
    }))
    const lenses = normalizeLenses(many)
    assert.equal(lenses.length, MAX_LENSES)
  })
})

describe('mergeFindings + deriveFinalVerdict', () => {
  it('dedupes same finding across lenses keeping higher severity', () => {
    const merged = mergeFindings([
      {
        lens: 'correctness',
        findings: [
          {
            severity: 'major',
            location: 'src/a.ts:10',
            why: 'null deref on empty input',
            fix: 'guard clause',
          },
        ],
      },
      {
        lens: 'security',
        findings: [
          {
            severity: 'minor',
            location: 'src/a.ts:10',
            why: 'null deref on empty input',
            fix: 'validate input',
          },
        ],
      },
    ])
    assert.equal(merged.length, 1)
    assert.equal(merged[0].severity, 'major')
    assert.deepEqual(merged[0].lenses.sort(), ['correctness', 'security'])
  })

  it('sorts deterministically by severity then key', () => {
    const merged = mergeFindings([
      {
        lens: 'a',
        findings: [
          { severity: 'nit', location: 'b.ts', why: 'style', fix: 'fmt' },
          { severity: 'blocker', location: 'a.ts', why: 'crash', fix: 'fix' },
        ],
      },
    ])
    assert.equal(merged[0].severity, 'blocker')
    assert.equal(merged[1].severity, 'nit')
  })

  it('derives fail when any lens fails or actionable findings remain', () => {
    const findings = mergeFindings([
      {
        lens: 'correctness',
        findings: [
          { severity: 'major', location: 'x', why: 'bug', fix: 'patch' },
        ],
      },
    ])
    assert.equal(
      deriveFinalVerdict([{ verdict: 'pass' }, { verdict: 'pass-with-notes' }], findings),
      'fail',
    )
    assert.equal(
      deriveFinalVerdict([{ verdict: 'fail' }, { verdict: 'pass' }], []),
      'fail',
    )
  })

  it('derives pass-with-notes for minor-only findings', () => {
    const findings = mergeFindings([
      {
        lens: 'tests-api',
        findings: [
          { severity: 'minor', location: 't.test.ts', why: 'missing case', fix: 'add test' },
        ],
      },
    ])
    assert.equal(
      deriveFinalVerdict([{ verdict: 'pass' }, { verdict: 'pass' }], findings),
      'pass-with-notes',
    )
  })

  it('derives inconclusive when all lenses inconclusive', () => {
    assert.equal(
      deriveFinalVerdict(
        [{ verdict: 'inconclusive' }, { verdict: 'inconclusive' }],
        [],
      ),
      'inconclusive',
    )
  })

  it('findingDedupeKey is stable', () => {
    const a = findingDedupeKey({ location: 'Src\\A.ts', why: '  two  spaces  ' })
    const b = findingDedupeKey({ location: 'src/a.ts', why: 'two spaces' })
    assert.equal(a, b)
  })
})
