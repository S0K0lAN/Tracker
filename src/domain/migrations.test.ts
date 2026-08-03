import { describe, expect, it } from 'vitest'
import { normalizeAppState } from './migrations'
import { createSeedState } from './seed'

describe('state migrations for simplified navigation and habit icons', () => {
  it('moves the retired inbox calendar view to the list and converts legacy emoji icons', () => {
    const legacy = createSeedState()
    ;(legacy.settings as { inboxView: string }).inboxView = 'calendar'
    legacy.habits[0].icon = '💧'

    const migrated = normalizeAppState(legacy)

    expect(migrated.settings.inboxView).toBe('list')
    expect(migrated.habits[0].icon).toBe('water')
  })
})
