import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { useNow } from '../hooks/useNow'
import { trapTabKey } from './focusTrap'
import { SelectMenu } from './SelectMenu'

afterEach(() => vi.useRealTimers())

function ClockedSelectMenu() {
  const now = useNow()
  return (
    <div>
      <output aria-label="Текущее время">{now.toISOString()}</output>
      <SelectMenu
        label="Проект"
        value="inbox"
        onChange={vi.fn()}
        searchable
        options={[
          { value: 'inbox', label: 'Без проекта' },
          { value: 'work', label: 'Работа' },
          { value: 'personal', label: 'Личное' },
        ]}
      />
    </div>
  )
}

function FocusOrderHarness() {
  const dialogRef = useRef<HTMLElement>(null)
  return (
    <section ref={dialogRef} role="dialog" aria-label="Редактор" onKeyDown={(event) => trapTabKey(event, dialogRef.current)}>
      <button type="button">До выбора</button>
      <SelectMenu
        label="Проект"
        value="inbox"
        onChange={vi.fn()}
        searchable
        options={[
          { value: 'inbox', label: 'Без проекта' },
          { value: 'work', label: 'Работа' },
        ]}
      />
      <button type="button">После выбора</button>
    </section>
  )
}

describe('SelectMenu searchable combobox', () => {
  it('moves the active descendant contract to the focused search input', async () => {
    const user = userEvent.setup()
    render(
      <SelectMenu
        label="Проект"
        value="inbox"
        onChange={vi.fn()}
        searchable
        options={[
          { value: 'inbox', label: 'Без проекта' },
          { value: 'work', label: 'Работа' },
          { value: 'personal', label: 'Личное' },
        ]}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'Проект' })
    await user.click(trigger)

    const search = screen.getByRole('combobox', { name: 'Поиск: проект' })
    const listbox = screen.getByRole('listbox', { name: 'Проект' })
    expect(search).toHaveFocus()
    expect(search).toHaveAttribute('aria-controls', listbox.id)
    expect(search.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Без проекта' }).id)
    expect(trigger).not.toHaveAttribute('aria-activedescendant')

    await user.keyboard('{ArrowDown}')
    expect(search.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Работа' }).id)
  })

  it('keeps the search query and active option across a minute-driven parent rerender', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T09:00:30.000Z'))
    const view = render(<ClockedSelectMenu />)

    fireEvent.click(screen.getByRole('combobox', { name: 'Проект' }))
    const search = screen.getByRole('combobox', { name: 'Поиск: проект' })
    fireEvent.change(search, { target: { value: 'раб' } })
    expect(search).toHaveValue('раб')
    expect(screen.getByRole('option', { name: 'Работа' })).toBeInTheDocument()

    act(() => {
      vi.setSystemTime(new Date('2026-08-21T09:01:30.000Z'))
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(search).toHaveValue('раб')
    expect(search).toHaveFocus()
    expect(search.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Работа' }).id)
    expect(screen.queryByRole('option', { name: 'Без проекта' })).not.toBeInTheDocument()
    view.unmount()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('moves Tab and Shift+Tab from the portal input to logical dialog neighbours', async () => {
    const user = userEvent.setup()
    render(<FocusOrderHarness />)
    const trigger = screen.getByRole('combobox', { name: 'Проект' })

    await user.click(trigger)
    expect(screen.getByRole('combobox', { name: 'Поиск: проект' })).toHaveFocus()
    await user.tab()
    await waitFor(() => expect(screen.getByRole('button', { name: 'После выбора' })).toHaveFocus())
    expect(screen.queryByRole('combobox', { name: 'Поиск: проект' })).not.toBeInTheDocument()

    await user.click(trigger)
    await user.tab({ shift: true })
    await waitFor(() => expect(screen.getByRole('button', { name: 'До выбора' })).toHaveFocus())
  })
})
