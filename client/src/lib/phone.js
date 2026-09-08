export function phoneToUsername(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return `u7${digits.slice(1)}`
  }
  if (digits.length === 10) return `u7${digits}`
  return null
}

// Inverse of phoneToUsername: pulls the phone number back out of a Matrix
// user_id/username so the UI can show "+7 921 400-18-80" instead of the
// internal "@u79214001880:messanger.qts.dev" - accounts made any other way
// (e.g. dev/test seed users) don't match and get no result.
export function usernameToPhone(userIdOrUsername) {
  const localpart = String(userIdOrUsername ?? '').replace(/^@/, '').split(':')[0]
  const m = /^u(7\d{10})$/.exec(localpart)
  if (!m) return null
  const d = m[1]
  return `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`
}
