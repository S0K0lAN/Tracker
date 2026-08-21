import { useMemo, useSyncExternalStore } from 'react'

let snapshot = Date.now()
let timer: number | undefined
const subscribers = new Set<() => void>()

function updateSnapshot() {
  const next = Date.now()
  if (next === snapshot) return
  snapshot = next
  subscribers.forEach((subscriber) => subscriber())
}

function scheduleMinuteTick() {
  if (timer !== undefined) window.clearTimeout(timer)
  const delay = 60_000 - (Date.now() % 60_000) + 10
  timer = window.setTimeout(() => {
    updateSnapshot()
    scheduleMinuteTick()
  }, delay)
}

function subscribe(subscriber: () => void) {
  subscribers.add(subscriber)
  if (subscribers.size === 1) {
    snapshot = Date.now()
    document.addEventListener('visibilitychange', updateSnapshot)
    window.addEventListener('focus', updateSnapshot)
    scheduleMinuteTick()
  }

  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size > 0) return
    document.removeEventListener('visibilitychange', updateSnapshot)
    window.removeEventListener('focus', updateSnapshot)
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
  }
}

function getSnapshot() {
  return snapshot
}

export function useNow() {
  const timestamp = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => new Date(timestamp), [timestamp])
}
