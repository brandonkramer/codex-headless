import test from 'node:test'
import assert from 'node:assert/strict'
import { add, clamp } from '../src/math.js'

test('add', () => {
  assert.equal(add(1, 2), 3)
})

test('clamp within range', () => {
  assert.equal(clamp(5, 0, 10), 5)
})

test('clamp below min', () => {
  assert.equal(clamp(-1, 0, 10), 0)
})

test('clamp above max', () => {
  assert.equal(clamp(99, 0, 10), 10)
})

test('clamp swaps inverted bounds', () => {
  assert.equal(clamp(5, 10, 0), 5)
  assert.equal(clamp(-1, 10, 0), 0)
  assert.equal(clamp(99, 10, 0), 10)
})
