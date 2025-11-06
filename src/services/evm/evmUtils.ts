export function formatEvmAddress(address?: string): string {
  if (!address) return '—'
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function parseAmount(amount: string): bigint {
  // TODO: Integrate decimal conversion using USDC token decimals (6).
  return BigInt(Math.floor(Number(amount) * 1_000_000))
}
