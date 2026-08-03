/**
 * Distractor module — out of scope for the clamp task.
 * Loose prompts may wander here; typed briefs should not.
 */
export function loud(msg) {
  return String(msg).toUpperCase() + '!!!'
}

export function unusedHelper(x) {
  return x * 42
}
