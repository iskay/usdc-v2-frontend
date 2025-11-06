export function formatNamadaAddress(address?: string): string {
  if (!address) return '—'
  return `${address.slice(0, 7)}…${address.slice(-4)}`
}

export function toBaseUnit(amount: string, decimals = 6): bigint {
  // TODO: Use Namada registry metadata for token precision.
  const [whole, fraction = ''] = amount.split('.')
  const normalizedFraction = (fraction + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(`${whole}${normalizedFraction}`)
}
