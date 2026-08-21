import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { RouterProvider } from '../core/router/Router'
import { projectPath } from '../core/router/projectRoute'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'

function renderProjects(path = '/projects') {
  return render(
    <RouterProvider initialPath={path}>
      <AppProvider>
        <App />
      </AppProvider>
    </RouterProvider>,
  )
}

describe('project card actions', () => {
  it('restores focus after cancelling project creation', async () => {
    const user = userEvent.setup()
    renderProjects()
    const trigger = await screen.findByRole('button', { name: 'Новый проект' })

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Отмена' }))

    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('opens a project from a direct URL and returns to the project list', async () => {
    const user = userEvent.setup()
    renderProjects('/projects/p-work')

    expect(await screen.findByRole('heading', { name: 'Работа', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Проекты' })).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('button', { name: 'Все проекты' }))
    const listHeading = screen.getByRole('heading', { name: 'Проекты', level: 1 })
    expect(listHeading).toBeInTheDocument()
    await waitFor(() => expect(listHeading).toHaveFocus())
  })

  it('replaces an unknown project detail route with the project overview', async () => {
    renderProjects('/projects/p-does-not-exist')

    expect(await screen.findByRole('heading', { name: 'Проекты', level: 1 })).toBeInTheDocument()
  })

  it('opens an imported project whose id is a URL dot segment', async () => {
    const state = createSeedState()
    state.projects.push({
      id: '..',
      name: 'Проект с точками',
      color: '#778c70',
      urgencyThresholdHours: 72,
      createdAt: new Date().toISOString(),
    })
    localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))

    renderProjects(projectPath('..'))

    expect(await screen.findByRole('heading', { name: 'Проект с точками', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Проекты' })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps the visible mobile project CTA text in its accessible name', async () => {
    const user = userEvent.setup()
    renderProjects()
    await user.click(await screen.findByRole('button', { name: 'Открыть проект Работа' }))

    expect(screen.getByRole('button', { name: 'Задача в проект «Работа»' })).toHaveTextContent('Задача в проект')
  })

  it('shows the project menu on hover and edits the project', async () => {
    const user = userEvent.setup()
    renderProjects()
    await screen.findByRole('heading', { name: 'Проекты', level: 1 })

    const trigger = screen.getByRole('button', { name: 'Действия проекта Работа' })
    expect(screen.queryByRole('menu', { name: 'Действия проекта Работа' })).not.toBeInTheDocument()

    await user.hover(trigger)
    const menu = screen.getByRole('menu', { name: 'Действия проекта Работа' })
    expect(within(menu).getByRole('menuitem', { name: 'Удалить проект' })).toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: 'Редактировать проект' }))

    const editor = screen.getByRole('region', { name: 'Редактирование проекта' })
    const name = within(editor).getByLabelText('Название')
    await user.clear(name)
    await user.type(name, 'Рабочие планы')
    await user.click(within(editor).getByRole('button', { name: 'Сохранить изменения' }))

    expect(screen.getByRole('button', { name: 'Открыть проект Рабочие планы' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Открыть проект Работа' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Действия проекта Рабочие планы' })).toHaveFocus())
  })

  it('edits the system inbox threshold without offering deletion', async () => {
    const user = userEvent.setup()
    renderProjects()
    await screen.findByRole('heading', { name: 'Проекты', level: 1 })

    const trigger = screen.getByRole('button', { name: 'Действия проекта Без проекта' })
    await user.hover(trigger)
    const menu = screen.getByRole('menu', { name: 'Действия проекта Без проекта' })
    expect(within(menu).queryByRole('menuitem', { name: 'Удалить проект' })).not.toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: 'Редактировать проект' }))

    const editor = screen.getByRole('region', { name: 'Редактирование проекта' })
    await user.selectOptions(within(editor).getByLabelText('Задачи становятся срочными за'), '336')
    await user.click(within(editor).getByRole('button', { name: 'Сохранить изменения' }))

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('focus-flow.state.v1')!)
      expect(saved.projects.find((project: { id: string }) => project.id === 'inbox')?.urgencyThresholdHours).toBe(336)
    })
    await user.click(screen.getByRole('button', { name: 'Открыть проект Без проекта' }))
    expect(screen.getByText('Срочность за 14 дней до дедлайна')).toBeInTheDocument()
  })

  it('starts from the settings default and preserves the project urgency threshold on create and edit', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    state.settings.defaultUrgencyThresholdHours = 24
    state.projects.push({
      id: 'hydrated-project',
      name: 'Маркер загрузки',
      color: '#778c70',
      urgencyThresholdHours: 72,
      createdAt: new Date().toISOString(),
    })
    localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))
    renderProjects()
    await screen.findByRole('button', { name: 'Открыть проект Маркер загрузки' })
    await user.click(screen.getByRole('button', { name: 'Новый проект' }))

    const creator = screen.getByRole('region', { name: 'Создание проекта' })
    const threshold = within(creator).getByLabelText('Задачи становятся срочными за')
    expect(threshold).toHaveValue('24')
    await user.type(within(creator).getByLabelText('Название'), 'Запуск')
    await user.selectOptions(threshold, '168')
    await user.click(within(creator).getByRole('button', { name: 'Создать проект' }))

    expect(screen.getByRole('heading', { name: 'Запуск', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Срочность за 7 дней до дедлайна')).toBeInTheDocument()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('focus-flow.state.v1')!)
      expect(saved.projects.find((project: { name: string }) => project.name === 'Запуск')?.urgencyThresholdHours).toBe(168)
    })

    await user.click(screen.getByRole('button', { name: 'Все проекты' }))
    const menuTrigger = screen.getByRole('button', { name: 'Действия проекта Запуск' })
    await user.hover(menuTrigger)
    await user.click(screen.getByRole('menuitem', { name: 'Редактировать проект' }))
    const editor = screen.getByRole('region', { name: 'Редактирование проекта' })
    const editedThreshold = within(editor).getByLabelText('Задачи становятся срочными за')
    expect(editedThreshold).toHaveValue('168')
    await user.selectOptions(editedThreshold, '24')
    await user.click(within(editor).getByRole('button', { name: 'Сохранить изменения' }))

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('focus-flow.state.v1')!)
      expect(saved.projects.find((project: { name: string }) => project.name === 'Запуск')?.urgencyThresholdHours).toBe(24)
    })
  })

  it('confirms project deletion and moves its tasks to the system inbox', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    state.projects.find((project) => project.id === 'work')!.urgencyThresholdHours = 24
    localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))
    renderProjects()
    await screen.findByRole('heading', { name: 'Проекты', level: 1 })

    const trigger = screen.getByRole('button', { name: 'Действия проекта Работа' })
    await user.hover(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Удалить проект' }))
    await user.click(screen.getByRole('menuitem', { name: 'Подтвердить удаление' }))

    expect(screen.queryByRole('button', { name: 'Открыть проект Работа' })).not.toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(/Открыть проект/))
    expect(document.activeElement?.isConnected).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Открыть проект Без проекта' }))
    expect(screen.getByText('Подготовить план недели')).toBeInTheDocument()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('focus-flow.state.v1')!)
      expect(saved.tasks.find((task: { id: string }) => task.id === 'task-plan')?.urgencyThresholdOverrideHours).toBe(24)
    })

    const movedTask = screen.getByText('Подготовить план недели', { selector: '.task-card__title' }).closest<HTMLElement>('.task-card')
    await user.click(movedTask!.querySelector<HTMLButtonElement>('.task-card__body')!)
    const details = screen.getByRole('dialog', { name: 'Подготовить план недели' })
    expect(within(details).getByText('24 ч до дедлайна')).toBeInTheDocument()
    expect(within(details).getByText('Индивидуальный для задачи')).toBeInTheDocument()
  })
})
