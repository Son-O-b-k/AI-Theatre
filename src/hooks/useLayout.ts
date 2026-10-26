// Decides where the library (sidebar) and the lesson panel go, so the stage keeps enough width
// for its text to stay readable. The drawing scales uniformly with the stage, so stage width
// is what matters:
//   ≥ 1600px   library and lesson panel beside the stage, each collapsible
//   1200–1600  library becomes a slide-over drawer; lesson panel stays beside the stage
//   < 1200     lesson panel moves below the player
// Theatre mode hides everything but the player; keyframe editing also makes room for Studio's panels.
// These keep the stage at roughly 880px or more on laptops, so 22px labels render at 15px or more.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

export type Placement = 'inline' | 'drawer' | 'below' | 'hidden'

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}

/** A per-browser preference; falls back to the default when storage is unavailable. */
function usePreference(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? initial : stored === 'true'
    } catch {
      return initial
    }
  })
  const update = useCallback(
    (next: boolean) => {
      setValue(next)
      try {
        localStorage.setItem(key, String(next))
      } catch {
        // Not remembering the choice is fine.
      }
    },
    [key],
  )
  return [value, update]
}

export function useLayout() {
  const wide = useMediaQuery('(min-width: 1600px)')
  const narrow = useMediaQuery('(max-width: 1199px)')
  const phonePortrait = useMediaQuery('(max-width: 640px) and (orientation: portrait)')
  const [sidebarPinned, setSidebarPinned] = usePreference('ai-theatre:sidebar', true)
  const [panelOpen, setPanelOpen] = usePreference('ai-theatre:panel', true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [theatre, setTheatre] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (wide) setDrawerOpen(false)
  }, [wide])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.fullscreenElement) return
      setDrawerOpen(false)
      setTheatre(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const focused = theatre || editing
  const sidebar: Placement = focused ? 'hidden' : wide && sidebarPinned ? 'inline' : drawerOpen ? 'drawer' : 'hidden'
  const panel: Placement = focused ? 'hidden' : narrow ? 'below' : panelOpen ? 'inline' : 'hidden'

  return {
    narrow,
    phonePortrait,
    theatre,
    editing,
    setEditing,
    sidebar,
    panel,
    toggleSidebar: () => (wide ? setSidebarPinned(!sidebarPinned) : setDrawerOpen(!drawerOpen)),
    closeDrawer: () => setDrawerOpen(false),
    togglePanel: () => setPanelOpen(!panelOpen),
    toggleTheatre: () => setTheatre(!theatre),
  }
}
