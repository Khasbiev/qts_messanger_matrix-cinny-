export function isIOS() {
  // iPadOS 13+ reports its UA as a Mac, unlike a real Mac it's touch-capable.
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

// Push notifications (and the Notification/PushManager APIs entirely) only
// exist for iOS Safari once the site has been added to the home screen and
// opened from there - see lib/push.js's enablePush() guard for the other
// half of this.
export function needsIOSInstallPrompt() {
  return isIOS() && !isStandalone()
}
