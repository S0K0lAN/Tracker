import { expect, test } from './fixtures'

const STORAGE_KEY = 'focus-flow.state.v1'

test.beforeEach(async ({ page }) => {
  await page.goto('/inbox')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForFunction((storageKey) => localStorage.getItem(storageKey), STORAGE_KEY)
  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey)!)
    const task = state.tasks.find((item: { id: string }) => item.id === 'task-plan')
    task.projectId = 'inbox'
    delete task.startAt
    delete task.deadline
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, STORAGE_KEY)
  await page.reload()
})

test('an existing task opens in read mode and its explicit actions have visible effects', async ({ page }) => {
  const title = 'Подготовить план недели'
  const card = page.locator('.task-card').filter({ hasText: title })

  await card.locator('.task-card__body').click()
  let details = page.getByRole('dialog', { name: title })
  await expect(details).toBeVisible()
  await expect(details.getByLabel('Название')).toHaveCount(0)
  await expect(details.getByText('Сверить встречи и выбрать три главных результата.')).toBeVisible()
  await expect(details.getByRole('button', { name: 'Редактировать' })).toBeVisible()

  await details.getByRole('button', { name: 'Редактировать' }).click()
  const editor = page.getByRole('dialog', { name: title })
  await expect(editor.getByLabel('Название')).toHaveValue(title)
  await editor.getByRole('button', { name: 'Закрыть редактор' }).click()

  details = page.getByRole('dialog', { name: title })
  await expect(details.getByLabel('Название')).toHaveCount(0)
  await details.getByRole('button', { name: 'Таймер · 25 минут' }).click()
  const timer = page.getByRole('complementary', { name: 'Таймер фокуса' })
  await expect(timer.getByText(title, { exact: true })).toBeVisible()
  await expect(timer.locator('time')).toHaveText('25:00')
  await expect(timer.getByRole('button', { name: 'Запустить таймер' })).toBeFocused()

  await timer.getByRole('button', { name: 'Запустить таймер' }).click()
  await expect(timer.getByRole('button', { name: 'Поставить таймер на паузу' })).toBeVisible()
  await expect.poll(() => page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey)
    return raw ? Boolean(JSON.parse(raw).pomodoro.runningSince) : false
  }, STORAGE_KEY)).toBe(true)
})

test('ellipsis actions complete a task and open the read view instead of the editor', async ({ page }) => {
  const title = 'Подготовить план недели'
  const trigger = page.getByRole('button', { name: `Действия задачи ${title}` })

  await trigger.click()
  await page.getByRole('menuitem', { name: 'Открыть' }).click()
  const details = page.getByRole('dialog', { name: title })
  await expect(details).toBeVisible()
  await expect(details.getByLabel('Название')).toHaveCount(0)
  await details.getByRole('button', { name: 'Закрыть задачу' }).click()
  await expect(trigger).toBeFocused()

  await trigger.click()
  await page.getByRole('menuitem', { name: 'Завершить' }).click()
  await expect(page.getByRole('status')).toContainText(`Задача «${title}» выполнена`)
  await expect.poll(() => page.evaluate(({ storageKey, taskTitle }) => {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return undefined
    return JSON.parse(raw).tasks.find((task: { title: string }) => task.title === taskTitle)?.status
  }, { storageKey: STORAGE_KEY, taskTitle: title })).toBe('completed')
})
