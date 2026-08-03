import { describe, expect, it, vi } from 'vitest'
import type { SyncProviderDefinition } from './SyncAdapter'
import { SyncProviderRegistry } from './SyncProviderRegistry'

function provider(id: string): SyncProviderDefinition {
  return {
    descriptor: {
      id,
      name: id,
      description: `${id} storage`,
      connection: 'implicit',
      consistency: 'atomic',
      capabilities: { download: true, upload: true },
    },
    createRuntime: vi.fn(),
  }
}

describe('SyncProviderRegistry', () => {
  it('registers, gets and lists providers in registration order', () => {
    const first = provider('first')
    const second = provider('second')
    const registry = new SyncProviderRegistry([first])

    registry.register(second)

    expect(registry.get('first')).toBe(first)
    expect(registry.get('second')).toBe(second)
    expect(registry.list()).toEqual([first, second])
  })

  it('rejects duplicate provider ids without replacing the registered provider', () => {
    const original = provider('drive')
    const duplicate = provider('drive')
    const registry = new SyncProviderRegistry([original])

    expect(() => registry.register(duplicate)).toThrow('Sync provider drive already registered')
    expect(registry.get('drive')).toBe(original)
    expect(registry.list()).toEqual([original])
  })

  it('does not silently fall back for an unknown provider id', () => {
    const known = provider('known')
    const registry = new SyncProviderRegistry([known])

    expect(registry.get('future-provider')).toBeUndefined()
    expect(registry.get('future-provider')).not.toBe(known)
  })

  it('rejects a provider that cannot perform the bidirectional sync contract', () => {
    const incomplete = provider('download-only')
    incomplete.descriptor.capabilities.upload = false

    expect(() => new SyncProviderRegistry([incomplete])).toThrow(/both download and upload/)
  })

  it('rejects credential-like fields because provider config is persisted locally', () => {
    const unsafe = provider('unsafe')
    unsafe.descriptor.configFields = [{ key: 'refresh_token', label: 'Token', persistence: 'secret' }]

    expect(() => new SyncProviderRegistry([unsafe])).toThrow(/must not persist secret config field/)
  })

  it('requires explicit public classification and rejects misleading credential names', () => {
    const unclassified = provider('unclassified')
    unclassified.descriptor.configFields = [{ key: 'endpoint', label: 'Endpoint' } as never]
    const misleading = provider('misleading')
    misleading.descriptor.configFields = [{ key: 'authToken', label: 'Auth value', persistence: 'public' }]

    expect(() => new SyncProviderRegistry([unclassified])).toThrow(/secret config field endpoint/)
    expect(() => new SyncProviderRegistry([misleading])).toThrow(/secret config field authToken/)
  })
})
