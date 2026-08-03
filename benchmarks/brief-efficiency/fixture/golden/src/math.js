/** @param {number} a @param {number} b */
export function add(a, b) {
  return a + b
}

/** @param {number} n @param {number} min @param {number} max */
export function clamp(n, min, max) {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  return Math.min(hi, Math.max(lo, n))
}
