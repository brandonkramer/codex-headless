import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EVIDENCE_BYTE_BUDGET,
  buildEvidencePacket,
  mergeFindings,
  sha256,
} from '../../../workflows/lib/review-panel-core.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const sections = JSON.parse(
  readFileSync(join(HERE, 'fixture/evidence-sections.json'), 'utf8'),
)

describe('review-fanout packet deterministic proofs', () => {
  it('builds packet within 6000-byte budget from frozen fixture', () => {
    const packet = buildEvidencePacket(sections, EVIDENCE_BYTE_BUDGET)
    assert.ok(packet.bytesUsed <= EVIDENCE_BYTE_BUDGET)
    assert.equal(packet.byteBudget, 6000)
    assert.equal(packet.truncated, false)
    assert.equal(packet.digest, sha256(packet.body))
    assert.match(packet.digest, /^[a-f0-9]{64}$/)
  })

  it('digest and body are stable across rebuilds', () => {
    const a = buildEvidencePacket(sections)
    const b = buildEvidencePacket(sections)
    assert.equal(a.digest, b.digest)
    assert.equal(a.body, b.body)
    assert.equal(a.bytesUsed, b.bytesUsed)
  })

  it('truncation keeps bytesUsed ≤ budget and embeds full_digest', () => {
    const huge = {
      diff: 'D'.repeat(EVIDENCE_BYTE_BUDGET * 3),
      context: 'C'.repeat(1000),
      tests: 'T'.repeat(1000),
    }
    const packet = buildEvidencePacket(huge)
    assert.equal(packet.truncated, true)
    assert.ok(packet.bytesUsed <= EVIDENCE_BYTE_BUDGET)
    assert.ok(packet.body.includes(`full_digest=${packet.digest}`))
    const again = buildEvidencePacket(huge)
    assert.equal(again.body, packet.body)
  })

  it('mergeFindings dedupes across lenses', () => {
    const merged = mergeFindings([
      {
        lens: 'correctness',
        findings: [
          {
            severity: 'major',
            location: 'src/auth.js:3',
            why: 'null token slice',
            fix: 'guard',
          },
        ],
      },
      {
        lens: 'security',
        findings: [
          {
            severity: 'minor',
            location: 'src/auth.js:3',
            why: 'null token slice',
            fix: 'optional chain',
          },
        ],
      },
    ])
    assert.equal(merged.length, 1)
    assert.equal(merged[0].severity, 'major')
  })
})
