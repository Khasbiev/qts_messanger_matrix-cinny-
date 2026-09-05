const URL_PATTERN = /https?:\/\/[^\s<>"']+/g
const ALWAYS_TRIM = '.,;:!?'
const CLOSERS = { ')': '(', ']': '[' }

// Length of `url` with trailing sentence punctuation removed. A closing
// bracket is punctuation only when it has no matching opener inside the
// URL, so https://en.wikipedia.org/wiki/Matrix_(protocol) stays intact
// while "(see https://example.com/a)" still drops its closing paren.
function trimmedLength(url) {
  let end = url.length
  while (end > 0) {
    const ch = url[end - 1]
    if (ALWAYS_TRIM.includes(ch)) { end--; continue }
    const opener = CLOSERS[ch]
    if (opener) {
      let balance = 0
      for (const c of url.slice(0, end)) {
        if (c === opener) balance++
        else if (c === ch) balance--
      }
      if (balance < 0) { end--; continue }
    }
    break
  }
  return end
}

export function findUrlSpans(text) {
  const spans = []
  let match
  URL_PATTERN.lastIndex = 0
  while ((match = URL_PATTERN.exec(text))) {
    const raw = match[0]
    const len = trimmedLength(raw)
    if (len === 0) continue
    spans.push({ start: match.index, end: match.index + len, url: raw.slice(0, len) })
  }
  return spans
}
