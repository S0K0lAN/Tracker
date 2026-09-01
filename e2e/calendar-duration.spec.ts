import { expect, test } from './fixtures'

const STORAGE_KEY = 'focus-flow.state.v1'

test.beforeEach(async ({ page }) => {
  await page.goto('/inbox')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForFunction((storageKey) => localStorage.getItem(storageKey), STORAGE_KEY)
})

test('creates an ordinary all-day task with one button and keeps it date-only after reload', async ({ page }) => {
  const taskTitle = 'Обычная задача на весь день'
  const todayKey = await page.evaluate(() => {
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  })

  await page.goto('/calendar')
  await page.locator('.page-header').getByRole('button', { name: 'Запланировать' }).click()
  await page.getByLabel('Название').fill(taskTitle)
  const allDayToggle = page.getByRole('button', { name: 'Весь день' })
  await expect(allDayToggle).toHaveAttribute('aria-pressed', 'false')
  await allDayToggle.click()

  await expect(allDayToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Дата')).toHaveValue(todayKey)
  await expect(page.getByRole('textbox', { name: 'Начало', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Длительность')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Дедлайн', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Срочность вручную' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click()

  const weekTask = page.locator('.time-calendar--week .time-calendar__all-day-range').filter({ hasText: taskTitle })
  await expect(weekTask).toBeVisible()
  await expect(weekTask).toHaveAttribute('data-all-day-kind', 'task')
  await expect(weekTask).not.toHaveAttribute('data-urgency')
  await expect.poll(() => page.evaluate(({ storageKey, title }) => {
    const raw = localStorage.getItem(storageKey)
    const task = raw
      ? JSON.parse(raw).tasks.find((item: { title: string }) => item.title === title)
      : undefined
    return task
      ? {
          allDayDate: task.allDayDate ?? null,
          hasStart: Object.hasOwn(task, 'startAt'),
          hasDuration: Object.hasOwn(task, 'plannedDurationMinutes'),
          hasDeadline: Object.hasOwn(task, 'deadline'),
          hasUrgency: Object.hasOwn(task, 'urgencyOverride'),
        }
      : undefined
  }, { storageKey: STORAGE_KEY, title: taskTitle })).toEqual({
    allDayDate: todayKey,
    hasStart: false,
    hasDuration: false,
    hasDeadline: false,
    hasUrgency: false,
  })

  await page.reload()
  await expect(page.locator('.time-calendar--week .time-calendar__all-day-range').filter({ hasText: taskTitle })).toBeVisible()
  await page.getByRole('button', { name: 'Месяц', exact: true }).click()
  await expect(page.locator('.month-day__task--all-day').filter({ hasText: taskTitle })).toHaveCount(1)
  await expect(page.locator('.month-calendar .deadline-range').filter({ hasText: taskTitle })).toHaveCount(0)
})

test('planned duration and deadline are mutually exclusive and switch calendar projections', async ({ page }) => {
  const dates = await page.evaluate(() => {
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    const date = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`
    return {
      start: `${date}, 11:30`,
      deadline: `${date}, 18:00`,
    }
  })

  await page.goto('/calendar')
  await page.locator('.page-header').getByRole('button', { name: 'Запланировать' }).click()
  await page.getByLabel('Название').fill('Фокус-блок 210 минут')
  await page.getByRole('textbox', { name: 'Начало', exact: true }).fill(dates.start)
  const deadlineInput = page.getByRole('textbox', { name: 'Дедлайн', exact: true })
  await expect(deadlineInput).toBeEnabled()
  await page.getByLabel('Длительность').fill('210')
  await expect(deadlineInput).toBeDisabled()
  await expect(page.getByText('Сначала очистите длительность, чтобы указать дедлайн.')).toBeVisible()
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click()

  const weekBlock = page.locator('.time-calendar--week .calendar-task').filter({ hasText: 'Фокус-блок 210 минут' })
  await expect(weekBlock).toHaveAttribute('data-duration-minutes', '210')
  await expect(weekBlock).toHaveAttribute('title', /· 11:30 — 15:00$/)
  await expect(page.locator('.time-calendar__all-day-range').filter({ hasText: 'Фокус-блок 210 минут' })).toHaveCount(0)
  await expect.poll(() => page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey)
    const task = raw
      ? JSON.parse(raw).tasks.find((item: { title: string }) => item.title === 'Фокус-блок 210 минут')
      : undefined
    return task
      ? { duration: task.plannedDurationMinutes ?? null, deadline: task.deadline ?? null }
      : undefined
  }, STORAGE_KEY)).toEqual({ duration: 210, deadline: null })

  await weekBlock.click()
  const details = page.getByRole('dialog', { name: 'Фокус-блок 210 минут' })
  await details.getByRole('button', { name: 'Редактировать' }).click()
  const durationInput = page.getByLabel('Длительность')
  await expect(durationInput).toHaveValue('210')
  await durationInput.fill('')
  await expect(page.getByRole('textbox', { name: 'Дедлайн', exact: true })).toBeEnabled()
  await page.getByRole('textbox', { name: 'Дедлайн', exact: true }).fill(dates.deadline)
  await page.getByRole('textbox', { name: 'Дедлайн', exact: true }).press('Tab')
  await expect(durationInput).toBeDisabled()
  await expect(page.getByText('Сначала уберите дедлайн, чтобы указать длительность.')).toBeVisible()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть задачу' }).click()

  await expect(page.locator('.time-calendar--week .calendar-task').filter({ hasText: 'Фокус-блок 210 минут' })).toHaveCount(0)
  const weekDeadline = page.locator('.time-calendar--week .time-calendar__all-day-range').filter({ hasText: 'Фокус-блок 210 минут' })
  await expect(weekDeadline).toBeVisible()
  await expect(weekDeadline).toHaveAttribute('data-range-span', '1')
  await expect(weekDeadline).toHaveAttribute('title', /до 18:00/)
  await expect.poll(() => page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey)
    const task = raw
      ? JSON.parse(raw).tasks.find((item: { title: string }) => item.title === 'Фокус-блок 210 минут')
      : undefined
    return task
      ? { duration: task.plannedDurationMinutes ?? null, deadlineHour: new Date(task.deadline).getHours() }
      : undefined
  }, STORAGE_KEY)).toEqual({ duration: null, deadlineHour: 18 })

  await page.reload()
  await expect(page.locator('.time-calendar--week .time-calendar__all-day-range').filter({ hasText: 'Фокус-блок 210 минут' })).toBeVisible()
  await page.getByRole('button', { name: '3 дня', exact: true }).click()
  await expect(page.locator('.time-calendar--three-days .time-calendar__all-day-range').filter({ hasText: 'Фокус-блок 210 минут' })).toBeVisible()
  await page.getByRole('button', { name: 'День', exact: true }).click()
  await expect(page.locator('.time-calendar--day .time-calendar__all-day-range').filter({ hasText: 'Фокус-блок 210 минут' })).toBeVisible()
})

test('completed tasks stay visible in calendar views and after reload', async ({ page }) => {
  const completedTitle = 'Подготовить план недели'
  await page.goto('/calendar')

  const deadlineRange = page.locator('.time-calendar--week [data-task-id="task-plan"]')
  await expect(deadlineRange).toBeVisible()
  await deadlineRange.click()
  const details = page.getByRole('dialog', { name: completedTitle })
  await details.getByRole('button', { name: 'Завершить', exact: true }).click()
  await expect(details.getByText('Выполнена', { exact: true })).toBeVisible()
  await details.getByRole('button', { name: 'Закрыть задачу' }).click()

  await expect(deadlineRange).toHaveAttribute('data-status', 'completed')
  await page.reload()
  await expect(page.locator('[data-task-id="task-plan"]')).toHaveAttribute('data-status', 'completed')

  await page.getByRole('button', { name: '3 дня', exact: true }).click()
  await expect(page.locator('.time-calendar--three-days [data-task-id="task-plan"]')).toHaveAttribute('data-status', 'completed')
  await page.getByRole('button', { name: 'День', exact: true }).click()
  await expect(page.locator('.time-calendar--day [data-task-id="task-plan"]')).toHaveAttribute('data-status', 'completed')
  await page.getByRole('button', { name: 'Месяц', exact: true }).click()
  await expect(page.locator('.month-calendar [data-task-id="task-plan"]')).toHaveAttribute('data-status', 'completed')
  await page.getByRole('button', { name: 'Год', exact: true }).click()
  const today = new Date()
  await page.getByRole('button', { name: new RegExp(`${today.toLocaleDateString('ru-RU')}, задач:`) }).click()
  await expect(page.getByRole('dialog', { name: /Все задачи дня/ }).getByText(completedTitle, { exact: true })).toBeVisible()
})
