// Tracks how many modal-like overlays (Modal, EmojiPicker) are currently
// mounted, so a global Escape handler (e.g. deselecting the active chat)
// can defer to whichever overlay is on top instead of firing alongside it.
let openCount = 0

export function pushModal() {
  openCount++
}

export function popModal() {
  openCount = Math.max(0, openCount - 1)
}

export function isModalOpen() {
  return openCount > 0
}
