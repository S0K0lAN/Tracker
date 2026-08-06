import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { AppProvider } from './state/AppContext'
import { RouterProvider } from './core/router/Router'

function renderApp(path = '/inbox') {
  return render(
    <RouterProvider initialPath={path}>
      <AppProvider>
        <App />
      </AppProvider>
    </RouterProvider>,
  )
}

describe('Focus Flow app', () => {
  it('renders all five pages through navigation', async () => {
    const user = userEvent.setup()
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Входящие', level: 1 })).toBeInTheDocument()

    await user.click(screen.getAllByRole('link', { name: /Календарь/ })[0])
    expect(screen.getByRole('heading', { name: 'Календарь', level: 1 })).toBeInTheDocument()
    await user.click(screen.getAllByRole('link', { name: /Матрица/ })[0])
    expect(screen.getByRole('heading', { name: 'Матрица Эйзенхауэра', level: 1 })).toBeInTheDocument()
    await user.click(screen.getAllByRole('link', { name: /Привычки/ })[0])
    expect(screen.getByRole('heading', { name: 'Трекер привычек', level: 1 })).toBeInTheDocument()
    await user.click(screen.getAllByRole('link', { name: /Настройки/ })[0])
    expect(screen.getByRole('heading', { name: 'Настройки', level: 1 })).toBeInTheDocument()
  })

  it('creates, finds, edits and completes a task', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Создать новую задачу' }))
    await user.type(screen.getByLabelText('Название'), 'Новая проверочная задача')
    await user.type(screen.getByLabelText('Теги через запятую'), 'тест, фокус')
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))
    expect(screen.getByText('Новая проверочная задача')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Поиск задач'), 'проверочная')
    expect(screen.getByText('Новая проверочная задача')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Очистить поиск' }))
    await user.click(screen.getByRole('button', { name: 'Завершить задачу Новая проверочная задача' }))

    await waitFor(() => expect(screen.queryByText('Новая проверочная задача')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Показать завершённые/ }))
    expect(screen.getByText('Новая проверочная задача')).toBeInTheDocument()
  }, 10_000)

  it('renders a useful not-found state', async () => {
    renderApp('/unknown')
    expect(await screen.findByRole('heading', { name: 'Страница не найдена' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Вернуться во входящие/ })).toBeInTheDocument()
  })
})
