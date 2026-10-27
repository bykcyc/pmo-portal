import { useEffect, useState } from 'react'

/** Reactively tracks a CSS media query. SSR-safe (defaults to false before mount). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** True at Tailwind's `lg` breakpoint and up (≥1024px) — the desktop shell layout. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)')
}
