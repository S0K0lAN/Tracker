import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DateTimePicker, formatDateTimeInput, formatNumericDateTimeDraft, parseDateTimeInput } from './DateTimePicker'

describe('manual date input', () => {
  it('parses Russian and ISO formats without rolling invalid dates', () => {
    const reference = new Date(2026, 6, 31, 12)
    expect(parseDateTimeInput('05.08.2026, 18:30', reference, '09:00')).toBe('2026-08-05T18:30')
    expect(parseDateTimeInput('05.08 9:05', reference, '18:00')).toBe('2026-08-05T09:05')
    expect(parseDateTimeInput('2026-08-05', reference, '18:00')).toBe('2026-08-05T18:00')
    expect(parseDateTimeInput('31.02.2026, 12:00', reference)).toBeNull()
    expect(formatDateTimeInput('2026-08-05T18:30')).toBe('05.08.2026, 18:30')
    expect(formatNumericDateTimeDraft('050820261830')).toBe('05.08.2026, 18:30')
    expect(formatNumericDateTimeDraft('2026-08-05')).toBe('2026-08-05')
  })

  it('adds date and time separators while the user types digits', async () => {
    const user = userEvent.setup()
    render(<DateTimePicker label="Начало" value="" onChange={() => undefined} />)
    const input = screen.getByLabelText('Начало')

    await user.type(input, '050820261830')

    expect(input).toHaveValue('05.08.2026, 18:30')
  })

  it('commits manual input and supports quick calendar selection', async () => {
    const user = userEvent.setup()
    function Example() {
      const [value, setValue] = useState('')
      return <><DateTimePicker label="Дедлайн" value={value} onChange={setValue} defaultTime="18:00" /><output>{value}</output></>
    }
    render(<Example />)

    const input = screen.getByLabelText('Дедлайн')
    await user.type(input, '05.08.2026, 18:30')
    await user.tab()
    expect(screen.getByText('2026-08-05T18:30', { selector: 'output' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Открыть календарь дедлайна' }))
    const dialog = screen.getByRole('dialog', { name: 'Выбор даты: Дедлайн' })
    expect(dialog).toBeInTheDocument()
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    await user.click(screen.getByRole('button', { name: 'Завтра' }))
    expect((input as HTMLInputElement).value).toMatch(/^\d{2}\.\d{2}\.\d{4}, 18:00$/)
  })

  it('reports an invalid manual value instead of changing the selected date', async () => {
    const user = userEvent.setup()
    render(<DateTimePicker label="Начало" value="2026-08-05T09:00" onChange={() => undefined} />)
    const input = screen.getByLabelText('Начало')
    await user.clear(input)
    await user.type(input, '31.02.2026, 09:00')
    await user.tab()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Проверьте дату и время')
  })

  it('can lock editing while keeping an explicit clear action available', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DateTimePicker
        label="Дедлайн"
        value="2026-08-05T18:30"
        onChange={onChange}
        disabled
        allowClearWhenDisabled
        hint="Сначала укажите начало"
      />,
    )

    expect(screen.getByLabelText('Дедлайн')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Открыть календарь дедлайна' })).toBeDisabled()
    expect(screen.getByText('Сначала укажите начало')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Очистить дату дедлайна' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('does not crash while the popover time is cleared before being replaced', async () => {
    function Example() {
      const [value, setValue] = useState('2026-08-05T09:00')
      return <><DateTimePicker label="Начало" value={value} onChange={setValue} /><output>{value}</output></>
    }
    render(<Example />)

    fireEvent.click(screen.getByRole('button', { name: 'Открыть календарь начала' }))
    const dialog = screen.getByRole('dialog', { name: 'Выбор даты: Начало' })
    const timeInput = screen.getByLabelText('Время')

    fireEvent.focus(timeInput)
    fireEvent.change(timeInput, { target: { value: '' } })
    expect(dialog).toBeInTheDocument()
    expect(timeInput).toHaveValue('')
    expect(screen.getByText('2026-08-05T09:00', { selector: 'output' })).toBeInTheDocument()
    fireEvent.blur(timeInput)
    expect(timeInput).toHaveValue('09:00')

    fireEvent.change(timeInput, { target: { value: '14:35' } })
    expect(screen.getByText('2026-08-05T14:35', { selector: 'output' })).toBeInTheDocument()
  })
})
