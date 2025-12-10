import { useState, useEffect, useMemo } from 'react'
import { RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { cn } from '@/lib/utils'
import type { CustomChainUrls } from '@/atoms/customChainUrlsAtom'

/**
 * Validate if a string is a valid URL
 * Returns error message if invalid, undefined if valid or empty
 */
function validateUrl(url: string | undefined): string | undefined {
  if (!url || url.trim() === '') {
    return undefined // Empty is allowed
  }
  
  try {
    new URL(url.trim())
    return undefined
  } catch {
    return 'Please enter a valid URL (e.g., https://example.com)'
  }
}

export interface ChainUrlSettingsProps {
  chainKey: string
  chainName: string
  chainType: 'evm' | 'tendermint'
  defaultUrls: {
    rpcUrl?: string
    lcdUrl?: string
    indexerUrl?: string
    maspIndexerUrl?: string
  }
  customUrls: CustomChainUrls
  onUpdate: (chainKey: string, urls: CustomChainUrls) => void
  onRestoreDefault: (chainKey: string) => void
}

export function ChainUrlSettings({
  chainKey,
  chainName,
  chainType,
  defaultUrls,
  customUrls,
  onUpdate,
  onRestoreDefault,
}: ChainUrlSettingsProps) {
  const [localUrls, setLocalUrls] = useState<CustomChainUrls>(customUrls)

  // Sync local state when customUrls prop changes
  useEffect(() => {
    setLocalUrls(customUrls)
  }, [customUrls])

  // Validate all URLs
  const validationErrors = useMemo(() => {
    const errors: Partial<Record<keyof CustomChainUrls, string>> = {}
    const fields: (keyof CustomChainUrls)[] = ['rpcUrl', 'lcdUrl', 'indexerUrl', 'maspIndexerUrl']
    
    fields.forEach((field) => {
      const error = validateUrl(localUrls[field])
      if (error) {
        errors[field] = error
      }
    })
    
    return errors
  }, [localUrls])
  
  const hasValidationErrors = Object.keys(validationErrors).length > 0

  // Check if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    // Normalize values for comparison (empty string = undefined)
    const normalize = (val: string | undefined) => (val?.trim() || undefined)
    
    const fields: (keyof CustomChainUrls)[] = ['rpcUrl', 'lcdUrl', 'indexerUrl', 'maspIndexerUrl']
    
    return fields.some((field) => {
      const localValue = normalize(localUrls[field])
      const savedValue = normalize(customUrls[field])
      return localValue !== savedValue
    })
  }, [localUrls, customUrls])
  
  // Helper to check if a specific field has unsaved changes
  const fieldHasChanges = (field: keyof CustomChainUrls) => {
    const normalize = (val: string | undefined) => (val?.trim() || undefined)
    return normalize(localUrls[field]) !== normalize(customUrls[field])
  }
  
  // Can save only if there are unsaved changes and no validation errors
  const canSave = hasUnsavedChanges && !hasValidationErrors

  const handleUrlChange = (field: keyof CustomChainUrls, value: string) => {
    const updated = { ...localUrls, [field]: value || undefined }
    setLocalUrls(updated)
  }

  const handleSave = () => {
    // Remove empty strings and undefined values
    const cleanedUrls: CustomChainUrls = {}
    Object.entries(localUrls).forEach(([key, value]) => {
      if (value && value.trim() !== '') {
        cleanedUrls[key as keyof CustomChainUrls] = value
      }
    })
    onUpdate(chainKey, cleanedUrls)
  }

  const handleRestoreDefault = () => {
    setLocalUrls({})
    onRestoreDefault(chainKey)
  }

  const hasCustomUrls = Object.values(localUrls).some((url) => url !== undefined && url !== '')

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-md font-semibold">{chainName}</h3>
        <div className="flex items-center gap-2">
          {hasUnsavedChanges && (
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!canSave}
              className="h-8 gap-1.5 text-xs"
            >
              <Save className="h-3 w-3" />
              Save
            </Button>
          )}
          {hasCustomUrls && (
            <Button
              variant="ghost"
              onClick={handleRestoreDefault}
              className="h-8 gap-1.5 text-xs"
            >
              <RotateCcw className="h-3 w-3" />
              Restore Default
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* RPC URL - always shown */}
        {defaultUrls.rpcUrl && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              RPC URL
            </label>
            <input
              type="text"
              value={localUrls.rpcUrl || ''}
              onChange={(e) => handleUrlChange('rpcUrl', e.target.value)}
              placeholder={defaultUrls.rpcUrl}
              className={cn(
                'w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                hasUnsavedChanges && fieldHasChanges('rpcUrl') && !validationErrors.rpcUrl && 'border-yellow-500',
                validationErrors.rpcUrl && 'border-red-500'
              )}
            />
            {validationErrors.rpcUrl && (
              <p className="mt-1 text-xs text-red-500">{validationErrors.rpcUrl}</p>
            )}
          </div>
        )}

        {/* LCD URL - only for Tendermint chains */}
        {chainType === 'tendermint' && defaultUrls.lcdUrl && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              LCD URL
            </label>
            <input
              type="text"
              value={localUrls.lcdUrl || ''}
              onChange={(e) => handleUrlChange('lcdUrl', e.target.value)}
              placeholder={defaultUrls.lcdUrl}
              className={cn(
                'w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                hasUnsavedChanges && fieldHasChanges('lcdUrl') && !validationErrors.lcdUrl && 'border-yellow-500',
                validationErrors.lcdUrl && 'border-red-500'
              )}
            />
            {validationErrors.lcdUrl && (
              <p className="mt-1 text-xs text-red-500">{validationErrors.lcdUrl}</p>
            )}
          </div>
        )}

        {/* Indexer URL - only for Tendermint chains */}
        {chainType === 'tendermint' && defaultUrls.indexerUrl && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Indexer URL
            </label>
            <input
              type="text"
              value={localUrls.indexerUrl || ''}
              onChange={(e) => handleUrlChange('indexerUrl', e.target.value)}
              placeholder={defaultUrls.indexerUrl}
              className={cn(
                'w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                hasUnsavedChanges && fieldHasChanges('indexerUrl') && !validationErrors.indexerUrl && 'border-yellow-500',
                validationErrors.indexerUrl && 'border-red-500'
              )}
            />
            {validationErrors.indexerUrl && (
              <p className="mt-1 text-xs text-red-500">{validationErrors.indexerUrl}</p>
            )}
          </div>
        )}

        {/* MASP Indexer URL - only for Tendermint chains */}
        {chainType === 'tendermint' && defaultUrls.maspIndexerUrl && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              MASP Indexer URL
            </label>
            <input
              type="text"
              value={localUrls.maspIndexerUrl || ''}
              onChange={(e) => handleUrlChange('maspIndexerUrl', e.target.value)}
              placeholder={defaultUrls.maspIndexerUrl}
              className={cn(
                'w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                hasUnsavedChanges && fieldHasChanges('maspIndexerUrl') && !validationErrors.maspIndexerUrl && 'border-yellow-500',
                validationErrors.maspIndexerUrl && 'border-red-500'
              )}
            />
            {validationErrors.maspIndexerUrl && (
              <p className="mt-1 text-xs text-red-500">{validationErrors.maspIndexerUrl}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

