import { useEffect, useMemo, useState } from 'react'
import { Coffee, Pause, Play, RotateCcw, Timer, X } from 'lucide-react'
import type { PomodoroState } from '../domain/models'
import { useApp } from '../state/AppContext'
import './pomodoro-timer.css'

const durations: Record<PomodoroState['mode'], number> = {
  focus: 25 * 60,
  'short-break': 5 * 60,
  'long-break': 15 * 60,
}

export function PomodoroTimer() {
  const { state, updatePomodoro, addFocusMinutes } = useApp()
  const [clock, setClock] = useState(Date.now())
  const timer = state.pomodoro
  const task = state.tasks.find((item) => item.id === timer.taskId)
  const remaining = useMemo(() => {
    if (!timer.runningSince) return timer.remainingSeconds
    const elapsed = Math.floor((clock - new Date(timer.runningSince).getTime()) / 1000)
    return Math.max(0, timer.remainingSeconds - elapsed)
  }, [clock, timer.remainingSeconds, timer.runningSince])

  useEffect(() => {
    if (!timer.runningSince) return
    const interval = window.setInterval(() => setClock(Date.now()), 500)
    return () => window.clearInterval(interval)
  }, [timer.runningSince])

  useEffect(() => {
    if (!timer.taskId || !timer.runningSince || remaining > 0) return
    if (timer.mode === 'focus') {
      addFocusMinutes(timer.taskId, Math.round(timer.durationSeconds / 60))
      const completedFocusSessions = timer.completedFocusSessions + 1
      const nextMode: PomodoroState['mode'] = completedFocusSessions % 4 === 0 ? 'long-break' : 'short-break'
      updatePomodoro({
        mode: nextMode,
        durationSeconds: durations[nextMode],
        remainingSeconds: durations[nextMode],
        runningSince: undefined,
        completedFocusSessions,
      })
    } else {
      updatePomodoro({
        mode: 'focus',
        durationSeconds: durations.focus,
        remainingSeconds: durations.focus,
        runningSince: undefined,
      })
    }
  }, [addFocusMinutes, remaining, timer, updatePomodoro])

  if (!task || timer.taskId === undefined) return null

  const pause = () => updatePomodoro({ remainingSeconds: remaining, runningSince: undefined })
  const start = () => {
    setClock(Date.now())
    updatePomodoro({ runningSince: new Date().toISOString() })
  }
  const reset = () => updatePomodoro({ remainingSeconds: timer.durationSeconds, runningSince: undefined })
  const setMode = (mode: PomodoroState['mode']) => {
    updatePomodoro({
      mode,
      durationSeconds: durations[mode],
      remainingSeconds: durations[mode],
      runningSince: undefined,
    })
  }
  const close = () => updatePomodoro({ taskId: undefined, runningSince: undefined })
  const progress = 1 - remaining / Math.max(1, timer.durationSeconds)
  const minutes = Math.floor(remaining / 60).toString().padStart(2, '0')
  const seconds = (remaining % 60).toString().padStart(2, '0')

  return (
    <aside className="pomodoro-dock" aria-label="Помодоро-таймер" aria-live="polite">
      <div className="pomodoro-dock__progress" style={{ transform: `scaleX(${progress})` }} />
      <header>
        <span className="pomodoro-dock__icon">{timer.mode === 'focus' ? <Timer size={17} /> : <Coffee size={17} />}</span>
        <div>
          <small>{timer.mode === 'focus' ? 'Фокус' : timer.mode === 'short-break' ? 'Короткий перерыв' : 'Длинный перерыв'}</small>
          <strong title={task.title}>{task.title}</strong>
        </div>
        <button type="button" className="icon-button" onClick={close} aria-label="Закрыть помодоро"><X size={16} /></button>
      </header>
      <div className="pomodoro-dock__body">
        <time dateTime={`PT${remaining}S`}>{minutes}:{seconds}</time>
        <div className="pomodoro-dock__actions">
          <button type="button" className="icon-button" onClick={reset} aria-label="Сбросить таймер"><RotateCcw size={16} /></button>
          <button type="button" className="pomodoro-dock__main" onClick={timer.runningSince ? pause : start} aria-label={timer.runningSince ? 'Поставить таймер на паузу' : 'Запустить таймер'}>
            {timer.runningSince ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
        </div>
      </div>
      <div className="pomodoro-dock__modes" aria-label="Режим таймера">
        <button type="button" className={timer.mode === 'focus' ? 'is-selected' : ''} onClick={() => setMode('focus')}>25</button>
        <button type="button" className={timer.mode === 'short-break' ? 'is-selected' : ''} onClick={() => setMode('short-break')}>5</button>
        <button type="button" className={timer.mode === 'long-break' ? 'is-selected' : ''} onClick={() => setMode('long-break')}>15</button>
        <span>{timer.completedFocusSessions} сессий</span>
      </div>
    </aside>
  )
}

export function startPomodoroForTask(taskId: string, update: (value: Partial<PomodoroState>) => void) {
  update({
    taskId,
    mode: 'focus',
    durationSeconds: durations.focus,
    remainingSeconds: durations.focus,
    runningSince: undefined,
  })
}
