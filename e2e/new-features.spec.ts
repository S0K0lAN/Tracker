import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const STORAGE_KEY = 'focus-flow.state.v1'
const CALENDAR_GREEN = 'rgb(47, 125, 75)'
const CALENDAR_GREEN_SOFT = 'rgb(225, 241, 230)'
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

test('manual date entry keeps the week aligned and deadlines stack in the all-day lane without calendar scrollbars', async ({ page }) => {
  await page.goto('/calendar')
  const localDate = await page.evaluate(() => {
    const date = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
  })

  await page.locator('.page-header').getByRole('button', { name: 'Запланировать' }).click()
  await page.getByLabel('Название').fill('Ручная дата E2E')
  const startInput = page.getByRole('textbox', { name: 'Начало', exact: true })
  const deadlineInput = page.getByRole('textbox', { name: 'Дедлайн', exact: true })
  await expect(deadlineInput).toBeDisabled()
  await startInput.fill(`${localDate}, 11:30`)
  await expect(deadlineInput).toBeEnabled()
  await deadlineInput.fill(`${localDate}, 13:45`)
  await page.getByRole('button', { name: 'Очистить дату начала' }).click()
  await expect(page.getByRole('alert')).toContainText('Сначала уберите дедлайн')
  await expect(startInput).toHaveValue(`${localDate}, 11:30`)
  await expect(deadlineInput).toHaveValue(`${localDate}, 13:45`)
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click()

  const week = page.locator('.week-calendar')
  await expect(week.getByText('Весь день', { exact: true })).toBeVisible()
  await expect(week.getByText('Сроки', { exact: true })).toHaveCount(0)
  await expect(week.locator('.week-day__all-day')).toHaveCount(7)
  const deadlineStrip = week.getByTitle('Дедлайн: Ручная дата E2E · до 13:45')
  await expect(deadlineStrip).toBeVisible()
  await expect(deadlineStrip).toHaveAccessibleName(/до 13:45/)
  await expect(deadlineStrip.locator('time')).toBeVisible()
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
  await page.getByRole('textbox', { name: 'Начало', exact: true }).fill(`${localDate}, 09:00`)
  await page.getByRole('textbox', { name: 'Дедлайн', exact: true }).fill('31.02.2026, 18:00')
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('Исправьте дату и время перед сохранением')).toBeVisible()
})

test('task creation survives replacing time manually inside the calendar popover', async ({ page }) => {
  await page.getByRole('button', { name: 'Создать новую задачу' }).click()
  await page.getByLabel('Название').fill('Время из календаря E2E')

  await page.getByRole('button', { name: 'Открыть календарь начала' }).click()
  await page.getByRole('dialog', { name: 'Выбор даты: Начало' }).getByRole('button', { name: 'Сегодня' }).click()
  await page.getByRole('button', { name: 'Открыть календарь начала' }).click()

  const popover = page.getByRole('dialog', { name: 'Выбор даты: Начало' })
  const timeInput = popover.getByLabel('Время')
  await timeInput.fill('')
  await expect(popover).toBeVisible()
  await timeInput.fill('14:35')
  await expect(page.getByRole('textbox', { name: 'Начало', exact: true })).toHaveValue(/, 14:35$/)

  await timeInput.press('Escape')
  await expect(popover).toBeHidden()
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click()
  await expect(page.locator('.task-card__title').getByText('Время из календаря E2E', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click()
  await page.locator('.filter-panel').getByRole('button', { name: 'Все', exact: true }).click()
  await expect(page.locator('.task-card__title').getByText('Время из календаря E2E', { exact: true })).toBeVisible()

  await page.goto('/calendar')
  await expect(page.locator('.calendar-task').getByText('Время из календаря E2E', { exact: true })).toBeVisible()
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

test('calendar views, full month cell list and deadline points stay connected', async ({ page }) => {
  await page.goto('/calendar')
  const localDates = await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey))
    const template = state.tasks.find((task: { status: string }) => task.status === 'active')
    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0)
    const pad = (value: number) => String(value).padStart(2, '0')
    const localDate = (date: Date) => `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
    state.tasks = state.tasks.filter((task: { id: string }) => task.id === 'task-plan')
    state.tasks.push({
      ...template,
      id: 'long-day-slot',
      title: 'Длинный дневной слот',
      startAt: dayStart.toISOString(),
      plannedDurationMinutes: 210,
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30).toISOString(),
    })
    state.tasks.push({
      ...template,
      id: 'wrapping-week-slot',
      title: 'Подготовить подробный план презентации для общей встречи',
      startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 5, 0).toISOString(),
      plannedDurationMinutes: 180,
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0).toISOString(),
    })
    state.tasks.push({
      ...template,
      id: 'project-range',
      title: 'Диапазон проекта',
      startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 14, 0).toISOString(),
      plannedDurationMinutes: 60,
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 16, 0).toISOString(),
    })
    for (let index = 0; index < 5; index++) {
      state.tasks.push({
        ...template,
        id: `full-list-${index}`,
        title: `Полный список ${index + 1}`,
        startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15 + index, 0).toISOString(),
        plannedDurationMinutes: 30,
        deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15 + index, 30).toISOString(),
      })
    }
    localStorage.setItem(storageKey, JSON.stringify(state))
    return {
      today: localDate(now),
      intermediate: localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)),
    }
  }, STORAGE_KEY)
  await page.reload()

  for (const view of ['Год', 'Месяц', 'Неделя', '3 дня', 'День']) {
    await expect(page.getByRole('button', { name: view, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('button', { name: 'Дедлайны', exact: true })).toHaveCount(0)

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
  await page.getByRole('button', { name: `Показать задачи на ${localDates.today}` }).click()
  const dialog = page.getByRole('dialog', { name: /Все задачи дня/ })
  await expect(dialog).toBeVisible()
  for (let index = 1; index <= 5; index++) await expect(dialog.getByText(`Полный список ${index}`, { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Закрыть список задач' }).click()

  const scheduledRow = page.locator('.month-day__task').filter({ hasText: 'Диапазон проекта' })
  await expect(scheduledRow).toBeVisible()
  const deadlinePoint = page.locator('.month-calendar__range').filter({ hasText: 'Диапазон проекта' })
  await expect(deadlinePoint).toBeVisible()
  const monthSpans = await deadlinePoint.evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute('data-range-span'))),
  )
  expect(monthSpans).toEqual([1])

  await page.getByRole('button', { name: `Показать задачи на ${localDates.intermediate}` }).click()
  await expect(page.getByRole('dialog', { name: /Все задачи дня/ })).not.toContainText('Диапазон проекта')
})

test('calendar uses a fixed green task palette and a white today frame in every view', async ({ page }) => {
  await page.goto('/calendar')
  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey)!)
    const template = state.tasks.find((task: { status: string }) => task.status === 'active')
    const workProject = state.projects.find((project: { id: string }) => project.id === 'work')
    const today = new Date()
    const startOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 13, 0)
    const urgentStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0)
    const urgentDeadline = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 0)

    state.settings.accent = 'violet'
    workProject.urgencyThresholdHours = 48
    state.tasks = [
      {
        ...template,
        id: 'calendar-green-important',
        title: 'Зелёная важная задача',
        projectId: 'work',
        startAt: startOnly.toISOString(),
        deadline: undefined,
        importance: 'high',
        urgencyOverride: 'low',
        urgencyThresholdOverrideHours: undefined,
      },
      {
        ...template,
        id: 'calendar-green-urgent',
        title: 'Зелёная вычисленно срочная задача',
        projectId: 'work',
        startAt: urgentStart.toISOString(),
        deadline: urgentDeadline.toISOString(),
        importance: 'low',
        urgencyOverride: undefined,
        urgencyThresholdOverrideHours: undefined,
      },
    ]
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, STORAGE_KEY)
  await page.reload()

  for (const mode of ['Неделя', '3 дня', 'День'] as const) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    const currentDate = page.locator('[aria-current="date"]')
    await expect(currentDate).toHaveCount(1)
    const frame = await currentDate.evaluate((node) => {
      const day = node.closest('.week-day')!
      const style = getComputedStyle(day, '::after')
      return { color: style.borderTopColor, style: style.borderTopStyle, width: style.borderTopWidth }
    })
    expect(frame).toEqual({ color: 'rgb(255, 255, 255)', style: 'solid', width: '2px' })

    const importantTask = page.locator('.calendar-task').filter({ hasText: 'Зелёная важная задача' })
    await expect(importantTask).toHaveAttribute('data-importance', 'high')
    await expect(importantTask).toHaveAttribute('data-urgency', 'low')
    await expect(importantTask).toHaveAccessibleName(/Важная задача/)
    await expect(importantTask).not.toHaveAccessibleName(/Срочная задача/)
    await expect(importantTask.locator('.calendar-task-signal--importance')).toBeVisible()
    expect(await importantTask.evaluate((node) => {
      const style = getComputedStyle(node)
      return { background: style.backgroundColor, border: style.borderLeftColor }
    })).toEqual({ background: CALENDAR_GREEN_SOFT, border: CALENDAR_GREEN })

    const urgentTask = page.locator('.calendar-task').filter({ hasText: 'Зелёная вычисленно срочная задача' })
    await expect(urgentTask).toHaveAttribute('data-importance', 'low')
    await expect(urgentTask).toHaveAttribute('data-urgency', 'high')
    await expect(urgentTask).toHaveAccessibleName(/Срочная задача/)
    await expect(urgentTask).not.toHaveAccessibleName(/Важная задача/)
    await expect(urgentTask.locator('.calendar-task-signal--urgency')).toBeVisible()
    expect(await urgentTask.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(CALENDAR_GREEN_SOFT)

    const deadlineStrip = page.locator('.calendar-deadline-strip').filter({ hasText: 'Зелёная вычисленно срочная задача' })
    await expect(deadlineStrip).toHaveAttribute('data-urgency', 'high')
    expect(await deadlineStrip.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(CALENDAR_GREEN_SOFT)
  }

  await page.getByRole('button', { name: 'Месяц', exact: true }).click()
  const monthCurrentDate = page.locator('[aria-current="date"]')
  await expect(monthCurrentDate).toHaveCount(1)
  expect(await monthCurrentDate.evaluate((node) => {
    const style = getComputedStyle(node.closest('.month-day')!, '::after')
    return { color: style.borderTopColor, style: style.borderTopStyle, width: style.borderTopWidth }
  })).toEqual({ color: 'rgb(255, 255, 255)', style: 'solid', width: '2px' })

  const monthTask = page.locator('.month-day__task').filter({ hasText: 'Зелёная важная задача' })
  await expect(monthTask).toHaveAccessibleName(/Важная задача/)
  await expect(monthTask.locator('.calendar-task-signal--importance')).toBeVisible()
  expect(await monthTask.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(CALENDAR_GREEN_SOFT)
  const monthRange = page.locator('[data-task-id="calendar-green-urgent"]')
  await expect(monthRange).toHaveAccessibleName(/Срочная задача/)
  await expect(monthRange.locator('.calendar-task-signal--urgency')).toBeVisible()
  expect(await monthRange.evaluate((node) => {
    const style = getComputedStyle(node)
    return { background: style.backgroundColor, border: style.borderLeftColor }
  })).toEqual({ background: CALENDAR_GREEN_SOFT, border: CALENDAR_GREEN })

  await page.getByRole('button', { name: 'Год', exact: true }).click()
  const yearCurrentDate = page.locator('[aria-current="date"]')
  await expect(yearCurrentDate).toHaveCount(1)
  expect(await yearCurrentDate.evaluate((node) => getComputedStyle(node).boxShadow)).toContain('rgb(255, 255, 255)')
  expect(await yearCurrentDate.locator('i').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(CALENDAR_GREEN)
})

test('month deadline point stays green and adds an importance icon when importance changes', async ({ page }) => {
  await page.goto('/calendar')
  await page.getByRole('button', { name: 'Месяц', exact: true }).click()
  const range = page.locator('.month-calendar__range').filter({ hasText: 'Купить продукты на неделю' })
  await expect(range).toHaveAttribute('data-importance', 'low')
  await expect(range).toHaveAttribute('data-urgency', 'high')
  await expect(range).toHaveAccessibleName(/Срочная задача/)
  await expect(range).not.toHaveAccessibleName(/Важная задача/)
  await expect(range.locator('.calendar-task-signal--urgency')).toBeVisible()
  await expect(range.locator('.calendar-task-signal--importance')).toHaveCount(0)
  const lowStyle = await range.evaluate((node) => {
    const style = getComputedStyle(node)
    return { background: style.backgroundColor, border: style.borderLeftColor }
  })
  expect(lowStyle).toEqual({ background: CALENDAR_GREEN_SOFT, border: CALENDAR_GREEN })

  await range.click()
  const details = page.getByRole('dialog', { name: 'Купить продукты на неделю' })
  await details.getByRole('button', { name: 'Редактировать' }).click()
  await page.getByLabel('Важность').click()
  await page.getByRole('option', { name: /Важная/ }).click()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть задачу' }).click()

  await expect(range).toHaveAttribute('data-importance', 'high')
  await expect(range).toHaveAttribute('data-urgency', 'high')
  await expect(range).toHaveAccessibleName(/Важная задача/)
  await expect(range).toHaveAccessibleName(/Срочная задача/)
  await expect(range.locator('.calendar-task-signal--importance')).toBeVisible()
  await expect(range.locator('.calendar-task-signal--urgency')).toBeVisible()
  const highStyle = await range.evaluate((node) => {
    const style = getComputedStyle(node)
    return { background: style.backgroundColor, border: style.borderLeftColor }
  })
  expect(highStyle).toEqual(lowStyle)
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
  await page.getByLabel('Шрифт интерфейса').selectOption('readable')
  await page.getByRole('button', { name: 'Размер текста 120%' }).click()
  await page.getByRole('button', { name: 'Фон: Лес' }).click()
  await page.getByLabel('Затемнение фона').fill('55')
  await expect(page.getByText('Оформление сохранено локально')).toBeVisible()
  await expectStoredSetting(page, 'theme', 'dark')
  await expectStoredSetting(page, 'accent', 'violet')
  await expectStoredSetting(page, 'fontFamily', 'readable')
  await expectStoredSetting(page, 'fontScale', 120)
  await expectStoredSetting(page, 'backgroundPreset', 'forest')
  await expectStoredSetting(page, 'backgroundDim', 55)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet')
  await expect(page.locator('html')).toHaveAttribute('data-font-family', 'readable')
  await expect(page.locator('html')).toHaveAttribute('data-font-scale', '120')
  await expect(page.locator('html')).toHaveAttribute('data-background', 'forest')
  await expect(page.getByLabel('Шрифт интерфейса')).toHaveValue('readable')
  await expect(page.getByRole('button', { name: 'Размер текста 120%' })).toHaveAttribute('aria-pressed', 'true')
  const typography = await page.evaluate(() => ({
    family: getComputedStyle(document.documentElement).fontFamily,
    scale: getComputedStyle(document.documentElement).getPropertyValue('--app-font-scale').trim(),
  }))
  expect(typography.family).toContain('Verdana')
  expect(typography.scale).toBe('1.2')
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

  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/settings', '/inbox', '/calendar', '/habits']) {
    await page.goto(path)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
      `${path} overflows horizontally with 120% text on mobile`,
    ).toBe(false)
  }
})

test('Google OAuth loads a remote snapshot, keeps tokens ephemeral and auto-syncs local changes', async ({ page }) => {
  const secretToken = 'e2e-secret-google-token'
  let remoteVersion = 7
  let uploadedBody = ''
  let uploadCount = 0
  let driveReadCount = 0
  const remoteState = await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey)!)
    const template = state.tasks.find((task: { status: string }) => task.status === 'active')
    state.tasks.unshift({
      ...template,
      id: 'remote-google-task',
      title: 'Загружено из Google Drive',
      description: 'Удалённая копия для E2E',
      projectId: 'inbox',
      startAt: undefined,
      deadline: undefined,
    })
    return state
  }, STORAGE_KEY)

  await page.addInitScript((token) => {
    Object.defineProperty(window, 'google', {
      configurable: true,
      value: {
        accounts: {
          oauth2: {
            initTokenClient: (configuration: {
              client_id: string
              scope: string
              callback(response: { access_token: string; expires_in: number }): void
            }) => ({
              requestAccessToken: (options?: { prompt?: string }) => {
                const testWindow = window as Window & {
                  __e2eGoogleOAuthRequests?: Array<{ clientId: string; scope: string; prompt: string }>
                }
                testWindow.__e2eGoogleOAuthRequests ??= []
                testWindow.__e2eGoogleOAuthRequests.push({
                  clientId: configuration.client_id,
                  scope: configuration.scope,
                  prompt: options?.prompt ?? '',
                })
                window.setTimeout(() => configuration.callback({ access_token: token, expires_in: 3600 }), 0)
              },
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
      driveReadCount += 1
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
      driveReadCount += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remoteState) })
      return
    }
    if (url.includes('/upload/drive/v3/files/remote-id') && request.method() === 'PATCH') {
      uploadedBody = request.postData() ?? ''
      uploadCount += 1
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

  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey)!)
    state.settings.syncProviderConfigs['google-drive'] = {
      clientId: 'legacy-client.apps.googleusercontent.com',
    }
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, STORAGE_KEY)

  await page.reload()
  await page.goto('/settings')
  await page.getByLabel('Провайдер синхронизации').selectOption('google-drive')
  await expect(page.getByLabel('Google OAuth Client ID')).toHaveCount(0)
  await page.getByRole('button', { name: 'Войти через Google' }).click()

  const oauthRequest = await page.evaluate(() => {
    const testWindow = window as Window & {
      __e2eGoogleOAuthRequests?: Array<{ clientId: string; scope: string; prompt: string }>
    }
    return testWindow.__e2eGoogleOAuthRequests?.at(-1)
  })
  expect(oauthRequest).toMatchObject({
    scope: 'https://www.googleapis.com/auth/drive.appdata',
    prompt: 'select_account',
  })
  expect(oauthRequest?.clientId).not.toBe('legacy-client.apps.googleusercontent.com')
  expect(oauthRequest?.clientId).toMatch(/\.apps\.googleusercontent\.com$/)
  await expect(page.getByText(/Выберите действие с данными/)).toBeVisible()
  expect(driveReadCount).toBe(0)
  await expect(page.getByRole('button', { name: 'Синхронизировать данные с Google Drive' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Отправить локальные данные в Google Drive' })).toBeEnabled()

  await page.getByRole('button', { name: 'Получить данные из Google Drive' }).click()

  const conflict = page.getByRole('alert', { name: 'Конфликт синхронизации' })
  await expect(conflict).toBeVisible()
  await expect(conflict.getByText(/Ничего не будет перезаписано/)).toBeVisible()
  await conflict.getByRole('button', { name: 'Получить копию из хранилища' }).click()
  await expect(page.getByText(/Загружена копия из хранилища/)).toBeVisible()

  await page.getByRole('link', { name: 'Входящие' }).click()
  await expect(page.getByText('Загружено из Google Drive', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Создать новую задачу' }).click()
  await page.getByLabel('Название').fill('Ручная отправка E2E')
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click()
  await page.getByRole('link', { name: 'Настройки' }).click()
  await page.getByRole('button', { name: 'Отправить локальные данные в Google Drive' }).click()
  await expect.poll(() => uploadCount).toBe(1)
  expect(uploadedBody).toContain('Ручная отправка E2E')

  await page.getByRole('checkbox', { name: /Автосинхронизация/ }).check()
  await page.getByRole('link', { name: 'Входящие' }).click()
  await page.getByRole('button', { name: 'Создать новую задачу' }).click()
  await page.getByLabel('Название').fill('Автосинхронизация E2E')
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click()
  await expect.poll(() => uploadCount).toBe(2)

  expect(uploadedBody).toContain('Автосинхронизация E2E')
  expect(uploadedBody).toContain('Ручная отправка E2E')
  expect(uploadedBody).not.toContain(secretToken)
  expect(uploadedBody).not.toContain('syncProviderConfigs')
  expect(uploadedBody).not.toContain('syncProvider')
  expect(uploadedBody).not.toContain('autoSync')
  const persistedStorage = await page.evaluate(() => Object.keys(localStorage)
    .map((key) => `${key}:${localStorage.getItem(key)}`)
    .join('\n'))
  expect(persistedStorage).not.toContain(secretToken)
  expect(persistedStorage).not.toContain('legacy-client.apps.googleusercontent.com')
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('focus-flow.state.v1.import-backup')))).toBe(true)

  await page.reload()
  await page.goto('/settings')
  await expect(page.getByRole('button', { name: 'Продолжить с Google' })).toBeVisible()
  await page.getByRole('button', { name: 'Восстановить', exact: true }).click()
  await page.getByRole('link', { name: 'Входящие' }).click()
  await expect(page.getByText('Загружено из Google Drive', { exact: true })).toHaveCount(0)
})

test('habit dates align with checks, icons are centered and the daily completion chart is visible', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/habits')
  await expect(page.getByRole('img', { name: /График выполненных привычек и задач/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Последние 14 дней' })).toBeVisible()
  await page.locator('.habit-list').scrollIntoViewIfNeeded()
  await expect(page.locator('.week-labels > span')).toHaveCount(14)
  await expect(page.locator('.habit-row').first().locator('.habit-checks > button')).toHaveCount(14)
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
  const actions = page.getByRole('button', { name: 'Действия задачи Разобрать идеи для следующих улучшений' })
  await expect(actions).toBeVisible()
  await actions.click()
  const launch = page.getByRole('menuitem', { name: 'Таймер фокуса · 25 минут' })
  await expect(launch).toBeVisible()
  await launch.click()

  const timer = page.getByRole('complementary', { name: 'Таймер фокуса' })
  await expect(timer).toBeVisible()
  await expect(timer.getByText('Разобрать идеи для следующих улучшений', { exact: true })).toBeVisible()
  const bounds = await timer.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
})

test('mobile calendar keeps deadline markers and compact controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/calendar')
  const allDayOverflow = page.locator('.week-day__all-day-more').first()
  await expect(allDayOverflow).toBeVisible()
  await expect(allDayOverflow).toContainText(/Ещё \d+/)
  const overflowMetrics = await allDayOverflow.evaluate((node) => ({
    fontSize: Number.parseFloat(getComputedStyle(node).fontSize),
    height: node.getBoundingClientRect().height,
  }))
  expect(overflowMetrics.fontSize).toBeGreaterThan(0)
  expect(overflowMetrics.height + 0.01).toBeGreaterThanOrEqual(24)
  const mobileDeadlineStrip = page.locator('.calendar-deadline-strip').first()
  await expect(mobileDeadlineStrip.locator('time')).toBeVisible()
  expect((await mobileDeadlineStrip.boundingBox())!.height + 0.01).toBeGreaterThanOrEqual(24)
  await page.getByRole('button', { name: 'Месяц' }).click()
  await expect(page.getByText('Весь день', { exact: true })).toHaveCount(0)
  await expect(page.locator('.month-day')).toHaveCount(42)
  await expect(page.getByRole('button', { name: 'Дедлайн: Подготовить план недели' })).toBeVisible()

  await page.goto('/inbox')
  const taskCheck = page.getByRole('button', { name: 'Завершить задачу Разобрать идеи для следующих улучшений' })
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
    const task = state.tasks.find((item: { title: string }) => item.title === 'Разобрать идеи для следующих улучшений')
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

  const taskBody = page.locator('.task-card').filter({ hasText: 'Разобрать идеи для следующих улучшений' }).locator('.task-card__body')
  await taskBody.click()
  const preview = page.getByRole('button', { name: 'Просмотреть focus-return.txt' })
  await preview.click()
  await page.getByRole('button', { name: 'Закрыть просмотр вложения' }).click()
  await expect(preview).toBeFocused()
  await page.getByRole('button', { name: 'Закрыть задачу' }).click()
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

  await expect(page).toHaveURL(/\/projects\/p-[^/?#]+$/)
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
  await expect(page).toHaveURL(/\/projects\/p-[^/?#]+$/)
  await expect(page.getByRole('heading', { name: 'E2E Контур', level: 1 })).toBeVisible()
  await expect(page.getByText('E2E проектная задача', { exact: true })).toBeVisible()
})

test('a project urgency threshold is inherited by its tasks and updates without a task override', async ({ page }) => {
  const projectName = 'E2E срочность проекта'
  const taskTitle = 'E2E наследуемый порог'

  await page.goto('/projects')
  await page.getByRole('button', { name: 'Новый проект' }).click()
  const creator = page.getByRole('region', { name: 'Создание проекта' })
  await creator.getByLabel('Название').fill(projectName)
  await creator.getByLabel('Задачи становятся срочными за').selectOption('24')
  await creator.getByRole('button', { name: 'Создать проект' }).click()

  await expect(page.getByRole('heading', { name: projectName, level: 1 })).toBeVisible()
  await expect(page.getByText('Срочность за 1 день до дедлайна')).toBeVisible()
  await page.getByRole('button', { name: 'Задача', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Порог срочности' })).toHaveCount(0)
  await page.getByLabel('Название').fill(taskTitle)
  const schedule = await page.evaluate(() => {
    const pad = (part: number) => String(part).padStart(2, '0')
    const format = (value: Date) => `${pad(value.getDate())}.${pad(value.getMonth() + 1)}.${value.getFullYear()}, ${pad(value.getHours())}:${pad(value.getMinutes())}`
    return {
      start: format(new Date(Date.now() + 95 * 60 * 60 * 1000)),
      deadline: format(new Date(Date.now() + 96 * 60 * 60 * 1000)),
    }
  })
  await page.getByRole('textbox', { name: 'Начало', exact: true }).fill(schedule.start)
  const deadlineInput = page.getByRole('textbox', { name: 'Дедлайн', exact: true })
  await deadlineInput.fill(schedule.deadline)
  await deadlineInput.press('Tab')
  await expect(page.getByRole('combobox', { name: 'Порог срочности' })).toContainText('Из проекта · 1 день')
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click()

  const taskCard = page.locator('.task-card').filter({ hasText: taskTitle })
  await expect(taskCard).toBeVisible()
  await expect(taskCard.getByText('Не срочно', { exact: true })).toBeVisible()
  await taskCard.locator('.task-card__body').click()
  let details = page.getByRole('dialog', { name: taskTitle })
  await expect(details.getByText('24 ч до дедлайна')).toBeVisible()
  await expect(details.getByText(`Наследуется из проекта «${projectName}»`)).toBeVisible()
  await details.getByRole('button', { name: 'Закрыть задачу' }).click()

  await page.getByRole('button', { name: 'Все проекты' }).click()
  const menuTrigger = page.getByRole('button', { name: `Действия проекта ${projectName}` })
  await menuTrigger.hover()
  await page.getByRole('menuitem', { name: 'Редактировать проект' }).click()
  const editor = page.getByRole('region', { name: 'Редактирование проекта' })
  await editor.getByLabel('Задачи становятся срочными за').selectOption('168')
  await editor.getByRole('button', { name: 'Сохранить изменения' }).click()
  await expect(menuTrigger).toBeFocused()
  await menuTrigger.press('Escape')
  await expect(page.getByRole('menuitem', { name: 'Редактировать проект' })).toBeHidden()
  await page.getByRole('button', { name: `Открыть проект ${projectName}` }).click()

  await expect(page.getByText('Срочность за 7 дней до дедлайна')).toBeVisible()
  const updatedTaskCard = page.locator('.task-card').filter({ hasText: taskTitle })
  await expect(updatedTaskCard.getByText('Срочно', { exact: true })).toBeVisible()
  await updatedTaskCard.locator('.task-card__body').click()
  details = page.getByRole('dialog', { name: taskTitle })
  await expect(details.getByText('168 ч до дедлайна')).toBeVisible()
  await expect(details.getByText(`Наследуется из проекта «${projectName}»`)).toBeVisible()

  await expect.poll(() => page.evaluate(({ storageKey, expectedProject, expectedTask }) => {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return undefined
    const state = JSON.parse(raw)
    const project = state.projects.find((item: { name: string }) => item.name === expectedProject)
    const task = state.tasks.find((item: { title: string }) => item.title === expectedTask)
    return {
      projectThreshold: project?.urgencyThresholdHours,
      taskHasOverride: task ? Object.hasOwn(task, 'urgencyThresholdOverrideHours') : undefined,
    }
  }, { storageKey: STORAGE_KEY, expectedProject: projectName, expectedTask: taskTitle })).toEqual({
    projectThreshold: 168,
    taskHasOverride: false,
  })
})

test('soft delete, restore, archive and archive restore keep task data', async ({ page }) => {
  const taskTitle = 'Разобрать идеи для следующих улучшений'
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
  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey)!)
    const template = state.tasks.find((task: { id: string }) => task.id === 'task-ideas')
    state.tasks.unshift(
      { ...template, id: 'inbox-alpha', title: 'Альфа входящих', createdAt: '2026-07-01T10:00:00.000Z' },
      { ...template, id: 'inbox-omega', title: 'Якорь входящих', createdAt: '2026-07-02T10:00:00.000Z' },
    )
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, STORAGE_KEY)
  await page.reload()

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
  await expect(page.getByRole('link', { name: 'Планировать в календаре' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Вид: Список' }).click()
  await page.getByRole('button', { name: 'Действия задачи Разобрать идеи для следующих улучшений' }).click()
  await page.getByRole('menuitem', { name: 'Таймер фокуса · 25 минут' }).click()

  let timer = page.getByRole('complementary', { name: 'Таймер фокуса' })
  await expect(timer.getByText('Разобрать идеи для следующих улучшений', { exact: true })).toBeVisible()
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
  await expect(page.getByRole('textbox', { name: 'Начало', exact: true })).not.toHaveValue('')
  await expect(page.getByRole('textbox', { name: 'Дедлайн', exact: true })).toHaveValue('')
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
  await expect(page.locator('.task-card__title').getByText('Подготовить отчёт', { exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey)
    const task = raw ? JSON.parse(raw).tasks.find((item: { title: string }) => item.title === 'Подготовить отчёт') : undefined
    return task ? { hasStart: Boolean(task.startAt), hasDeadline: Boolean(task.deadline) } : undefined
  }, STORAGE_KEY)).toEqual({ hasStart: true, hasDeadline: false })

  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Проекты', exact: true }).click()
  await page.getByRole('button', { name: 'Открыть проект Работа' }).click()
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

test('portable JSON backup previews, imports, persists, and restores the previous local copy', async ({ page }) => {
  await page.goto('/settings')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать JSON' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^focus-flow-backup-.*\.json$/)
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const backupBuffer = Buffer.concat(chunks)
  const payload = JSON.parse(backupBuffer.toString('utf8'))
  expect(payload.format).toBe('focus-flow')
  expect(payload.data.tasks.length).toBeGreaterThan(0)
  expect(payload.data).not.toHaveProperty('sync')
  expect(payload.data.settings).not.toHaveProperty('syncProviderConfigs')
  const downloadedTitle = payload.data.tasks[0].title
  const recentDownloadedTitle = [...payload.data.tasks]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0].title

  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey)!)
    state.tasks[0].title = 'Локальная версия перед ручным импортом'
    state.settings.theme = 'dark'
    state.settings.fontScale = 120
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, STORAGE_KEY)
  await page.reload()
  await page.setViewportSize({ width: 390, height: 844 })

  await page.getByLabel('Файл резервной копии').setInputFiles({
    name: 'focus-flow-roundtrip.json',
    mimeType: 'application/json',
    buffer: backupBuffer,
  })
  const dialog = page.getByRole('dialog', { name: 'Импортировать резервную копию?' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(`${payload.data.tasks.length} задач`)
  await expect(dialog).toContainText(recentDownloadedTitle)
  expect(await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)!).tasks[0].title, STORAGE_KEY))
    .toBe('Локальная версия перед ручным импортом')
  const dialogBox = await dialog.boundingBox()
  expect(dialogBox).not.toBeNull()
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0)
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const accessibility = await new AxeBuilder({ page }).analyze()
  expect(accessibility.violations).toEqual([])

  await dialog.getByRole('button', { name: 'Импортировать и заменить' }).click()
  await expect(page.getByText('Резервная копия импортирована. Предыдущие локальные данные сохранены', { exact: true })).toBeVisible()
  await expect.poll(
    () => page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)!).tasks[0].title, STORAGE_KEY),
  ).toBe(downloadedTitle)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('focus-flow.state.v1.import-backup')!).tasks[0].title))
    .toBe('Локальная версия перед ручным импортом')

  await page.reload()
  await expect(page.getByText('Предыдущая локальная копия')).toBeVisible()
  await page.getByRole('button', { name: 'Восстановить' }).click()
  await expect.poll(
    () => page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)!).tasks[0].title, STORAGE_KEY),
  ).toBe('Локальная версия перед ручным импортом')
  await page.reload()
  expect(await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)!).tasks[0].title, STORAGE_KEY))
    .toBe('Локальная версия перед ручным импортом')
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
