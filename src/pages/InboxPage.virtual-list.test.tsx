import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../domain/models'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'
import { InboxPage } from './InboxPage'

const STORAGE_KEY = 'focus-flow.state.v1'

function storeLongInbox(taskCount = 160) {
  const state = createSeedState()
  const template = state.tasks.find((task) => task.status === 'active')!
  state.settings.inboxSort = 'title-asc'
  state.tasks = Array.from({ length: taskCount }, (_, index): Task => {
    const position = index + 1
    const timestamp = new Date(Date.UTC(2026, 7, 21, 9, 0, 0, position)).toISOString()
    return {
      ...template,
      id: `virtual-${position}`,
      title: `Виртуальная задача ${String(position).padStart(3, '0')}`,
      description: '',
      projectId: 'inbox',
      status: 'active',
      startAt: undefined,
      deadline: undefined,
      completedAt: undefined,
      archivedAt: undefined,
      deletedAt: undefined,
      previousStatus: undefined,
      tags: [],
      subtasks: [],
      reminders: [],
      attachments: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function renderLongInbox() {
  return render(
    <AppProvider>
      <InboxPage onEditTask={vi.fn()} />
    </AppProvider>,
  )
}

describe('accessible virtual Inbox list', () => {
  it('exposes the rendered range and each item position without mounting every task card', async () => {
    storeLongInbox()
    renderLongInbox()

    const list = await screen.findByRole('list', { name: 'Виртуальный список задач' })
    const range = screen.getByText(/Доступны задачи 1–\d+ из 160/)
    const items = screen.getAllByRole('listitem')

    expect(list).toHaveAccessibleDescription(expect.stringContaining(range.textContent!))
    expect(items.length).toBeLessThan(160)
    expect(items[0]).toHaveAttribute('aria-posinset', '1')
    expect(items[0]).toHaveAttribute('aria-setsize', '160')
    expect(items.at(-1)).toHaveAttribute('aria-posinset', String(items.length))
  })

  it('keeps keyboard focus on progressive navigation and makes the final task reachable', async () => {
    const user = userEvent.setup()
    const scrollTo = vi.spyOn(window, 'scrollTo')
    storeLongInbox()
    renderLongInbox()

    await screen.findByRole('list', { name: 'Виртуальный список задач' })
    const next = screen.getByRole('button', { name: 'Следующие' })
    const range = screen.getByText(/Доступны задачи \d+–\d+ из 160/)
    next.focus()

    let navigationCount = 0
    while (next.getAttribute('aria-disabled') !== 'true' && navigationCount < 100) {
      const previousRange = range.textContent
      await user.keyboard('{Enter}')
      await waitFor(() => expect(range.textContent).not.toBe(previousRange))
      expect(next).toHaveFocus()
      navigationCount += 1
    }

    expect(navigationCount).toBeGreaterThan(0)
    expect(navigationCount).toBeLessThan(100)
    expect(next).toHaveAttribute('aria-disabled', 'true')
    expect(next).toHaveFocus()
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto', top: expect.any(Number) }))

    const finalTitle = await screen.findByText('Виртуальная задача 160', { selector: '.task-card__title' })
    const finalTaskButton = finalTitle.closest('.task-card')?.querySelector<HTMLButtonElement>('.task-card__body')
    expect(finalTaskButton).toBeTruthy()

    for (let tabCount = 0; document.activeElement !== finalTaskButton && tabCount < 100; tabCount += 1) {
      await user.tab()
    }
    expect(finalTaskButton).toHaveFocus()
  })
})
