const PALETTE = [
  { bg: '#0a3d30', fg: '#00E5B0' },
  { bg: '#3d2010', fg: '#FF6B35' },
  { bg: '#0a1d3d', fg: '#5B9BF0' },
  { bg: '#1e0a3d', fg: '#A78BFA' },
  { bg: '#1e1e1e', fg: '#8a8a8a' },
]

export function colorFor(id) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}
