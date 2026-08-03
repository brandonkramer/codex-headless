export function sessionLabel(user) {
  // BUG: user.token may be null/undefined — callers crash on .slice
  return user.name + ' #' + user.token.slice(0, 8)
}

export function isAdmin(user) {
  return user.role === 'admin'
}
