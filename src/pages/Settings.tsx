import { useState, useEffect } from 'react'
import { useAtom } from 'jotai'
import { Link } from 'react-router-dom'
import { List, Trash2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
// import { BreadcrumbNav } from '@/components/common/BreadcrumbNav'
import { Spinner } from '@/components/common/Spinner'
import { Button } from '@/components/common/Button'
import { ChainUrlSettings } from '@/components/settings/ChainUrlSettings'
import { CollapsibleChainSection } from '@/components/settings/CollapsibleChainSection'
import { ClearTransactionHistoryDialog } from '@/components/settings/ClearTransactionHistoryDialog'
import { InvalidateShieldedContextDialog } from '@/components/settings/InvalidateShieldedContextDialog'
import { AddressBookSelector } from '@/components/addressBook/AddressBookSelector'
import { Switch } from '@/components/common/Switch'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { customEvmChainUrlsAtom, customTendermintChainUrlsAtom, type CustomChainUrls } from '@/atoms/customChainUrlsAtom'
import { txAtom } from '@/atoms/txAtom'
import { nobleFallbackAddressAtom, autoShieldedSyncEnabledAtom } from '@/atoms/appAtom'
import { saveCustomChainUrls, loadCustomChainUrls } from '@/services/storage/customChainUrlsStorage'
import { loadNobleFallbackAddress, saveNobleFallbackAddress } from '@/services/storage/nobleFallbackStorage'
import { validateBech32Address } from '@/services/validation'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import { transactionStorageService } from '@/services/tx/transactionStorageService'
import { getNamadaSdk } from '@/services/namada/namadaSdkService'
import { clearShieldedContext } from '@/services/shielded/maspHelpers'
import { NAMADA_CHAIN_ID } from '@/config/constants'
import { useToast } from '@/hooks/useToast'
import { logger } from '@/utils/logger'

export function Settings() {
  const [evmCustomUrls, setEvmCustomUrls] = useAtom(customEvmChainUrlsAtom)
  const [tendermintCustomUrls, setTendermintCustomUrls] = useAtom(customTendermintChainUrlsAtom)
  const [, setTxState] = useAtom(txAtom)
  const [nobleFallbackAddress, setNobleFallbackAddress] = useAtom(nobleFallbackAddressAtom)
  const [autoShieldedSyncEnabled, setAutoShieldedSyncEnabled] = useAtom(autoShieldedSyncEnabledAtom)
  const [isLoading, setIsLoading] = useState(true)
  const [evmChains, setEvmChains] = useState<Awaited<ReturnType<typeof fetchEvmChainsConfig>> | null>(null)
  const [tendermintChains, setTendermintChains] = useState<Awaited<ReturnType<typeof fetchTendermintChainsConfig>> | null>(null)
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)
  const [isInvalidateDialogOpen, setIsInvalidateDialogOpen] = useState(false)
  const [isNobleFallbackOpen, setIsNobleFallbackOpen] = useState(false)
  const [fallbackInput, setFallbackInput] = useState('')
  const [fallbackError, setFallbackError] = useState<string | null>(null)
  const { notify } = useToast()

  // Load chain configs and custom URLs on mount
  useEffect(() => {
    async function loadData() {
      try {
        setIsLoading(true)
        const [evmConfig, tendermintConfig, storedUrls] = await Promise.all([
          fetchEvmChainsConfig(),
          fetchTendermintChainsConfig(),
          Promise.resolve(loadCustomChainUrls()),
        ])

        setEvmChains(evmConfig)
        setTendermintChains(tendermintConfig)

        // Load custom URLs from storage into atoms
        if (storedUrls) {
          if (storedUrls.evm && Object.keys(storedUrls.evm).length > 0) {
            setEvmCustomUrls(storedUrls.evm)
          }
          if (storedUrls.tendermint && Object.keys(storedUrls.tendermint).length > 0) {
            setTendermintCustomUrls(storedUrls.tendermint)
          }
        }

        // Load Noble fallback address from storage
        const storedFallback = loadNobleFallbackAddress()
        if (storedFallback) {
          setNobleFallbackAddress(storedFallback)
          setFallbackInput(storedFallback)
        }
      } catch (error) {
        logger.error('[Settings] Failed to load chain configs', { error })
        notify({
          level: 'error',
          title: 'Failed to load settings',
          description: 'Could not load chain configurations. Please refresh the page.',
        })
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [setEvmCustomUrls, setTendermintCustomUrls, notify])

  const handleUpdateUrl = (chainKey: string, chainType: 'evm' | 'tendermint', urls: CustomChainUrls) => {
    if (chainType === 'evm') {
      const updated = { ...evmCustomUrls, [chainKey]: urls }
      setEvmCustomUrls(updated)
      saveCustomChainUrls({
        evm: updated,
        tendermint: tendermintCustomUrls,
      })
    } else {
      const updated = { ...tendermintCustomUrls, [chainKey]: urls }
      setTendermintCustomUrls(updated)
      saveCustomChainUrls({
        evm: evmCustomUrls,
        tendermint: updated,
      })
    }
    notify({
      level: 'success',
      title: 'Settings saved',
      description: `Custom URLs for ${chainKey} have been saved.`,
    })
  }

  const handleRestoreDefault = (chainKey: string, chainType: 'evm' | 'tendermint') => {
    if (chainType === 'evm') {
      const updated = { ...evmCustomUrls }
      delete updated[chainKey]
      setEvmCustomUrls(updated)
      saveCustomChainUrls({
        evm: updated,
        tendermint: tendermintCustomUrls,
      })
    } else {
      const updated = { ...tendermintCustomUrls }
      delete updated[chainKey]
      setTendermintCustomUrls(updated)
      saveCustomChainUrls({
        evm: evmCustomUrls,
        tendermint: updated,
      })
    }
    notify({
      level: 'success',
      title: 'Default restored',
      description: `Restored default URLs for ${chainKey}.`,
    })
  }

  const handleClearTransactionHistory = () => {
    try {
      // Clear from storage
      transactionStorageService.clearAll()

      // Clear from atom state
      setTxState({
        activeTransaction: undefined,
        history: [],
      })

      logger.info('[Settings] Transaction history cleared')
      notify({
        level: 'success',
        title: 'Transaction history cleared',
        description: 'All transaction history has been permanently deleted.',
      })
    } catch (error) {
      logger.error('[Settings] Failed to clear transaction history', { error })
      notify({
        level: 'error',
        title: 'Failed to clear history',
        description: 'Could not clear transaction history. Please try again.',
      })
    }
  }

  const handleInvalidateShieldedContext = async () => {
    try {
      const sdk = getNamadaSdk()
      await clearShieldedContext(sdk, NAMADA_CHAIN_ID)

      logger.info('[Settings] Shielded context invalidated', { chainId: NAMADA_CHAIN_ID })
      notify({
        level: 'success',
        title: 'Shielded context invalidated',
        description: 'Shielded context has been cleared. Initial resync may take up to 15 minutes.',
      })
    } catch (error) {
      logger.error('[Settings] Failed to invalidate shielded context', { error })
      notify({
        level: 'error',
        title: 'Failed to invalidate context',
        description: error instanceof Error ? error.message : 'Could not invalidate shielded context. Please try again.',
      })
    }
  }

  const handleFallbackAddressChange = (value: string) => {
    setFallbackInput(value)
    // Clear error when user starts typing
    if (fallbackError) {
      setFallbackError(null)
    }
  }

  const handleSaveFallbackAddress = () => {
    const trimmed = fallbackInput.trim()

    // If empty, clear the fallback address
    if (trimmed === '') {
      setNobleFallbackAddress(undefined)
      saveNobleFallbackAddress(undefined)
      setFallbackInput('')
      setFallbackError(null)
      notify({
        level: 'success',
        title: 'Fallback address cleared',
        description: 'Noble forwarding will use empty fallback address.',
      })
      return
    }

    // Validate the address (must be a Noble bech32 address)
    const validation = validateBech32Address(trimmed, { expectedHrp: 'noble' })
    if (!validation.isValid) {
      setFallbackError(validation.error || 'Invalid Noble address')
      return
    }

    // Save the validated address
    const validatedAddress = validation.value!
    setNobleFallbackAddress(validatedAddress)
    saveNobleFallbackAddress(validatedAddress)
    setFallbackInput(validatedAddress)
    setFallbackError(null)

    logger.info('[Settings] Noble fallback address saved', {
      address: validatedAddress.slice(0, 16) + '...',
    })

    notify({
      level: 'success',
      title: 'Fallback address saved',
      description: 'Noble forwarding will use this fallback address for future deposits.',
    })
  }

  const handleClearFallbackAddress = () => {
    setNobleFallbackAddress(undefined)
    saveNobleFallbackAddress(undefined)
    setFallbackInput('')
    setFallbackError(null)
    notify({
      level: 'success',
      title: 'Fallback address cleared',
      description: 'Noble forwarding will use empty fallback address.',
    })
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="container mx-auto p-12">

      {/* <div className="mb-10">
        <BreadcrumbNav />
      </div> */}

      <header className="space-y-2 mb-10">
        <p className="text-muted-foreground">
          Manage app settings and preferences
        </p>
      </header>

      <div className="space-y-8 mx-auto">
        {/* Configure Chains Section */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Configure Chains</h2>
          <div className="space-y-4">
            {/* EVM Chains Section */}
            {evmChains && evmChains.chains.length > 0 && (
              <CollapsibleChainSection
                title="Configure EVM chain URLs"
                chainCount={evmChains.chains.length}
                defaultOpen={false}
              >
                {evmChains.chains.map((chain) => (
                  <ChainUrlSettings
                    key={chain.key}
                    chainKey={chain.key}
                    chainName={chain.name}
                    chainType="evm"
                    defaultUrls={{
                      rpcUrl: chain.rpcUrls?.[0],
                    }}
                    customUrls={evmCustomUrls[chain.key] || {}}
                    onUpdate={(key, urls) => handleUpdateUrl(key, 'evm', urls)}
                    onRestoreDefault={(key) => handleRestoreDefault(key, 'evm')}
                  />
                ))}
              </CollapsibleChainSection>
            )}

            {/* Tendermint Chains Section */}
            {tendermintChains && tendermintChains.chains.length > 0 && (
              <CollapsibleChainSection
                title="Configure CometBFT chain URLs"
                chainCount={tendermintChains.chains.length}
                defaultOpen={false}
              >
                {tendermintChains.chains.map((chain) => (
                  <ChainUrlSettings
                    key={chain.key}
                    chainKey={chain.key}
                    chainName={chain.name}
                    chainType="tendermint"
                    defaultUrls={{
                      rpcUrl: chain.rpcUrls?.[0],
                      lcdUrl: chain.lcdUrl,
                      indexerUrl: chain.indexerUrl,
                      maspIndexerUrl: chain.maspIndexerUrl,
                    }}
                    customUrls={tendermintCustomUrls[chain.key] || {}}
                    onUpdate={(key, urls) => handleUpdateUrl(key, 'tendermint', urls)}
                    onRestoreDefault={(key) => handleRestoreDefault(key, 'tendermint')}
                  />
                ))}
              </CollapsibleChainSection>
            )}
          </div>
        </section>

        {/* Recovery Center Section */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Recovery Center</h2>
          <div className="card">
            <div className="flex justify-between items-baseline">
              <p className="mb-4 text-sm text-muted-foreground">
                Manage and register Noble forwarding addresses for deposit recovery.
              </p>
              <Link to="/forwarding-addresses">
                <Button variant="primary" className="gap-2 w-72">
                  <List className="h-4 w-4" />
                  <span>View Forwarding Addresses</span>
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Address Book Section */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Address Book</h2>
          <div className="card">
            <div className="flex justify-between items-baseline">
              <div className="flex-1">
                <p className="mb-2 text-sm text-muted-foreground">
                  Save and manage frequently used addresses for quick access.
                </p>
              </div>
              <Link to="/address-book">
                <Button variant="primary" className="gap-2 w-72">
                  <List className="h-4 w-4" />
                  <span>Manage Address Book</span>
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Noble Forwarding Settings Section */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Noble Forwarding Settings</h2>
          <div className="card card-no-padding card-shadow-none">
            <button
              type="button"
              onClick={() => setIsNobleFallbackOpen(!isNobleFallbackOpen)}
              className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                {isNobleFallbackOpen ? (
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                )}
                <h3 className="text-md font-semibold">Configure Fallback Address</h3>
              </div>
            </button>

            {isNobleFallbackOpen && (
              <div className="border-t border-border p-4">
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-3">
                      An optional Noble address to include when generating Noble forwarding addresses for deposits. If included, in case of a timeout
                      or other issue during the auto-forward IBC transfer from Noble to Namada your funds will be refunded here.
                      This should be an address on Noble which you control. If not set, no fallback address will be included.
                    </p>
                    <div className="space-y-2">
                      <AddressBookSelector
                        onSelect={(entry) => {
                          handleFallbackAddressChange(entry.address)
                        }}
                        filterByType="noble"
                        className="mb-2"
                      />
                      <div className="flex gap-2">
                        <input
                          id="fallback-address"
                          type="text"
                          value={fallbackInput}
                          onChange={(e) => handleFallbackAddressChange(e.target.value)}
                          placeholder="noble123abc..."
                          className={`flex-1 rounded-md border px-3 py-2 text-sm ${fallbackError
                              ? 'border-destructive focus:border-destructive focus:ring-destructive'
                              : 'border-border focus:border-ring focus:ring-ring'
                            } bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2`}
                        />
                        <Button
                          variant="primary"
                          onClick={handleSaveFallbackAddress}
                          className="px-4"
                        >
                          Save
                        </Button>
                        {nobleFallbackAddress && (
                          <Button
                            variant="secondary"
                            onClick={handleClearFallbackAddress}
                            className="px-4"
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>
                    {fallbackError && (
                      <p className="mt-2 text-sm text-destructive">{fallbackError}</p>
                    )}
                    {nobleFallbackAddress && !fallbackError && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Current fallback: <span className="font-mono text-xs">{nobleFallbackAddress}</span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Appearance Settings Section */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Appearance</h2>
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <label htmlFor="theme-toggle" className="text-sm font-medium cursor-pointer">
                  Theme:
                </label>
                <p className="text-sm text-muted-foreground">
                  Switch between light and dark mode
                </p>
              </div>
              <ThemeToggle />
            </div>
          </div>
        </section>

        {/* Shielded Balance Settings Section */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Shielded Balance Settings</h2>
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <label htmlFor="auto-shielded-sync-toggle" className="text-sm font-medium cursor-pointer">
                  Auto Sync:
                </label>
                <p className="text-sm text-muted-foreground">
                  Automatically sync shielded balance during polling
                </p>
              </div>
              <Switch
                id="auto-shielded-sync-toggle"
                checked={autoShieldedSyncEnabled}
                onCheckedChange={setAutoShieldedSyncEnabled}
                aria-label="Toggle automatic shielded sync during polling"
              />
            </div>
          </div>
        </section>

        {/* App Data Section */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">App Data</h2>
          <div className="card space-y-3">
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-baseline">
                <p className="text-sm text-muted-foreground">
                  Clear all stored transaction history.
                </p>
                <Button
                  variant="primary"
                  className="gap-2 w-72"
                  onClick={() => setIsClearDialogOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Clear transaction history</span>
                </Button>
              </div>
              <div className="flex justify-between items-baseline">
                <p className="text-sm text-muted-foreground">
                  Clear your shielded context, allowing a full resync.
                </p>
                <Button
                  variant="primary"
                  className="gap-2 w-72"
                  onClick={() => setIsInvalidateDialogOpen(true)}
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>Invalidate shielded context</span>
                </Button>
              </div>
            </div>
          </div>
        </section>
        <div className="min-h-12" />
      </div>

      {/* Clear Transaction History Dialog */}
      <ClearTransactionHistoryDialog
        open={isClearDialogOpen}
        onClose={() => setIsClearDialogOpen(false)}
        onConfirm={handleClearTransactionHistory}
      />

      {/* Invalidate Shielded Context Dialog */}
      <InvalidateShieldedContextDialog
        open={isInvalidateDialogOpen}
        onClose={() => setIsInvalidateDialogOpen(false)}
        onConfirm={handleInvalidateShieldedContext}
      />
    </div>
  )
}

