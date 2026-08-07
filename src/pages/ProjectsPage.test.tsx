import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { RouterProvider } from '../core/router/Router'
import { AppProvider } from '../state/AppContext'

function renderProjects() {
  return render(
    <RouterProvider initialPath="/projects">
      <AppProvider>
        <App />
      </AppProvider>
    </RouterProvider>,
  )
}

describe('project card actions', () => {
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
  })

  it('confirms project deletion and moves its tasks to the system inbox', async () => {
    const user = userEvent.setup()
    renderProjects()
    await screen.findByRole('heading', { name: 'Проекты', level: 1 })

    const trigger = screen.getByRole('button', { name: 'Действия проекта Работа' })
    await user.hover(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Удалить проект' }))
    await user.click(screen.getByRole('menuitem', { name: 'Подтвердить удаление' }))

    expect(screen.queryByRole('button', { name: 'Открыть проект Работа' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Открыть проект Без проекта' }))
    expect(screen.getByText('Подготовить план недели')).toBeInTheDocument()
  })
})
