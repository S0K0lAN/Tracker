import { expect, test, type Page } from '@playwright/test'

const STORAGE_KEY = 'focus-flow.state.v1'
const runtimeErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  runtimeErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
  })

  await page.goto('/inbox')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForFunction((storageKey) => localStorage.getItem(storageKey), STORAGE_KEY)
})

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) ?? [], 'browser runtime errors').toEqual([])
})

test('planned duration controls calendar blocks while the deadline remains independent', async ({ page }) => {
  const dates = await page.evaluate(() => {
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    const date = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`
    return {
      start: `${date}, 11:30`,
      laterDeadline: `${date}, 18:00`,
      earlierDeadline: `${date}, 08:00`,
    }
  })

  await page.goto('/calendar')
  await page.locator('.page-header').getByRole('button', { name: 'Запланировать' }).click()
  await page.getByLabel('Название').fill('Фокус-блок 210 минут')
  await page.getByRole('textbox', { name: 'Начало', exact: true }).fill(dates.start)
  await page.getByLabel('Длительность').fill('210')
  await page.getByRole('textbox', { name: 'Дедлайн', exact: true }).fill(dates.laterDeadline)
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click()

  const weekBlock = page.locator('.time-calendar--week .calendar-task').filter({ hasText: 'Фокус-блок 210 минут' })
  await expect(weekBlock).toHaveAttribute('data-duration-minutes', '210')
  await expect(weekBlock).toHaveAttribute('title', /· 11:30 — 15:00$/)
  await expect(page.getByTitle('Дедлайн: Фокус-блок 210 минут · до 18:00')).toBeVisible()

  await weekBlock.click()
  const details = page.getByRole('dialog', { name: 'Фокус-блок 210 минут' })
  await details.getByRole('button', { name: 'Редактировать' }).click()
  await expect(page.getByLabel('Длительность')).toHaveValue('210')
  await page.getByRole('textbox', { name: 'Дедлайн', exact: true }).fill(dates.earlierDeadline)
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть задачу' }).click()

  await expect(page.locator('.time-calendar--week .calendar-task').filter({ hasText: 'Фокус-блок 210 минут' })).toHaveAttribute('data-duration-minutes', '210')
  await expect(page.getByTitle('Дедлайн: Фокус-блок 210 минут · до 08:00')).toBeVisible()
  await expect.poll(() => page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey)
    const task = raw
      ? JSON.parse(raw).tasks.find((item: { title: string }) => item.title === 'Фокус-блок 210 минут')
      : undefined
    return task
      ? { duration: task.plannedDurationMinutes, deadlineHour: new Date(task.deadline).getHours() }
      : undefined
  }, STORAGE_KEY)).toEqual({ duration: 210, deadlineHour: 8 })

  await page.reload()
  await expect(page.locator('.time-calendar--week .calendar-task').filter({ hasText: 'Фокус-блок 210 минут' })).toHaveAttribute('data-duration-minutes', '210')
  await page.getByRole('button', { name: '3 дня', exact: true }).click()
  await expect(page.locator('.time-calendar--three-days .calendar-task').filter({ hasText: 'Фокус-блок 210 минут' })).toHaveAttribute('data-duration-minutes', '210')
  await page.getByRole('button', { name: 'День', exact: true }).click()
  await expect(page.locator('.time-calendar--day .calendar-task').filter({ hasText: 'Фокус-блок 210 минут' })).toHaveAttribute('data-duration-minutes', '210')
})
