export function phoneToUsername(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return `7${digits.slice(1)}`
  }
  if (digits.length === 10) return `7${digits}`
  return null
}
