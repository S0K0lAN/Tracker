import { expect, test, type Page } from './fixtures'

const STORAGE_KEY = 'focus-flow.state.v1'

test.beforeEach(async ({ page }) => {
  await page.goto('/inbox')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForFunction((storageKey) => localStorage.getItem(storageKey), STORAGE_KEY)
})

test('the visible sidebar remains clickable and keyboard-operable at 1024px', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  const sidebar = page.locator('.sidebar')
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' })

  await expect(sidebar).toBeVisible()
  await expect(sidebar).not.toHaveAttribute('inert', '')
  await expect(page.getByRole('button', { name: 'Открыть меню' })).toBeHidden()

  await navigation.getByRole('link', { name: 'Проекты' }).click()
  await expect(page).toHaveURL(/\/projects$/)

  const settings = navigation.getByRole('link', { name: 'Настройки' })
  await settings.focus()
  await expect(settings).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/settings$/)
})

test('mobile project creation keeps its project context and survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/projects')
  await page.getByRole('button', { name: 'Открыть проект Работа' }).click()

  const contextAction = page.getByRole('button', { name: 'Задача в проект «Работа»' })
  await expect(contextAction).toBeVisible()
  await expect(page).toHaveURL(/\/projects\/p-work$/)
  await contextAction.click()

  const project = page.getByRole('combobox', { name: 'Проект' })
  await expect(project).toContainText('Работа')
  await project.click()
  const popoverZIndex = await page.locator('.select-menu__popover').evaluate((element) => Number(getComputedStyle(element).zIndex))
  const backdropZIndex = await page.locator('.modal-backdrop').evaluate((element) => Number(getComputedStyle(element).zIndex))
  expect(popoverZIndex).toBeGreaterThan(backdropZIndex)
  await page.getByRole('option', { name: /Работа/ }).click()

  await page.getByLabel('Название').fill('Контекстная мобильная задача')
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click()
  await expect(page.getByText('Контекстная мобильная задача', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey)
    const task = raw ? JSON.parse(raw).tasks.find((item: { title: string }) => item.title === 'Контекстная мобильная задача') : undefined
    return task?.projectId
  }, STORAGE_KEY)).toBe('work')

  await page.reload()
  await expect(page).toHaveURL(/\/projects\/p-work$/)
  await expect(page.getByRole('heading', { name: 'Работа', level: 1 })).toBeVisible()
  await expect(page.getByText('Контекстная мобильная задача', { exact: true })).toBeVisible()
})

test('project search results support direct URL, Back and Forward navigation', async ({ page }) => {
  await page.goto('/search')
  await page.getByRole('textbox', { name: 'Глобальный поиск' }).fill('Работа')
  await page.getByRole('link', { name: 'Открыть проект Работа' }).click()

  await expect(page).toHaveURL(/\/projects\/p-work$/)
  await expect(page.getByRole('heading', { name: 'Работа', level: 1 })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/search\?q=/)
  await expect(page.getByRole('heading', { name: 'Поиск', level: 1 })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Глобальный поиск' })).toHaveValue('Работа')
  await expect(page.getByRole('link', { name: 'Открыть проект Работа' })).toBeVisible()

  await page.goForward()
  await expect(page).toHaveURL(/\/projects\/p-work$/)
  await expect(page.getByRole('heading', { name: 'Работа', level: 1 })).toBeVisible()
})

test('an unknown project detail URL returns to the project overview without a stale history entry', async ({ page }) => {
  await page.goto('/projects/p-does-not-exist')

  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('heading', { name: 'Проекты', level: 1 })).toBeVisible()
})

test('bulk archive persists only completed tasks visible through the selected filter', async ({ page }) => {
  await page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey)
    if (!raw) throw new Error('Local state was not initialized')
    const state = JSON.parse(raw)
    const template = state.tasks.find((task: { status: string }) => task.status === 'active')
    const today = new Date()
    today.setHours(10, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    state.tasks = [
      {
        ...template,
        id: 'bulk-today',
        title: 'Завершена сегодня E2E',
        status: 'completed',
        startAt: today.toISOString(),
        deadline: undefined,
        completedAt: today.toISOString(),
      },
      {
        ...template,
        id: 'bulk-tomorrow',
        title: 'Завершена завтра E2E',
        status: 'completed',
        startAt: tomorrow.toISOString(),
        deadline: undefined,
        completedAt: today.toISOString(),
      },
    ]
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, STORAGE_KEY)
  await page.reload()

  await page.getByRole('button', { name: 'Фильтры', exact: true }).click()
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click()
  await page.getByRole('button', { name: 'Показать завершённые', exact: true }).click()
  await expect(page.getByText('Завершена сегодня E2E', { exact: true })).toBeVisible()
  await expect(page.getByText('Завершена завтра E2E', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Архивировать', exact: true }).click()
  const persistedStatuses = () => page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return undefined
    const tasks = JSON.parse(raw).tasks as Array<{ id: string; status: string }>
    return {
      today: tasks.find((task) => task.id === 'bulk-today')?.status,
      tomorrow: tasks.find((task) => task.id === 'bulk-tomorrow')?.status,
    }
  }, STORAGE_KEY)
  await expect.poll(persistedStatuses).toEqual({ today: 'archived', tomorrow: 'completed' })

  await page.reload()
  await expect.poll(persistedStatuses).toEqual({ today: 'archived', tomorrow: 'completed' })
})

test('searchable project menu preserves logical Tab order inside TaskEditor', async ({ page }) => {
  await page.goto('/inbox')
  await page.getByRole('button', { name: 'Создать новую задачу' }).click()
  const project = page.getByRole('combobox', { name: 'Проект' })

  await project.click()
  await page.getByRole('combobox', { name: 'Поиск: проект' }).fill('Раб')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('combobox', { name: 'Важность' })).toBeFocused()

  await project.click()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByLabel('Дополнительный текст')).toBeFocused()
})

test('custom backgrounds enforce the readable overlay in light and dark themes', async ({ page }) => {
  await page.goto('/settings')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(({ storageKey, selectedTheme }) => {
      const raw = localStorage.getItem(storageKey)
      if (!raw) throw new Error('Local state was not initialized')
      const state = JSON.parse(raw)
      state.settings.theme = selectedTheme
      state.settings.backgroundPreset = 'custom'
      state.settings.customBackgroundDataUrl = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path fill="#000" d="M0 0h1v1H0z"/></svg>')}`
      state.settings.backgroundDim = 10
      localStorage.setItem(storageKey, JSON.stringify(state))
    }, { storageKey: STORAGE_KEY, selectedTheme: theme })
    await page.reload()

    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.getByRole('slider', { name: 'Затемнение фона' })).toHaveValue('65')
    const opacity = await page.locator('.app-shell').evaluate((element) => getComputedStyle(element, '::after').opacity)
    expect(Number(opacity)).toBeGreaterThanOrEqual(0.65)
  }
})
