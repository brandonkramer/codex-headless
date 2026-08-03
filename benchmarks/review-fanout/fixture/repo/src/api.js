import { execSync } from 'node:child_process'
import { sessionLabel } from './auth.js'

export function health() {
  return { ok: true }
}

export function runReport(query) {
  // BUG: unsanitized user input passed to shell
  return execSync('node scripts/report.js ' + query, { encoding: 'utf8' })
}

export function greet(user) {
  return 'hi ' + sessionLabel(user)
}
