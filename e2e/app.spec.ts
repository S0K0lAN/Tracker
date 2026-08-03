import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error
  })
  await page.goto('/inbox')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('all main pages render and navigation works', async ({ page }) => {
  const pages = [
    ['Входящие', 'Входящие'],
    ['Календарь', 'Календарь'],
    ['Матрица', 'Матрица Эйзенхауэра'],
    ['Привычки', 'Трекер привычек'],
    ['Настройки', 'Настройки'],
  ] as const

  for (const [link, heading] of pages) {
    await page.locator('.sidebar').getByRole('link', { name: new RegExp(link) }).click()
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
  }
})

test('task core flow is interactive and persists after reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Создать новую задачу' }).click()
  await page.getByLabel('Название').fill('E2E задача')
  await page.getByLabel('Дополнительный текст').fill('Проверка основного сценария')
  await page.getByLabel('Важность').click()
  await page.getByRole('option', { name: /Важная/ }).click()
  await page.getByLabel('Теги через запятую').fill('e2e, важно')
  await page.getByPlaceholder('Добавить подзадачу').fill('Проверить сохранение')
  await page.getByRole('button', { name: 'Добавить подзадачу' }).click()
  await page.locator('.task-editor').getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('button', { name: 'Создать задачу' }).click()
  await expect(page.getByText('E2E задача')).toBeVisible()

  await page.reload()
  await expect(page.getByText('E2E задача')).toBeVisible()
  await page.getByRole('button', { name: 'Завершить задачу E2E задача' }).click()
  await expect(page.getByRole('button', { name: 'Завершить задачу E2E задача' })).toHaveCount(0)
  const completion = page.getByRole('status').filter({ hasText: 'Задача «E2E задача» выполнена' })
  await expect(completion).toBeVisible()
  await completion.getByRole('button', { name: 'Отменить' }).click()
  await expect(page.getByRole('button', { name: 'Завершить задачу E2E задача' })).toBeVisible()
  await page.getByRole('button', { name: 'Завершить задачу E2E задача' }).click()
  await page.getByRole('button', { name: /Показать завершённые/ }).click()
  await expect(page.locator('.task-card__title').getByText('E2E задача', { exact: true })).toBeVisible()
})

test('calendar views, matrix and habit actions respond', async ({ page }) => {
  await page.locator('.sidebar').getByRole('link', { name: /Календарь/ }).click()
  await page.getByRole('button', { name: 'Месяц' }).click()
  await expect(page.locator('.month-calendar')).toBeVisible()
  await page.getByRole('button', { name: 'Дедлайны' }).click()
  await expect(page.getByRole('heading', { name: 'Ближайшие сроки' })).toBeVisible()

  await page.locator('.sidebar').getByRole('link', { name: /Матрица/ }).click()
  await expect(page.locator('.quadrant')).toHaveCount(4)

  await page.locator('.sidebar').getByRole('link', { name: /Привычки/ }).click()
  const habitButton = page.getByRole('button', { name: /Отметить Пить воду/ }).last()
  await habitButton.click()
  await expect(page.getByRole('button', { name: /Отменить Пить воду/ }).last()).toHaveClass(/is-done/)
})

test('settings controls and demo sync work', async ({ page }) => {
  await page.locator('.sidebar').getByRole('link', { name: /Настройки/ }).click()
  await page.getByRole('button', { name: 'Тёмная' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('checkbox', { name: /Автосинхронизация/ }).check()
  await page.getByRole('button', { name: 'Синхронизировать' }).click()
  await expect(page.getByText('Защищённая копия создана в хранилище')).toBeVisible()
})

test('mobile navigation is usable and dialogs fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('navigation', { name: 'Мобильная навигация' }).getByRole('link', { name: /Календарь/ }).click()
  await expect(page.getByRole('heading', { name: 'Календарь', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Создать задачу' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const box = await page.getByRole('dialog').boundingBox()
  expect(box?.width).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: 'Закрыть редактор' }).click()
})

test('interactive controls have accessible names', async ({ page }) => {
  for (const path of ['/inbox', '/calendar', '/matrix', '/habits', '/settings']) {
    await page.goto(path)
    const controls = page.locator('button:visible, a:visible, input:visible, select:visible, textarea:visible')
    const count = await controls.count()
    expect(count).toBeGreaterThan(0)
    for (let index = 0; index < count; index++) {
      const control = controls.nth(index)
      await expect(control).toHaveAccessibleName(/.+/)
    }
  }
})

test('secondary controls expose a visible result', async ({ page }) => {
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click()
  await expect(page.locator('.filter-panel')).toBeVisible()
  await page.getByRole('button', { name: 'Важные' }).click()
  await expect(page.locator('.filter-count')).toHaveText('1')

  await page.getByRole('button', { name: /Моё пространство/ }).click()
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Показать детали' }).click()
  await expect(page.getByText('Browser JSON adapter · готово')).toBeVisible()
  await page.getByRole('button', { name: /Контракты/ }).click()
  await expect(page.getByText('task-actions')).toBeVisible()

  await page.locator('.sidebar').getByRole('link', { name: /Привычки/ }).click()
  await page.getByRole('button', { name: 'Новая привычка' }).click()
  await page.getByPlaceholder('Например, утренняя зарядка').fill('Дыхательная практика')
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Дыхательная практика' })).toBeVisible()
})
