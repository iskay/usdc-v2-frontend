import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SHIELDED_WORKER_FALLBACK,
  resolveShieldedWorkerAssetPath,
} from '@/types/shielded'

describe('resolveShieldedWorkerAssetPath', () => {
  it('returns the provided env path when available', () => {
    const path = resolveShieldedWorkerAssetPath({
      envPath: '  https://cdn.example.com/shielded-worker.js  ',
    })

    expect(path).toBe('https://cdn.example.com/shielded-worker.js')
  })

  it('joins the base URL and fallback without duplicate slashes', () => {
    const path = resolveShieldedWorkerAssetPath({
      baseUrl: 'https://app.example.com/assets/',
      fallback: '/shielded/worker.js',
    })

    expect(path).toBe('https://app.example.com/assets/shielded/worker.js')
  })

  it('returns the fallback when neither env path nor base URL is provided', () => {
    expect(resolveShieldedWorkerAssetPath()).toBe(DEFAULT_SHIELDED_WORKER_FALLBACK)
  })

  it('uses the provided fallback when explicit path is supplied', () => {
    const path = resolveShieldedWorkerAssetPath({
      fallback: 'shielded/custom-worker.js',
    })

    expect(path).toBe('shielded/custom-worker.js')
  })
})
