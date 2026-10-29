export type ThemePreference = 'light' | 'dark' | 'system'

const KEY = 'pt-theme'

export function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function resolveDark(pref: ThemePreference, systemDark: boolean): boolean {
  return pref === 'dark' || (pref === 'system' && systemDark)
}

export function applyTheme(pref: ThemePreference): void {
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  document.documentElement.classList.toggle('dark', resolveDark(pref, systemDark))
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    /* sem armazenamento: o tema vale só nesta sessão */
  }
}
