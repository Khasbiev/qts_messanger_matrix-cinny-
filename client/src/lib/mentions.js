function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// members: [{ userId, name }]. Returns non-overlapping, position-sorted
// mention spans. Longest display names are matched first so a name that's
// a prefix of another member's name (e.g. "Иван" vs "Иван Петров") can't
// steal part of the longer match.
export function findMentionSpans(text, members) {
  const candidates = members
    .filter(m => m.name && m.userId)
    .sort((a, b) => b.name.length - a.name.length)
  const claimed = []
  const spans = []

  for (const member of candidates) {
    const pattern = new RegExp(
      `(^|\\s)@${escapeRegExp(member.name)}(?=$|[\\s.,!?;:)\\]])`,
      'g'
    )
    let match
    while ((match = pattern.exec(text))) {
      const start = match.index + match[1].length
      const end = start + 1 + member.name.length
      if (claimed.some(c => start < c.end && end > c.start)) continue
      claimed.push({ start, end })
      spans.push({ start, end, userId: member.userId, displayName: member.name })
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}

// Assembles an HTML fragment with mention pills. Takes the caller's own
// escapeHtml so this module has zero dependencies (lib/matrix.js depends
// on this module, not the other way around).
export function buildMentionHtml(text, spans, escapeHtml) {
  let html = ''
  let cursor = 0
  for (const span of spans) {
    html += escapeHtml(text.slice(cursor, span.start))
    html += `<a href="https://matrix.to/#/${span.userId}">${escapeHtml(text.slice(span.start, span.end))}</a>`
    cursor = span.end
  }
  html += escapeHtml(text.slice(cursor))
  return html
}
