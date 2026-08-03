import test from 'node:test'
import assert from 'node:assert/strict'
import { health } from '../src/api.js'

test('health ok', () => {
  assert.equal(health().ok, true)
})
// Note: no tests added for runReport or empty-query rejection
