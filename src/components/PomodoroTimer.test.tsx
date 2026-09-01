import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PomodoroTimer } from './PomodoroTimer'

const app = vi.hoisted(() => ({
  addFocusMinutes: vi.fn(),
  updatePomodoro: vi.fn(),
  state: {
    tasks: [{ id: 'task-1', title: 'Не начислять ложные минуты' }],
    pomodoro: {
      taskId: 'task-1',
      mode: 'focus' as 'focus' | 'short-break' | 'long-break',
      durationSeconds: 25 * 60,
      remainingSeconds: 25 * 60,
      runningSince: 'not-a-date' as string | undefined,
      completedFocusSessions: 0,
    },
  },
}))

vi.mock('../state/AppContext', () => ({
  useApp: () => app,
}))

describe('PomodoroTimer', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    Object.assign(app.state.pomodoro, {
      taskId: 'task-1',
      mode: 'focus',
      durationSeconds: 25 * 60,
      remainingSeconds: 25 * 60,
      runningSince: 'not-a-date',
      completedFocusSessions: 0,
    })
  })

  afterEach(() => vi.useRealTimers())

  it('treats an invalid runningSince as paused and never awards a completed focus session', () => {
    render(<PomodoroTimer />)

    expect(screen.getByText('25:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Запустить таймер' })).toBeInTheDocument()
    expect(app.addFocusMinutes).not.toHaveBeenCalled()
    expect(app.updatePomodoro).not.toHaveBeenCalled()
  })

  it('awards focus minutes and switches a completed focus cycle to a short break', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T09:00:00.000Z'))
    Object.assign(app.state.pomodoro, {
      durationSeconds: 60,
      remainingSeconds: 60,
      runningSince: new Date().toISOString(),
      completedFocusSessions: 0,
    })
    render(<PomodoroTimer />)

    act(() => vi.advanceTimersByTime(60_000))

    expect(app.addFocusMinutes).toHaveBeenCalledTimes(1)
    expect(app.addFocusMinutes).toHaveBeenCalledWith('task-1', 1)
    expect(app.updatePomodoro).toHaveBeenCalledWith({
      mode: 'short-break',
      durationSeconds: 5 * 60,
      remainingSeconds: 5 * 60,
      runningSince: undefined,
      completedFocusSessions: 1,
    })
  })

  it('switches every fourth completed focus cycle to a long break', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T09:00:00.000Z'))
    Object.assign(app.state.pomodoro, {
      durationSeconds: 60,
      remainingSeconds: 60,
      runningSince: new Date().toISOString(),
      completedFocusSessions: 3,
    })
    render(<PomodoroTimer />)

    act(() => vi.advanceTimersByTime(60_000))

    expect(app.addFocusMinutes).toHaveBeenCalledWith('task-1', 1)
    expect(app.updatePomodoro).toHaveBeenCalledWith({
      mode: 'long-break',
      durationSeconds: 15 * 60,
      remainingSeconds: 15 * 60,
      runningSince: undefined,
      completedFocusSessions: 4,
    })
  })

  it('returns to focus without awarding minutes after a completed break', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T09:00:00.000Z'))
    Object.assign(app.state.pomodoro, {
      mode: 'short-break',
      durationSeconds: 5,
      remainingSeconds: 5,
      runningSince: new Date().toISOString(),
      completedFocusSessions: 1,
    })
    render(<PomodoroTimer />)

    act(() => vi.advanceTimersByTime(5_000))

    expect(app.addFocusMinutes).not.toHaveBeenCalled()
    expect(app.updatePomodoro).toHaveBeenCalledWith({
      mode: 'focus',
      durationSeconds: 25 * 60,
      remainingSeconds: 25 * 60,
      runningSince: undefined,
    })
  })
})
