export type PluginSlot = 'task-actions' | 'sidebar' | 'settings' | 'sync-adapter'

export interface TrackerPlugin {
  id: string
  name: string
  version: string
  slots: PluginSlot[]
  activate?: () => void
  deactivate?: () => void
}

class PluginRegistry {
  private plugins = new Map<string, TrackerPlugin>()

  register(plugin: TrackerPlugin) {
    if (this.plugins.has(plugin.id)) throw new Error(`Plugin ${plugin.id} already registered`)
    this.plugins.set(plugin.id, plugin)
    plugin.activate?.()
  }

  unregister(id: string) {
    this.plugins.get(id)?.deactivate?.()
    this.plugins.delete(id)
  }

  list() {
    return [...this.plugins.values()]
  }

  forSlot(slot: PluginSlot) {
    return this.list().filter((plugin) => plugin.slots.includes(slot))
  }
}

export const pluginRegistry = new PluginRegistry()
