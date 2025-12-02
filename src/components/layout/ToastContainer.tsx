import { Toaster } from 'sonner'

export function ToastContainer() {
  return (
    <Toaster
      richColors
      position="top-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:focus-visible:outline-none group-[.toast]:focus-visible:ring-2 group-[.toast]:focus-visible:ring-ring',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:focus-visible:outline-none group-[.toast]:focus-visible:ring-2 group-[.toast]:focus-visible:ring-ring',
        },
        // Accessibility: Use appropriate aria-live regions
        // Sonner automatically uses aria-live="polite" for toasts
        // We can enhance with better descriptions
      }}
      expand
      visibleToasts={5}
      // Accessibility: Enable keyboard navigation
      // Sonner handles this automatically, but we ensure it's enabled
    />
  )
}
