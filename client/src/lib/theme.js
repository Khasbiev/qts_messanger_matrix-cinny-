const THEME_KEY = 'qts_theme'

export function getTheme() {
  return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
}

export function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme)
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light')
  else document.documentElement.removeAttribute('data-theme')
}
