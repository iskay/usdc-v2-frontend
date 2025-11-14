import { Suspense, useMemo, useState, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import { Navbar } from '@/components/layout/Navbar'
import { Sidebar } from '@/components/layout/Sidebar'
import { ToastContainer } from '@/components/layout/ToastContainer'
import { Spinner } from '@/components/common/Spinner'
import { useTxTracker } from '@/hooks/useTxTracker'

const slideFromLeft: Variants = {
  initial: { x: '-16%', opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: '12%', opacity: 0 },
}

const slideFromRight: Variants = {
  initial: { x: '16%', opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: '-12%', opacity: 0 },
}

const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}

function resolveVariants(pathname: string): Variants {
  if (pathname.startsWith('/deposit')) return slideFromLeft
  if (pathname.startsWith('/send')) return slideFromRight
  if (pathname.startsWith('/history')) return fadeIn
  return fadeIn
}

export function App() {
  const location = useLocation()
  const [displayLocation, setDisplayLocation] = useState(location.pathname)
  const [pendingLocation, setPendingLocation] = useState<string | null>(null)
  const cachedOutlet = useRef<ReactElement | null>(null)
  const currentOutlet = useOutlet()
  const variants = useMemo(() => resolveVariants(displayLocation), [displayLocation])

  // Initialize global transaction tracking and polling
  // This runs on app startup and handles hydration from localStorage + polling for in-progress transactions
  const { state: txState } = useTxTracker()

  // Always cache outlet when location matches displayLocation (stable state)
  useEffect(() => {
    if (location.pathname === displayLocation && currentOutlet && !pendingLocation) {
      cachedOutlet.current = currentOutlet
    }
  }, [location.pathname, displayLocation, currentOutlet, pendingLocation])

  // When location changes, trigger exit animation but keep rendering old content
  useEffect(() => {
    if (location.pathname !== displayLocation && !pendingLocation) {
      // Store pending new location and keep displayLocation as old route
      // This ensures variants match the old content during exit
      setPendingLocation(location.pathname)
    }
  }, [location.pathname, displayLocation, pendingLocation])

  function handleExitComplete() {
    // After exit completes, update displayLocation to new route and cache new content
    if (pendingLocation && currentOutlet) {
      cachedOutlet.current = currentOutlet
      setDisplayLocation(pendingLocation)
      setPendingLocation(null)
    }
  }

  // During exit (pendingLocation exists), show cached old content
  // After exit (no pendingLocation), show current new content
  const outletToRender = pendingLocation ? cachedOutlet.current : (location.pathname === displayLocation ? currentOutlet : cachedOutlet.current)
  
  // Use a transition key that changes when location changes to trigger AnimatePresence
  // But keep displayLocation as old route for correct variants during exit
  const motionKey = pendingLocation ? `${displayLocation}-exiting` : displayLocation

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <ToastContainer />
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Navbar />
        <main className="relative flex-1 overflow-hidden p-6">
          <AnimatePresence mode="wait" initial={false} onExitComplete={handleExitComplete}>
            <motion.div
              key={motionKey}
              variants={variants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.35, ease: 'easeInOut' }}
              className="absolute inset-0 overflow-y-auto"
            >
              <Suspense fallback={<div className="flex justify-center mt-48"><Spinner label="Loading view" /></div>}>
                {outletToRender || <div className="h-full" />}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
