import { useState, useEffect } from 'react'
import { useAtom } from 'jotai'
import { Link } from 'react-router-dom'
import { Settings as SettingsIcon, List, Trash2, RefreshCw } from 'lucide-react'
import { BackToHome } from '@/components/common/BackToHome'
import { Spinner } from '@/components/common/Spinner'
import { Button } from '@/components/common/Button'
import { ChainUrlSettings } from '@/components/settings/ChainUrlSettings'
import { CollapsibleChainSection } from '@/components/settings/CollapsibleChainSection'
import { ClearTransactionHistoryDialog } from '@/components/settings/ClearTransactionHistoryDialog'
import { InvalidateShieldedContextDialog } from '@/components/settings/InvalidateShieldedContextDialog'
import { customEvmChainUrlsAtom, customTendermintChainUrlsAtom, type CustomChainUrls } from '@/atoms/customChainUrlsAtom'
import { txAtom } from '@/atoms/txAtom'
import { saveCustomChainUrls, loadCustomChainUrls } from '@/services/storage/customChainUrlsStorage'
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
  const [isLoading, setIsLoading] = useState(true)
  const [evmChains, setEvmChains] = useState<Awaited<ReturnType<typeof fetchEvmChainsConfig>> | null>(null)
  const [tendermintChains, setTendermintChains] = useState<Awaited<ReturnType<typeof fetchTendermintChainsConfig>> | null>(null)
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)
  const [isInvalidateDialogOpen, setIsInvalidateDialogOpen] = useState(false)
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

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="container mx-auto p-12">

      <div className="mb-12 flex items-around justify-between gap-3 px-48">
        <BackToHome />
        <div className="flex gap-3">
          <h1 className="text-3xl font-bold">Settings</h1>
          <SettingsIcon className="h-6 w-6 text-foreground self-start mt-1.5" />
        </div>
      </div>

      <div className="space-y-8 px-48 mx-auto">
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
          <div className="rounded-lg border border-border bg-card p-4">
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

        {/* App Data Section */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">App Data</h2>
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
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

