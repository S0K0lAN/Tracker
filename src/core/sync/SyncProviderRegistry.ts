import type { SyncProviderDefinition } from './SyncAdapter'

export class SyncProviderRegistry {
  private readonly providers = new Map<string, SyncProviderDefinition>()

  constructor(providers: Iterable<SyncProviderDefinition> = []) {
    for (const provider of providers) this.register(provider)
  }

  register(provider: SyncProviderDefinition): void {
    const { id } = provider.descriptor
    if (!id.trim()) throw new Error('Sync provider id must not be empty')
    if (this.providers.has(id)) {
      throw new Error(`Sync provider ${id} already registered`)
    }
    if (!provider.descriptor.capabilities.download || !provider.descriptor.capabilities.upload) {
      throw new Error(`Sync provider ${id} must support both download and upload`)
    }
    const sensitiveField = provider.descriptor.configFields?.find((field) => (
      field.persistence !== 'public'
      || /(access.?token|refresh.?token|auth.?token|id.?token|(^|[-_])token|secret|password|api.?key|credential|bearer|authorization|private.?key)/i.test(field.key)
    ))
    if (sensitiveField) {
      throw new Error(`Sync provider ${id} must not persist secret config field ${sensitiveField.key}`)
    }

    this.providers.set(id, provider)
  }

  get(id: string): SyncProviderDefinition | undefined {
    return this.providers.get(id)
  }

  list(): SyncProviderDefinition[] {
    return [...this.providers.values()]
  }
}
