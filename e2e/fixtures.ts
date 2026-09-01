import { expect, test as base } from '@playwright/test'

export { expect }
export type { Page } from '@playwright/test'

interface AutomaticFixtures {
  runtimeErrorGate: void
}

export const test = base.extend<AutomaticFixtures>({
  runtimeErrorGate: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
    })

    await use()

    expect(errors, 'browser runtime errors').toEqual([])
  }, { auto: true }],
})
