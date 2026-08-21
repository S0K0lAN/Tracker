import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PomodoroTimer } from './PomodoroTimer'

const app = vi.hoisted(() => ({
  addFocusMinutes: vi.fn(),
  updatePomodoro: vi.fn(),
  state: {
    tasks: [{ id: 'task-1', title: 'Не начислять ложные минуты' }],
    pomodoro: {
      taskId: 'task-1',
      mode: 'focus' as const,
      durationSeconds: 25 * 60,
      remainingSeconds: 25 * 60,
      runningSince: 'not-a-date',
      completedFocusSessions: 0,
    },
  },
}))

vi.mock('../state/AppContext', () => ({
  useApp: () => app,
}))

describe('PomodoroTimer corrupted runtime state', () => {
  beforeEach(() => {
    app.addFocusMinutes.mockClear()
    app.updatePomodoro.mockClear()
    app.state.pomodoro.runningSince = 'not-a-date'
    app.state.pomodoro.remainingSeconds = 25 * 60
  })

  it('treats an invalid runningSince as paused and never awards a completed focus session', () => {
    render(<PomodoroTimer />)

    expect(screen.getByText('25:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Запустить таймер' })).toBeInTheDocument()
    expect(app.addFocusMinutes).not.toHaveBeenCalled()
    expect(app.updatePomodoro).not.toHaveBeenCalled()
  })
})
