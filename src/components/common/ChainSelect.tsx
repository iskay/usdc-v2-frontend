import { useState, useEffect, useMemo } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import type { EvmChainConfig, EvmChainsFile } from '@/config/chains'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'

export interface ChainSelectProps {
  value: string
  onChange: (chainKey: string) => void
  disabled?: boolean
  showEstimatedTime?: boolean
  timeType?: 'send' | 'deposit'
}

export function ChainSelect({
  value,
  onChange,
  disabled = false,
  showEstimatedTime = true,
  timeType = 'send',
}: ChainSelectProps) {
  const [chainsConfig, setChainsConfig] = useState<EvmChainsFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load chains config on mount
  useEffect(() => {
    let mounted = true

    async function loadChains() {
      try {
        setLoading(true)
        setError(null)
        const config = await fetchEvmChainsConfig()
        if (mounted) {
          setChainsConfig(config)
        }
      } catch (err) {
        if (mounted) {
          const message = err instanceof Error ? err.message : 'Failed to load chains'
          setError(message)
          console.error('[ChainSelect] Failed to load chains:', err)
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    void loadChains()

    return () => {
      mounted = false
    }
  }, [])

  // Get chain options from config
  const chainOptions = useMemo(() => {
    if (!chainsConfig) return []
    return chainsConfig.chains.map((chain) => ({
      key: chain.key,
      name: chain.name,
      logo: chain.logo,
      estimatedTime: chain.estimatedTimes?.[timeType] ?? chain.estimatedTimes?.send ?? '—',
    }))
  }, [chainsConfig, timeType])

  // Get selected chain config
  const selectedChain = useMemo(() => {
    if (!chainsConfig) return null
    return chainsConfig.chains.find((chain) => chain.key === value) ?? null
  }, [chainsConfig, value])

  // Handle select change
  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const newValue = event.target.value
    if (newValue && newValue !== value) {
      onChange(newValue)
    }
  }

  // If loading, show loading state
  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-input bg-muted/40 px-4 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading chains...</span>
      </div>
    )
  }

  // If error, show error state
  if (error || !chainsConfig) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3">
        <span className="text-sm text-destructive">
          {error ?? 'Failed to load chains'}
        </span>
      </div>
    )
  }

  // If no chains available
  if (chainOptions.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-input bg-muted/40 px-4 py-3">
        <span className="text-sm text-muted-foreground">No chains available</span>
      </div>
    )
  }

  // Render select with chain info
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-muted-foreground">Network</label>
      <div className="flex items-center gap-3 rounded-lg border border-input bg-background px-4 py-3 shadow-sm">
        {/* Chain logo */}
        {selectedChain?.logo && (
          <img
            src={selectedChain.logo}
            alt={selectedChain.name}
            className="h-6 w-6 rounded-full"
            onError={(e) => {
              // Hide image if it fails to load
              e.currentTarget.style.display = 'none'
            }}
          />
        )}

        {/* Select dropdown */}
        <select
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className="flex-1 border-none bg-transparent text-sm font-medium focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {chainOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.name}
            </option>
          ))}
        </select>

        {/* Estimated time */}
        {showEstimatedTime && selectedChain && (
          <>
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {selectedChain.estimatedTimes?.[timeType] ??
                selectedChain.estimatedTimes?.send ??
                '—'}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

