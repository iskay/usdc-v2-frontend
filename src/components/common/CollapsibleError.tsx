import { useState } from 'react'
import { XCircle, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import { sanitizeError } from '@/utils/errorSanitizer'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/useToast'
import { buildCopySuccessToast } from '@/utils/toastHelpers'

export interface CollapsibleErrorProps {
  /** Error to display (can be Error, string, or unknown) */
  error: unknown
  /** Optional title (defaults to "Error") */
  title?: string
  /** Optional className for the container */
  className?: string
  /** Whether to show the error icon */
  showIcon?: boolean
  /** Whether to show the copy button */
  showCopyButton?: boolean
}

export function CollapsibleError({
  error,
  title = 'Error',
  className,
  showIcon = true,
  showCopyButton = true,
}: CollapsibleErrorProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const { notify } = useToast()

  const sanitized = sanitizeError(error)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sanitized.rawError)
      setCopied(true)
      notify(buildCopySuccessToast('Error details'))
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('[CollapsibleError] Failed to copy error:', err)
    }
  }

  // Only show expand/collapse if raw error is different from sanitized message
  const hasDetails = sanitized.rawError !== sanitized.message && sanitized.rawError.length > sanitized.message.length

  return (
    <div
      className={cn(
        'rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950',
        className
      )}
    >
      <div className="flex items-start gap-2">
        {showIcon && (
          <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-red-900 dark:text-red-100">{title}</p>
            {showCopyButton && hasDetails && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex-shrink-0 rounded p-1 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900 transition-colors"
                aria-label="Copy error details"
                title="Copy error details"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
          
          {/* Sanitized error message */}
          <p className="mt-1 text-sm text-red-800 dark:text-red-200 break-words">
            {sanitized.message}
          </p>

          {/* Collapsible details section */}
          {hasDetails && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-1 text-xs text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100 transition-colors"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" />
                    <span>Hide error details</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5" />
                    <span>Show error details</span>
                  </>
                )}
              </button>

              {isExpanded && (
                <div className="mt-2 rounded border border-red-300 dark:border-red-700 bg-red-100 dark:bg-red-900/50 p-3">
                  <pre className="text-xs text-red-900 dark:text-red-100 whitespace-pre-wrap break-words overflow-x-auto max-h-96 overflow-y-auto font-mono">
                    {sanitized.rawError}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

