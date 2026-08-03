/**
 * Detect provider/schema failures that invalidate a benchmark arm.
 * API/schema errors must not be scored as 0% quality samples.
 */

/** @typedef {'valid'|'invalid'|'inconclusive'} TrialValidity */

/**
 * @param {string} jsonlText
 * @returns {{ valid: boolean, validity: TrialValidity, reason: string | null, code: string | null }}
 */
export function detectJsonlInvalidity(jsonlText) {
  const text = String(jsonlText || '')
  if (!text.trim()) {
    return { valid: false, validity: 'invalid', reason: 'empty_jsonl', code: null }
  }

  let schemaError = false
  /** @type {string | null} */
  let code = null
  /** @type {string | null} */
  let reason = null
  let turns = 0
  let turnFailed = false
  let agentMessage = false

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (!obj || typeof obj !== 'object') continue

    const type = obj.type
    if (type === 'turn.completed') turns += 1

    if (type === 'item.completed') {
      const item = obj.item && typeof obj.item === 'object' ? obj.item : null
      if (item?.type === 'agent_message' && String(item.text || '').trim()) {
        agentMessage = true
      }
    }

    const errText = extractErrorText(obj)
    if (errText) {
      const parsed = parseProviderError(errText)
      if (parsed.code === 'invalid_json_schema') {
        schemaError = true
        code = parsed.code
        reason = parsed.message || 'invalid_json_schema'
      }
      if (type === 'turn.failed') {
        turnFailed = true
        if (!reason) reason = parsed.message || 'turn_failed'
        if (!code) code = parsed.code
      }
    }
  }

  if (schemaError || (turnFailed && turns === 0)) {
    return {
      valid: false,
      validity: 'invalid',
      reason: reason || 'provider_schema_rejection',
      code: code || 'invalid_json_schema',
    }
  }

  if (turns === 0 && !agentMessage) {
    return {
      valid: false,
      validity: 'inconclusive',
      reason: 'no_completed_turn_or_agent_message',
      code: null,
    }
  }

  return { valid: true, validity: 'valid', reason: null, code: null }
}

/**
 * @param {object} event
 */
function extractErrorText(event) {
  if (event.type === 'error' && typeof event.message === 'string') return event.message
  if (event.type === 'turn.failed') {
    const err = event.error
    if (typeof err === 'string') return err
    if (err && typeof err.message === 'string') return err.message
  }
  return null
}

/**
 * @param {string} text
 */
function parseProviderError(text) {
  const raw = String(text || '').trim()
  try {
    const outer = JSON.parse(raw)
    const inner = outer?.error?.error ?? outer?.error ?? outer
    return {
      code: typeof inner?.code === 'string' ? inner.code : null,
      message: typeof inner?.message === 'string' ? inner.message : raw.slice(0, 240),
      status: inner?.status ?? outer?.status ?? null,
    }
  } catch {
    if (/invalid_json_schema/i.test(raw)) {
      return { code: 'invalid_json_schema', message: raw.slice(0, 240), status: 400 }
    }
    return { code: null, message: raw.slice(0, 240), status: null }
  }
}

/**
 * Arm is invalid when any stage JSONL is invalid (schema/API failure).
 * @param {string[]} jsonlTexts
 */
export function mergeArmValidity(jsonlTexts) {
  /** @type {ReturnType<typeof detectJsonlInvalidity>[]} */
  const parts = (jsonlTexts || []).map(t => detectJsonlInvalidity(t))
  const invalid = parts.find(p => p.validity === 'invalid')
  if (invalid) return { ...invalid, stages: parts.length, invalidStages: parts.filter(p => !p.valid).length }
  const inconclusive = parts.find(p => p.validity === 'inconclusive')
  if (inconclusive) {
    return { ...inconclusive, stages: parts.length, invalidStages: parts.filter(p => !p.valid).length }
  }
  return { valid: true, validity: 'valid', reason: null, code: null, stages: parts.length, invalidStages: 0 }
}

/**
 * Filter numeric medians to arms marked validity === 'valid'.
 * @param {object[]} trials
 * @param {string} arm
 * @param {string} key
 * @param {(v: unknown) => boolean} [predicate]
 */
export function validArmValues(trials, arm, key, predicate = v => typeof v === 'number') {
  return trials
    .map(t => {
      const a = t.arms?.[arm]
      if (!a || a.validity !== 'valid') return null
      const v = a[key]
      return predicate(v) ? v : null
    })
    .filter(v => v != null)
}

/**
 * @param {object[]} trials
 * @param {string} arm
 */
export function countValidArms(trials, arm) {
  return trials.filter(t => t.arms?.[arm]?.validity === 'valid').length
}
