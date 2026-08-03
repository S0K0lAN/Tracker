import AxeBuilder from '@axe-core/playwright'
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

async function expectStoredTaskStatus(page: Page, title: string, status: string) {
  await expect.poll(
    () =>
      page.evaluate(
        ({ storageKey, taskTitle }) => {
          const raw = localStorage.getItem(storageKey)
          if (!raw) return undefined
          return JSON.parse(raw).tasks.find((task: { title: string }) => task.title === taskTitle)?.status
        },
        { storageKey: STORAGE_KEY, taskTitle: title },
      ),
  ).toBe(status)
}

async function expectStoredSetting(page: Page, key: string, value: unknown) {
  await expect.poll(
    () =>
      page.evaluate(
        ({ storageKey, settingKey }) => {
          const raw = localStorage.getItem(storageKey)
          return raw ? JSON.parse(raw).settings[settingKey] : undefined
        },
        { storageKey: STORAGE_KEY, settingKey: key },
      ),
  ).toEqual(value)
}

test('new workspace routes support direct URLs and browser history', async ({ page }) => {
  const routes = [
    ['/today', 'Сегодня'],
    ['/projects', 'Проекты'],
    ['/search', 'Поиск'],
    ['/trash', 'Корзина'],
  ] as const

  for (const [path, heading] of routes) {
    await page.goto(path)
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
  }

  await page.goto('/today')
  await page.goto('/projects')
  await page.goBack()
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { name: 'Сегодня', level: 1 })).toBeVisible()
  await page.goForward()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('heading', { name: 'Проекты', level: 1 })).toBeVisible()
})

test('manual date entry keeps the week aligned and deadlines stack as strips without calendar scrollbars', async ({ page }) => {
  await page.goto('/calendar')
  const localDate = await page.evaluate(() => {
    const date = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
  })

  await page.locator('.page-header').getByRole('button', { name: 'Запланировать' }).click()
  await page.getByLabel('Название').fill('Ручная дата E2E')
  await page.getByRole('textbox', { name: 'Начало', exact: true }).fill(`${localDate}, 11:30`)
  await page.getByRole('textbox', { name: 'Дедлайн', exact: true }).fill(`${localDate}, 18:45`)
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click()

  const week = page.locator('.week-calendar')
  await expect(week.locator('.week-day__deadlines')).toHaveCount(7)
  await expect(week.getByTitle('Дедлайн: Ручная дата E2E')).toBeVisible()
  await expect(week.getByText('Ручная дата E2E', { exact: true })).toHaveCount(2)
  const gridTops = await week.locator('.week-day__grid').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)))
  expect(new Set(gridTops).size).toBe(1)
  expect(await week.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)

  await page.getByRole('button', { name: 'Месяц' }).click()
  const month = page.locator('.month-calendar')
  expect(await month.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)

  await month.getByRole('button', { name: `Показать задачи на ${localDate}` }).click()
  const dayDialog = page.getByRole('dialog', { name: /Все задачи дня/ })
  await expect(dayDialog).toBeVisible()
  await expect(dayDialog.getByText('Ручная дата E2E', { exact: true })).toBeVisible()
  await dayDialog.getByRole('button', { name: 'Добавить задачу' }).click()
  await expect(page.getByRole('textbox', { name: 'Начало', exact: true })).toHaveValue(`${localDate}, 09:00`)
  await page.getByRole('button', { name: 'Закрыть редактор' }).click()

  await page.getByRole('button', { name: 'Создать новую задачу' }).click()
  await page.getByLabel('Название').fill('Невалидная дата E2E')
  await page.getByRole('textbox', { name: 'Дедлайн', exact: true }).fill('31.02.2026, 18:00')
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('Исправьте дату и время перед сохранением')).toBeVisible()
})

test('overlapping week tasks are laid out side by side', async ({ page }) => {
  await page.goto('/calendar')
  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey))
    const template = state.tasks.find((task: { status: string }) => task.status === 'active')
    const start = new Date()
    start.setHours(13, 0, 0, 0)
    state.tasks.push(
      { ...template, id: 'overlap-a', title: 'Пересечение A', startAt: start.toISOString(), deadline: undefined },
      { ...template, id: 'overlap-b', title: 'Пересечение B', startAt: new Date(start.getTime() + 15 * 60_000).toISOString(), deadline: undefined },
    )
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, STORAGE_KEY)
  await page.reload()

  const first = page.locator('.calendar-task').filter({ hasText: 'Пересечение A' })
  const second = page.locator('.calendar-task').filter({ hasText: 'Пересечение B' })
  const columns = await Promise.all([
    first.getAttribute('data-overlap-column'),
    second.getAttribute('data-overlap-column'),
  ])
  const parsedColumns = columns.map((value) => value!.split('/').map(Number))
  expect(parsedColumns[0][1]).toBeGreaterThanOrEqual(2)
  expect(parsedColumns[1][1]).toBe(parsedColumns[0][1])
  expect(parsedColumns[0][0]).not.toBe(parsedColumns[1][0])
  const firstBox = await first.boundingBox()
  const secondBox = await second.boundingBox()
  expect(firstBox).not.toBeNull()
  expect(secondBox).not.toBeNull()
  const separatedHorizontally = firstBox!.x + firstBox!.width <= secondBox!.x
    || secondBox!.x + secondBox!.width <= firstBox!.x
  expect(separatedHorizontally).toBe(true)
  expect(Math.abs(firstBox!.y - secondBox!.y)).toBeLessThan(firstBox!.height)
})

test('calendar changes period by horizontal mouse drag', async ({ page }) => {
  await page.goto('/calendar')
  await page.getByRole('button', { name: 'Месяц', exact: true }).click()
  const period = page.locator('.date-navigation strong')
  const previousPeriod = await period.innerText()
  const surface = page.locator('.calendar-swipe-surface')
  const box = await surface.boundingBox()
  expect(box).not.toBeNull()

  await page.mouse.move(box!.x + box!.width * 0.75, box!.y + 90)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width * 0.25, box!.y + 90, { steps: 8 })
  await page.mouse.up()

  await expect(period).not.toHaveText(previousPeriod)
})

test('calendar scales, full month cell list and deadline ranges stay connected', async ({ page }) => {
  await page.goto('/calendar')
  const localDate = await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey))
    const template = state.tasks.find((task: { status: string }) => task.status === 'active')
    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0)
    const pad = (value: number) => String(value).padStart(2, '0')
    state.tasks.push({
      ...template,
      id: 'long-day-slot',
      title: 'Длинный дневной слот',
      startAt: dayStart.toISOString(),
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30).toISOString(),
    })
    state.tasks.push({
      ...template,
      id: 'wrapping-week-slot',
      title: 'Подготовить подробный план презентации для общей встречи',
      startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 5, 0).toISOString(),
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0).toISOString(),
    })
    state.tasks.push({
      ...template,
      id: 'project-range',
      title: 'Диапазон проекта',
      startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0).toISOString(),
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 16, 0).toISOString(),
    })
    for (let index = 0; index < 5; index++) {
      state.tasks.push({
        ...template,
        id: `full-list-${index}`,
        title: `Полный список ${index + 1}`,
        startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15 + index, 0).toISOString(),
        deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15 + index, 30).toISOString(),
      })
    }
    localStorage.setItem(storageKey, JSON.stringify(state))
    return `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`
  }, STORAGE_KEY)
  await page.reload()

  for (const view of ['Год', 'Месяц', 'Неделя', '3 дня', 'День', 'Дедлайны']) {
    await expect(page.getByRole('button', { name: view, exact: true })).toBeVisible()
  }

  const wrappingWeekSlot = page.locator('.calendar-task').filter({ hasText: 'Подготовить подробный план презентации для общей встречи' })
  const wrappingTitleBox = await wrappingWeekSlot.locator('strong').boundingBox()
  expect(wrappingTitleBox).not.toBeNull()
  expect(wrappingTitleBox!.height).toBeGreaterThan(20)

  await page.getByRole('button', { name: 'День', exact: true }).click()
  const longSlot = page.locator('.calendar-task').filter({ hasText: 'Длинный дневной слот' })
  await expect(longSlot).toHaveAttribute('data-duration-minutes', '210')
  await expect(longSlot).toHaveText('Длинный дневной слот')
  await expect(longSlot).not.toContainText(/\d{2}:\d{2}/)
  const longSlotBox = await longSlot.boundingBox()
  expect(longSlotBox).not.toBeNull()
  expect(longSlotBox!.height).toBeGreaterThan(140)
  const parallelSlot = page.locator('.calendar-task').filter({ hasText: 'Подготовить план недели' })
  const overlapColumns = await Promise.all([
    longSlot.getAttribute('data-overlap-column'),
    parallelSlot.getAttribute('data-overlap-column'),
  ])
  const parsedColumns = overlapColumns.map((value) => value!.split('/').map(Number))
  expect(parsedColumns[0][1]).toBeGreaterThanOrEqual(2)
  expect(parsedColumns[1][1]).toBe(parsedColumns[0][1])
  expect(parsedColumns[0][0]).not.toBe(parsedColumns[1][0])
  const parallelSlotBox = await parallelSlot.boundingBox()
  expect(parallelSlotBox).not.toBeNull()
  const daySlotsSeparated = parallelSlotBox!.x + parallelSlotBox!.width <= longSlotBox!.x
    || longSlotBox!.x + longSlotBox!.width <= parallelSlotBox!.x
  expect(daySlotsSeparated).toBe(true)

  await page.getByRole('button', { name: '3 дня', exact: true }).click()
  await expect(page.locator('.time-calendar--three-days .week-day')).toHaveCount(3)
  await page.getByRole('button', { name: 'Неделя', exact: true }).click()
  await expect(page.locator('.time-calendar--week .week-day')).toHaveCount(7)
  await page.getByRole('button', { name: 'Год', exact: true }).click()
  await expect(page.locator('.year-month')).toHaveCount(12)

  await page.getByRole('button', { name: 'Месяц', exact: true }).click()
  await page.getByRole('button', { name: `Показать задачи на ${localDate}` }).click()
  const dialog = page.getByRole('dialog', { name: /Все задачи дня/ })
  await expect(dialog).toBeVisible()
  for (let index = 1; index <= 5; index++) await expect(dialog.getByText(`Полный список ${index}`, { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Закрыть список задач' }).click()

  await page.getByRole('button', { name: 'Дедлайны', exact: true }).click()
  const monthRange = page.locator('.deadline-month-calendar .deadline-range').filter({ hasText: 'Диапазон проекта' })
  await expect(monthRange.first()).toBeVisible()
  const monthSpans = await monthRange.evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute('data-range-span'))),
  )
  expect(monthSpans.reduce((total, span) => total + span, 0)).toBe(3)

  await page.getByRole('button', { name: 'Дедлайны: неделя' }).click()
  const weekRange = page.locator('.deadline-week-calendar .deadline-range').filter({ hasText: 'Диапазон проекта' })
  await expect(weekRange).toHaveCount(1)
  const weekSpan = Number(await weekRange.getAttribute('data-range-span'))
  expect(weekSpan).toBeGreaterThan(0)
  expect(weekSpan).toBeLessThanOrEqual(3)
  if (weekSpan < 3) await expect(weekRange).toHaveClass(/continues-after/)
  await page.getByRole('button', { name: 'Дедлайны: год' }).click()
  await expect(page.locator('.deadline-year-calendar .deadline-range').filter({ hasText: 'Диапазон проекта' })).toHaveAttribute('data-range-span', '3')
})

test('deadline calendar updates the task color when importance changes', async ({ page }) => {
  await page.goto('/calendar')
  await page.getByRole('button', { name: 'Дедлайны', exact: true }).click()
  const range = page.locator('.deadline-range').filter({ hasText: 'Купить продукты на неделю' })
  await expect(range).toHaveAttribute('data-importance', 'low')
  const lowColor = await range.evaluate((node) => getComputedStyle(node).backgroundColor)

  await range.click()
  await page.getByLabel('Важность').click()
  await page.getByRole('option', { name: /Важная/ }).click()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()

  await expect(range).toHaveAttribute('data-importance', 'high')
  const highColor = await range.evaluate((node) => getComputedStyle(node).backgroundColor)
  expect(highColor).not.toBe(lowColor)
  await expect(range).toHaveClass(/is-important/)
})

test('search exposes its own new-task action and archive omits the redundant bulk action', async ({ page }) => {
  await page.goto('/search')
  const searchHeader = page.locator('.page-header')
  await expect(searchHeader.getByRole('button', { name: 'Новая задача' })).toBeVisible()
  await searchHeader.getByRole('button', { name: 'Новая задача' }).click()
  await expect(page.getByRole('dialog', { name: /Что нужно сделать/ })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть редактор' }).click()

  await page.goto('/trash')
  await page.getByRole('button', { name: /Архив 0/ }).click()
  await expect(page.getByRole('button', { name: /Архивировать выполненные/ })).toHaveCount(0)
})

test('appearance settings are saved locally and survive reload', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Тёмная' }).click()
  await page.getByRole('button', { name: 'Акцент violet' }).click()
  await page.getByRole('button', { name: 'Фон: Лес' }).click()
  await page.getByLabel('Затемнение фона').fill('55')
  await expect(page.getByText('Оформление сохранено локально')).toBeVisible()
  await expectStoredSetting(page, 'theme', 'dark')
  await expectStoredSetting(page, 'accent', 'violet')
  await expectStoredSetting(page, 'backgroundPreset', 'forest')
  await expectStoredSetting(page, 'backgroundDim', 55)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet')
  await expect(page.locator('html')).toHaveAttribute('data-background', 'forest')
  await expect(page.getByLabel('Затемнение фона')).toHaveValue('55')
  const dividerLayout = await page.locator('#appearance .appearance-actions').evaluate((footer) => {
    const previous = footer.previousElementSibling as HTMLElement | null
    return {
      footerBorderTop: getComputedStyle(footer).borderTopWidth,
      footerMarginTop: getComputedStyle(footer).marginTop,
      previousBorderBottom: previous ? getComputedStyle(previous).borderBottomWidth : '',
      gap: previous ? Math.round(footer.getBoundingClientRect().top - previous.getBoundingClientRect().bottom) : -1,
    }
  })
  expect(dividerLayout).toEqual({
    footerBorderTop: '0px',
    footerMarginTop: '0px',
    previousBorderBottom: '1px',
    gap: 0,
  })
})

test('Google OAuth loads a remote snapshot, keeps tokens ephemeral and auto-syncs local changes', async ({ page }) => {
  const secretToken = 'e2e-secret-google-token'
  let remoteVersion = 7
  let uploadedBody = ''
  const remoteState = await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey)!)
    const template = state.tasks.find((task: { status: string }) => task.status === 'active')
    state.tasks.unshift({
      ...template,
      id: 'remote-google-task',
      title: 'Загружено из Google Drive',
      description: 'Удалённая копия для E2E',
    })
    return state
  }, STORAGE_KEY)

  await page.addInitScript((token) => {
    Object.defineProperty(window, 'google', {
      configurable: true,
      value: {
        accounts: {
          oauth2: {
            initTokenClient: (configuration: { callback(response: { access_token: string; expires_in: number }): void }) => ({
              requestAccessToken: () => window.setTimeout(() => configuration.callback({ access_token: token, expires_in: 3600 }), 0),
            }),
            revoke: (_accessToken: string, callback?: () => void) => callback?.(),
          },
        },
      },
    })
  }, secretToken)

  await page.route('https://www.googleapis.com/**', async (route) => {
    const request = route.request()
    const url = request.url()
    if (url.includes('/drive/v3/files?') && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          files: [{
            id: 'remote-id',
            name: 'focus-flow-data.json',
            modifiedTime: '2026-08-03T12:00:00.000Z',
            version: String(remoteVersion),
            size: '4096',
          }],
        }),
      })
      return
    }
    if (url.includes('/drive/v3/files/remote-id?alt=media') && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remoteState) })
      return
    }
    if (url.includes('/upload/drive/v3/files/remote-id') && request.method() === 'PATCH') {
      uploadedBody = request.postData() ?? ''
      remoteVersion += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'remote-id',
          name: 'focus-flow-data.json',
          modifiedTime: '2026-08-03T12:05:00.000Z',
          version: String(remoteVersion),
        }),
      })
      return
    }
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })

  await page.reload()
  await page.goto('/settings')
  await page.getByLabel('Провайдер синхронизации').selectOption('google-drive')
  await page.getByLabel('Google OAuth Client ID').fill('e2e-client.apps.googleusercontent.com')
  await page.getByRole('button', { name: 'Подключить Google Drive' }).click()

  const conflict = page.getByRole('alert', { name: 'Конфликт синхронизации' })
  await expect(conflict).toBeVisible()
  await expect(conflict.getByText(/Ничего не будет перезаписано/)).toBeVisible()
  await conflict.getByRole('button', { name: 'Загрузить из хранилища' }).click()
  await expect(page.getByText(/Загружена копия из хранилища/)).toBeVisible()
  await page.getByRole('checkbox', { name: /Автосинхронизация/ }).check()

  await page.getByRole('link', { name: 'Входящие' }).click()
  await expect(page.getByText('Загружено из Google Drive', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Создать новую задачу' }).click()
  await page.getByLabel('Название').fill('Автосинхронизация E2E')
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click()
  await expect.poll(() => uploadedBody).not.toBe('')

  expect(uploadedBody).toContain('Автосинхронизация E2E')
  expect(uploadedBody).not.toContain(secretToken)
  expect(uploadedBody).not.toContain('syncProviderConfigs')
  expect(uploadedBody).not.toContain('syncProvider')
  expect(uploadedBody).not.toContain('autoSync')
  const persistedStorage = await page.evaluate(() => Object.keys(localStorage)
    .map((key) => `${key}:${localStorage.getItem(key)}`)
    .join('\n'))
  expect(persistedStorage).not.toContain(secretToken)
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('focus-flow.state.v1.import-backup')))).toBe(true)

  await page.reload()
  await page.goto('/settings')
  await expect(page.getByRole('button', { name: 'Продолжить с Google Drive' })).toBeVisible()
  await page.getByRole('button', { name: 'Восстановить', exact: true }).click()
  await page.getByRole('link', { name: 'Входящие' }).click()
  await expect(page.getByText('Загружено из Google Drive', { exact: true })).toHaveCount(0)
})

test('habit dates align with checks, icons are centered and the daily completion chart is visible', async ({ page }) => {
  await page.goto('/habits')
  await expect(page.getByRole('img', { name: /График выполненных привычек и задач/ })).toBeVisible()
  const alignment = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.week-labels > span')]
    const checks = [...document.querySelectorAll('.habit-row:first-of-type .habit-checks > button')]
    return labels.map((label, index) => {
      const labelRect = label.getBoundingClientRect()
      const checkRect = checks[index]?.getBoundingClientRect()
      return checkRect ? Math.abs((labelRect.left + labelRect.width / 2) - (checkRect.left + checkRect.width / 2)) : 999
    })
  })
  expect(Math.max(...alignment)).toBeLessThanOrEqual(1)

  const iconOffset = await page.locator('.habit-row__icon').first().evaluate((node) => {
    const outer = node.getBoundingClientRect()
    const inner = node.querySelector('svg')!.getBoundingClientRect()
    return Math.max(
      Math.abs((outer.left + outer.width / 2) - (inner.left + inner.width / 2)),
      Math.abs((outer.top + outer.height / 2) - (inner.top + inner.height / 2)),
    )
  })
  expect(iconOffset).toBeLessThanOrEqual(1)
})

test('mobile task actions launch a Pomodoro without clipping or pointer interception', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const actions = page.getByRole('button', { name: 'Действия задачи Подготовить план недели' })
  await expect(actions).toBeVisible()
  await actions.click()
  const launch = page.getByRole('menuitem', { name: 'Таймер фокуса · 25 минут' })
  await expect(launch).toBeVisible()
  await launch.click()

  const timer = page.getByRole('complementary', { name: 'Таймер фокуса' })
  await expect(timer).toBeVisible()
  await expect(timer.getByText('Подготовить план недели', { exact: true })).toBeVisible()
  const bounds = await timer.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
})

test('mobile calendar keeps deadline markers and compact controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/calendar')
  await page.getByRole('button', { name: 'Месяц' }).click()
  await expect(page.locator('.month-day')).toHaveCount(42)
  await expect(page.getByRole('button', { name: 'Дедлайн: Подготовить план недели' })).toBeVisible()

  await page.goto('/inbox')
  const taskCheck = page.getByRole('button', { name: 'Завершить задачу Подготовить план недели' })
  const taskCheckBounds = await taskCheck.boundingBox()
  expect(taskCheckBounds).not.toBeNull()
  expect(taskCheckBounds!.width).toBeGreaterThanOrEqual(44)
  expect(taskCheckBounds!.height + 0.01).toBeGreaterThanOrEqual(44)

  await page.goto('/projects')
  await page.locator('.project-card--new').click()
  const colorControl = page.getByRole('button', { name: 'Цвет проекта #778c70' })
  const colorBounds = await colorControl.boundingBox()
  expect(colorBounds).not.toBeNull()
  expect(colorBounds!.width).toBeGreaterThanOrEqual(44)
  expect(colorBounds!.height).toBeGreaterThanOrEqual(44)
})

test('dialogs and mobile drawer restore focus to their exact openers', async ({ page }) => {
  const taskOpener = page.getByRole('button', { name: 'Создать новую задачу' })
  await taskOpener.click()
  await page.getByRole('button', { name: 'Закрыть редактор' }).click()
  await expect(taskOpener).toBeFocused()

  await page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey)
    if (!raw) throw new Error('Local state was not initialized')
    const state = JSON.parse(raw)
    const task = state.tasks.find((item: { title: string }) => item.title === 'Подготовить план недели')
    task.attachments = [{
      id: 'focus-return',
      name: 'focus-return.txt',
      type: 'text/plain',
      size: 1,
      dataUrl: 'data:text/plain;base64,QQ==',
    }]
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, STORAGE_KEY)
  await page.reload()

  const taskBody = page.locator('.task-card').filter({ hasText: 'Подготовить план недели' }).locator('.task-card__body')
  await taskBody.click()
  const preview = page.getByRole('button', { name: 'Просмотреть focus-return.txt' })
  await preview.click()
  await page.getByRole('button', { name: 'Закрыть просмотр вложения' }).click()
  await expect(preview).toBeFocused()
  await page.getByRole('button', { name: 'Закрыть редактор' }).click()
  await expect(taskBody).toBeFocused()

  await page.setViewportSize({ width: 390, height: 844 })
  const drawerOpener = page.getByRole('button', { name: 'Открыть меню' })
  await drawerOpener.click()
  await expect(page.getByRole('dialog', { name: 'Меню приложения' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawerOpener).toBeFocused()
})

test('a created project can own a task and both survive reload', async ({ page }) => {
  await page.goto('/projects')
  await page.getByRole('button', { name: 'Новый проект' }).click()
  const creator = page.getByRole('region', { name: 'Создание проекта' })
  await creator.getByLabel('Название').fill('E2E Контур')
  await creator.getByLabel('Описание').fill('Подготовка сквозного релиза')
  await creator.getByRole('button', { name: 'Создать проект' }).click()

  await expect(page.getByRole('heading', { name: 'E2E Контур', level: 1 })).toBeVisible()
  await expect.poll(() =>
    page.evaluate((storageKey) => {
      const raw = localStorage.getItem(storageKey)
      return raw ? JSON.parse(raw).projects.some((project: { name: string }) => project.name === 'E2E Контур') : false
    }, STORAGE_KEY),
  ).toBe(true)

  await page.getByRole('button', { name: 'Задача' }).click()
  await page.getByLabel('Название').fill('E2E проектная задача')
  await page.getByRole('combobox', { name: 'Проект' }).click()
  await page.getByRole('option', { name: /E2E Контур/ }).click()
  await page.getByRole('button', { name: 'Создать задачу' }).click()
  await expect(page.getByText('E2E проектная задача', { exact: true })).toBeVisible()

  await page.reload()
  await page.locator('.project-card').filter({ hasText: 'E2E Контур' }).click()
  await expect(page.getByRole('heading', { name: 'E2E Контур', level: 1 })).toBeVisible()
  await expect(page.getByText('E2E проектная задача', { exact: true })).toBeVisible()
})

test('soft delete, restore, archive and archive restore keep task data', async ({ page }) => {
  const taskTitle = 'Прочитать главу книги'
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' })

  await page.getByRole('button', { name: `Действия задачи ${taskTitle}` }).click()
  await page.getByRole('menuitem', { name: 'В корзину' }).click()
  await expect(page.getByText(taskTitle, { exact: true })).toBeHidden()
  await expectStoredTaskStatus(page, taskTitle, 'deleted')

  await navigation.getByRole('link', { name: 'Корзина', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Корзина', level: 1 })).toBeVisible()
  await expect(page.getByText(taskTitle, { exact: true })).toBeVisible()
  await page.reload()
  const deletedTask = page.locator('.trash-task').filter({ hasText: taskTitle })
  await expect(deletedTask).toBeVisible()
  await deletedTask.getByRole('button', { name: 'Восстановить' }).click()
  await expectStoredTaskStatus(page, taskTitle, 'active')

  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: /Входящие/ }).click()
  await expect(page.getByText(taskTitle, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: `Завершить задачу ${taskTitle}` }).click()
  await expectStoredTaskStatus(page, taskTitle, 'completed')
  await page.getByRole('button', { name: /Показать завершённые/ }).click()
  await page.getByRole('button', { name: `Действия задачи ${taskTitle}` }).click()
  await page.getByRole('menuitem', { name: 'Архивировать' }).click()
  await expectStoredTaskStatus(page, taskTitle, 'archived')

  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Корзина', exact: true }).click()
  await page.getByRole('button', { name: /Архив\s*1/ }).click()
  await expect(page.getByText(taskTitle, { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /Архив\s*1/ }).click()
  const archivedTask = page.locator('.trash-task').filter({ hasText: taskTitle })
  await archivedTask.getByRole('button', { name: 'Вернуть' }).click()
  await expectStoredTaskStatus(page, taskTitle, 'completed')

  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: /Входящие/ }).click()
  await page.getByRole('button', { name: /Показать завершённые/ }).click()
  await expect(page.getByText(taskTitle, { exact: true })).toBeVisible()
})

test('inbox sort, layouts and a running task Pomodoro persist', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Сортировка входящих' }).click()
  await page.getByRole('option', { name: 'По названию' }).click()
  const titles = await page.locator('.task-card__title').allTextContents()
  expect(titles).toEqual([...titles].sort((left, right) => left.localeCompare(right, 'ru')))
  await expectStoredSetting(page, 'inboxSort', 'title-asc')

  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Сортировка входящих' })).toContainText('По названию')
  await page.getByRole('button', { name: 'Вид: Доска' }).click()
  await expect(page.locator('.inbox-board')).toBeVisible()
  await expectStoredSetting(page, 'inboxView', 'board')
  await page.reload()
  await expect(page.locator('.inbox-board')).toBeVisible()

  await expect(page.getByRole('button', { name: 'Вид: Календарь' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Планировать в календаре' })).toHaveAttribute('href', '/calendar')
  await page.getByRole('button', { name: 'Вид: Список' }).click()
  await page.getByRole('button', { name: 'Действия задачи Подготовить план недели' }).click()
  await page.getByRole('menuitem', { name: 'Таймер фокуса · 25 минут' }).click()

  let timer = page.getByRole('complementary', { name: 'Таймер фокуса' })
  await expect(timer.getByText('Подготовить план недели', { exact: true })).toBeVisible()
  await expect(timer.locator('time')).toHaveText('25:00')
  await timer.getByRole('button', { name: 'Запустить таймер' }).click()
  await expect(timer.getByRole('button', { name: 'Поставить таймер на паузу' })).toBeVisible()
  await expect.poll(() =>
    page.evaluate((storageKey) => {
      const raw = localStorage.getItem(storageKey)
      return raw ? Boolean(JSON.parse(raw).pomodoro.runningSince) : false
    }, STORAGE_KEY),
  ).toBe(true)

  await page.reload()
  timer = page.getByRole('complementary', { name: 'Таймер фокуса' })
  await expect(timer).toBeVisible()
  await expect(timer.getByRole('button', { name: 'Поставить таймер на паузу' })).toBeVisible()
  await expect(timer.locator('time')).toHaveText(/^(?:25:00|24:5\d)$/)
  await timer.getByRole('button', { name: 'Поставить таймер на паузу' }).click()
  await expect(timer.getByRole('button', { name: 'Запустить таймер' })).toBeVisible()
})

test('global search saves and reapplies a named filter after reload', async ({ page }) => {
  await page.goto('/search')
  await page.getByRole('textbox', { name: 'Глобальный поиск' }).fill('Работа')
  await expect(page.getByRole('heading', { name: 'Задачи' })).toBeVisible()
  await expect(page.getByText('Подготовить план недели', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Проекты' })).toBeVisible()
  await expect(page.getByText('Рабочие задачи и инициативы', { exact: true })).toBeVisible()

  await page.locator('.global-search').getByRole('button', { name: /^Фильтры/ }).click()
  await page.getByRole('button', { name: 'Сохранить фильтр' }).click()
  await page.getByRole('textbox', { name: 'Название фильтра' }).fill('Работа')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect.poll(() =>
    page.evaluate((storageKey) => {
      const raw = localStorage.getItem(storageKey)
      return raw ? JSON.parse(raw).savedFilters.some((filter: { name: string }) => filter.name === 'Работа') : false
    }, STORAGE_KEY),
  ).toBe(true)

  await page.reload()
  const savedFilters = page.locator('.search-result-section').filter({
    has: page.getByRole('heading', { name: 'Сохранённые фильтры' }),
  })
  await expect(savedFilters).toBeVisible()
  await savedFilters.locator('.search-entity__main').filter({ hasText: 'Работа' }).click()
  await expect(page.getByText('Подготовить план недели', { exact: true })).toBeVisible()
})

test('voice fallback populates task fields and an attachment can be reopened', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true })
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true })
  })
  await page.getByRole('button', { name: 'Создать новую задачу' }).click()
  await page.getByRole('button', { name: 'Надиктовать задачу' }).click()
  await page.getByRole('textbox', { name: 'Фраза для разбора задачи' }).fill(
    'Подготовить отчёт в проект Работа завтра в 10 важно #голос',
  )
  await page.getByRole('button', { name: 'Разобрать', exact: true }).click()

  const preview = page.getByLabel('Предпросмотр распознанной задачи')
  await expect(preview.getByText('Подготовить отчёт', { exact: true })).toBeVisible()
  await expect(preview.getByText('Важно', { exact: true })).toBeVisible()
  await expect(preview.getByText('#голос', { exact: true })).toBeVisible()
  await preview.getByRole('button', { name: 'Применить' }).click()
  await expect(page.getByLabel('Название')).toHaveValue('Подготовить отчёт')
  await expect(page.getByRole('combobox', { name: 'Проект' })).toContainText('Работа')
  await expect(page.getByRole('combobox', { name: 'Важность' })).toContainText('Важная')
  await expect(page.getByRole('textbox', { name: 'Дедлайн', exact: true })).not.toHaveValue('')
  await expect(page.getByLabel('Теги через запятую')).toHaveValue('голос')

  await page.locator('.task-editor input[type="file"]').setInputFiles({
    name: 'e2e-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Focus Flow attachment acceptance'),
  })
  await page.getByRole('button', { name: 'Просмотреть e2e-notes.txt' }).click()
  let attachmentDialog = page.getByRole('dialog', { name: 'e2e-notes.txt' })
  await expect(attachmentDialog).toBeVisible()
  await expect(attachmentDialog.getByText('Focus Flow attachment acceptance', { exact: true })).toBeVisible()
  await attachmentDialog.getByRole('button', { name: 'Закрыть просмотр вложения' }).click()
  await page.getByRole('button', { name: 'Создать задачу' }).click()
  await expect(page.getByText('Подготовить отчёт', { exact: true })).toBeVisible()

  await page.reload()
  await page.locator('.task-card').filter({ hasText: 'Подготовить отчёт' }).locator('.task-card__body').click()
  await page.getByRole('button', { name: 'Просмотреть e2e-notes.txt' }).click()
  attachmentDialog = page.getByRole('dialog', { name: 'e2e-notes.txt' })
  await expect(attachmentDialog).toBeVisible()
})

test('preset and custom backgrounds apply globally and survive reload', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Фон: Туман' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-background', 'mist')
  await expectStoredSetting(page, 'backgroundPreset', 'mist')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-background', 'mist')
  await expect(page.getByRole('button', { name: 'Фон: Туман' })).toHaveAttribute('aria-pressed', 'true')

  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  await page.locator('.background-picker input[type="file"]').setInputFiles({
    name: 'focus-background.png',
    mimeType: 'image/png',
    buffer: pixel,
  })
  await expect(page.locator('html')).toHaveAttribute('data-background', 'custom')
  await expectStoredSetting(page, 'backgroundPreset', 'custom')
  await expect.poll(() =>
    page.evaluate((storageKey) => {
      const raw = localStorage.getItem(storageKey)
      return raw ? String(JSON.parse(raw).settings.customBackgroundDataUrl ?? '').startsWith('data:image/png') : false
    }, STORAGE_KEY),
  ).toBe(true)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-background', 'custom')
  await expect(page.locator('html')).toHaveCSS('--custom-background-image', /data:image\/png/)
})

test('a habit keeps its icon and description and toggles independently after reload', async ({ page }) => {
  await page.goto('/habits')
  await expect(page.getByRole('button', { name: 'Новая привычка' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Новая привычка' }).click()
  await page.getByLabel('Название привычки').fill('E2E вечернее чтение')
  await page.getByLabel(/Описание/).fill('Двадцать минут без уведомлений')
  await page.getByRole('radio', { name: 'Книга' }).click()
  await page.getByRole('button', { name: 'Создать', exact: true }).click()

  let habit = page.getByRole('article', { name: 'Привычка E2E вечернее чтение' })
  await expect(habit.locator('[data-habit-icon="book"]')).toBeVisible()
  await expect(habit.getByText('Двадцать минут без уведомлений')).toBeVisible()
  await page.reload()

  habit = page.getByRole('article', { name: 'Привычка E2E вечернее чтение' })
  await expect(habit.locator('[data-habit-icon="book"]')).toBeVisible()
  await expect(habit.getByText('Двадцать минут без уведомлений')).toBeVisible()
  await habit.getByRole('button', { name: 'Редактировать привычку E2E вечернее чтение' }).click()
  const iconCenterOffsets = await page.locator('.habit-icon-picker label').evaluateAll((labels) => labels.map((label) => {
    const icon = label.querySelector('svg')
    if (!icon) return Number.POSITIVE_INFINITY
    const labelRect = label.getBoundingClientRect()
    const iconRect = icon.getBoundingClientRect()
    return Math.max(
      Math.abs(iconRect.x + iconRect.width / 2 - labelRect.x - labelRect.width / 2),
      Math.abs(iconRect.y + iconRect.height / 2 - labelRect.y - labelRect.height / 2),
    )
  }))
  expect(Math.max(...iconCenterOffsets)).toBeLessThanOrEqual(1)
  await page.getByLabel(/Описание/).fill('Обновлённое описание привычки')
  await page.getByRole('radio', { name: 'Солнце' }).click()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  habit = page.getByRole('article', { name: 'Привычка E2E вечернее чтение' })
  await expect(habit.locator('[data-habit-icon="sun"]')).toBeVisible()
  await expect(habit.getByText('Обновлённое описание привычки')).toBeVisible()
  const newHabitToday = habit.getByRole('button', { name: /Отметить E2E вечернее чтение/ }).last()
  const water = page.getByRole('article', { name: 'Привычка Пить воду' })
  const waterToday = water.getByRole('button', { name: /Отметить Пить воду/ }).last()
  await expect(waterToday).toBeVisible()
  await newHabitToday.click()
  await expect(habit.getByRole('button', { name: /Отменить E2E вечернее чтение/ }).last()).toBeVisible()
  await expect(water.getByRole('button', { name: /Отметить Пить воду/ }).last()).toBeVisible()

  await page.reload()
  habit = page.getByRole('article', { name: 'Привычка E2E вечернее чтение' })
  await expect(habit.locator('[data-habit-icon="sun"]')).toBeVisible()
  await expect(habit.getByText('Обновлённое описание привычки')).toBeVisible()
  await expect(habit.getByRole('button', { name: /Отменить E2E вечернее чтение/ }).last()).toBeVisible()
  await expect(page.getByRole('article', { name: 'Привычка Пить воду' }).getByRole('button', { name: /Отметить Пить воду/ }).last()).toBeVisible()
})

test('new pages keep text contrast and avoid horizontal overflow in both themes', async ({ page }) => {
  test.setTimeout(45_000)
  const paths = ['/today', '/projects', '/search', '/trash'] as const
  const viewports = [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ] as const

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(
      ({ storageKey, selectedTheme }) => {
        const raw = localStorage.getItem(storageKey)
        if (!raw) throw new Error('Local state was not initialized')
        const state = JSON.parse(raw)
        state.settings.theme = selectedTheme
        localStorage.setItem(storageKey, JSON.stringify(state))
      },
      { storageKey: STORAGE_KEY, selectedTheme: theme },
    )

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      for (const path of paths) {
        await page.goto(path)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
        expect(
          results.violations,
          `${theme} ${viewport.width}x${viewport.height} ${path}: ${JSON.stringify(results.violations)}`,
        ).toEqual([])
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
          `${theme} ${viewport.width}x${viewport.height} ${path} has horizontal overflow`,
        ).toBe(false)
      }
    }
  }
})
