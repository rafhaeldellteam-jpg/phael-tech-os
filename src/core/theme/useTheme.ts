import { useCallback, useEffect, useState } from 'react'
import { applyTheme, readThemePreference, type ThemePreference } from './theme'

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference)

  useEffect(() => {
    applyTheme(preference)
    if (preference !== 'system' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [preference])

  const setTheme = useCallback((p: ThemePreference) => setPreference(p), [])
  return { preference, setTheme }
}
