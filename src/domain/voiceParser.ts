import type { Importance } from './models'

export interface ParsedVoiceTask {
  title: string
  startAt?: string
  deadline?: string
  importance?: Importance
  tags: string[]
  projectHint?: string
}

const weekdayMap: Record<string, number> = {
  воскресенье: 0,
  воскресенья: 0,
  понедельник: 1,
  понедельника: 1,
  вторник: 2,
  вторника: 2,
  среду: 3,
  среды: 3,
  четверг: 4,
  четверга: 4,
  пятницу: 5,
  пятницы: 5,
  субботу: 6,
  субботы: 6,
}

const deadlineWordPattern = String.raw`(?:дедлайн(?:а|у|ом|ы|ов|ам|ами|ах)?|срок(?:а|у|ом|и|ов|ам|ами|ах)?)`
const weekdayPattern = `(?:${Object.keys(weekdayMap).join('|')})`

function hasDeadlineMarker(value: string) {
  const namedMarker = new RegExp(`(?<![\\p{L}\\p{N}_])${deadlineWordPattern}(?![\\p{L}\\p{N}_])`, 'iu')
  const beforeSpokenDate = new RegExp(
    `(?<![\\p{L}\\p{N}_])до\\s+(?=(?:сегодня|завтра|послезавтра|${weekdayPattern}|\\d{1,2}(?::\\d{2})?)(?![\\p{L}\\p{N}_]))`,
    'iu',
  )
  return namedMarker.test(value) || beforeSpokenDate.test(value)
}

export function parseVoiceTask(transcript: string, now = new Date()): ParsedVoiceTask {
  const normalized = transcript.trim().replace(/\s+/g, ' ')
  const tags = [...normalized.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((match) => match[1].toLowerCase())
  const importance: Importance | undefined =
    /(?<![\p{L}\p{N}_])(важн(?:о|ая|ый|ое)|высок(?:ий|ая)\s+приоритет)(?![\p{L}\p{N}_])/iu.test(normalized) ? 'high' : undefined
  const projectBoundaryPattern = `(?:сегодня|завтра|послезавтра|(?:в|во|к|до)\\s+(?:\\d|${weekdayPattern})|${deadlineWordPattern}|важн|#)`
  const projectMatch = normalized.match(new RegExp(`(?<![\\p{L}\\p{N}_])(?:в\\s+проект(?:е)?|проект)\\s+[«"]?([\\p{L}\\p{N}_ -]+?)[»"]?(?=\\s+${projectBoundaryPattern}|$)`, 'iu'))
  const projectHint = projectMatch?.[1].trim()
  const spokenDateTime = parseSpokenDateTime(normalized, now)
  const isDeadline = hasDeadlineMarker(normalized)
  const startAt = spokenDateTime && !isDeadline ? spokenDateTime : undefined
  const deadline = spokenDateTime && isDeadline ? spokenDateTime : undefined

  let title = normalized
    .replace(/#([\p{L}\p{N}_-]+)/gu, '')
    .replace(/(?<![\p{L}\p{N}_])(важн(?:о|ая|ый|ое)|высок(?:ий|ая)\s+приоритет)(?![\p{L}\p{N}_])/giu, '')
    .replace(/(?<![\p{L}\p{N}_])(?:сегодня|завтра|послезавтра)(?![\p{L}\p{N}_])/giu, '')
    .replace(/(?<![\p{L}\p{N}_])(?:в|к|до)\s+\d{1,2}(?::\d{2})?(?![\p{L}\p{N}_])/giu, '')
    .replace(new RegExp(`(?<![\\p{L}\\p{N}_])${deadlineWordPattern}(?![\\p{L}\\p{N}_])`, 'giu'), '')

  if (projectMatch) title = title.replace(projectMatch[0], '')
  for (const weekday of Object.keys(weekdayMap)) {
    title = title.replace(new RegExp(`(?<![\\p{L}\\p{N}_])(?:в\\s+)?${weekday}(?![\\p{L}\\p{N}_])`, 'iu'), '')
  }
  title = title
    .replace(/(?<![\p{L}\p{N}_])(?:в|во|на|к|до)(?![\p{L}\p{N}_])\s*$/iu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,;:—–-]+|[,;:—–-]+$/g, '')
    .trim()

  return {
    title: title || normalized,
    startAt,
    deadline,
    importance,
    tags: [...new Set(tags)],
    projectHint,
  }
}

function parseSpokenDateTime(value: string, now: Date): string | undefined {
  const target = new Date(now)
  target.setSeconds(0, 0)
  let hasDate = false

  if (/(?<![\p{L}\p{N}_])послезавтра(?![\p{L}\p{N}_])/iu.test(value)) {
    target.setDate(target.getDate() + 2)
    hasDate = true
  } else if (/(?<![\p{L}\p{N}_])завтра(?![\p{L}\p{N}_])/iu.test(value)) {
    target.setDate(target.getDate() + 1)
    hasDate = true
  } else if (/(?<![\p{L}\p{N}_])сегодня(?![\p{L}\p{N}_])/iu.test(value)) {
    hasDate = true
  } else {
    const weekdayEntry = Object.entries(weekdayMap).find(([name]) =>
      new RegExp(`(?<![\\p{L}\\p{N}_])${name}(?![\\p{L}\\p{N}_])`, 'iu').test(value),
    )
    if (weekdayEntry) {
      const daysAhead = (weekdayEntry[1] - target.getDay() + 7) % 7 || 7
      target.setDate(target.getDate() + daysAhead)
      hasDate = true
    }
  }

  const timeMatch = value.match(/(?<![\p{L}\p{N}_])(?:в|к|до)\s+(\d{1,2})(?::(\d{2}))?(?![\p{L}\p{N}_])/iu)
  if (timeMatch) {
    const hours = Math.min(23, Number(timeMatch[1]))
    const minutes = Math.min(59, Number(timeMatch[2] ?? 0))
    target.setHours(hours, minutes, 0, 0)
  } else if (hasDate) {
    target.setHours(18, 0, 0, 0)
  }

  return hasDate || timeMatch ? target.toISOString() : undefined
}
