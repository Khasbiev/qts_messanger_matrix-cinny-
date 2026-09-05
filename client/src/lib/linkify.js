const URL_PATTERN = /https?:\/\/[^\s<>"']+/g
const TRAILING_PUNCTUATION = /[).,;:!?\]]+$/

export function findUrlSpans(text) {
  const spans = []
  let match
  URL_PATTERN.lastIndex = 0
  while ((match = URL_PATTERN.exec(text))) {
    let url = match[0]
    let end = match.index + url.length
    const trimMatch = url.match(TRAILING_PUNCTUATION)
    if (trimMatch) {
      url = url.slice(0, url.length - trimMatch[0].length)
      end -= trimMatch[0].length
    }
    if (url.length === 0) continue
    spans.push({ start: match.index, end, url })
  }
  return spans
}
