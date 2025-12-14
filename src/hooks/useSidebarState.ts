// import { useState, useEffect, useCallback } from 'react'

// const SIDEBAR_STORAGE_KEY = 'sidebarCollapsed'
const DEFAULT_COLLAPSED = true

// Sidebar state hook disabled but kept for potential restoration
// The state is still maintained in localStorage but not actively used in the UI
export function useSidebarState() {
  // State initialization disabled - returning default values
  // const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
  //   // Initialize from localStorage if available, otherwise default to collapsed
  //   if (typeof window !== 'undefined') {
  //     const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY)
  //     if (stored === 'true' || stored === 'false') {
  //       return stored === 'true'
  //     }
  //   }
  //   return DEFAULT_COLLAPSED
  // })

  // Save to localStorage whenever state changes - DISABLED
  // useEffect(() => {
  //   if (typeof window === 'undefined') return
  //   localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isCollapsed))
  // }, [isCollapsed])

  // Read from localStorage on mount (in case it was set before React initialized) - DISABLED
  // useEffect(() => {
  //   if (typeof window === 'undefined') return

  //   const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY)
  //   if (stored === 'true' || stored === 'false') {
  //     setIsCollapsed(stored === 'true')
  //   } else {
  //     // If no stored preference, set default
  //     setIsCollapsed(DEFAULT_COLLAPSED)
  //   }
  // }, [])

  // const toggleSidebar = useCallback(() => {
  //   setIsCollapsed((prev) => !prev)
  // }, [])

  // const setCollapsed = useCallback((collapsed: boolean) => {
  //   setIsCollapsed(collapsed)
  // }, [])

  // Return default values to maintain API compatibility
  return {
    isCollapsed: DEFAULT_COLLAPSED,
    toggleSidebar: () => {}, // No-op function
    setCollapsed: () => {}, // No-op function
  }
}
