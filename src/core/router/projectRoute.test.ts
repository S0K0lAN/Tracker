import { describe, expect, it } from 'vitest'
import { matchProjectRoute, projectPath } from './projectRoute'

describe('project route codec', () => {
  it('keeps dot-segment project ids inside the project route', () => {
    expect(projectPath('..')).toBe('/projects/p-..')
    expect(matchProjectRoute(projectPath('..'))).toEqual({ projectId: '..' })
  })

  it('round-trips reserved path characters without collisions', () => {
    const projectIds = ['.', '/', 'a/b', 'a%2Fb', 'p-work', ' вопрос?# ']
    expect(new Set(projectIds.map(projectPath)).size).toBe(projectIds.length)
    for (const projectId of projectIds) {
      expect(matchProjectRoute(projectPath(projectId))).toEqual({ projectId })
    }
  })

  it('recognizes malformed detail paths without treating them as project ids', () => {
    expect(matchProjectRoute('/projects')).toBeUndefined()
    expect(matchProjectRoute('/projects/work')).toEqual({ projectId: null })
    expect(matchProjectRoute('/projects/p-%77ork')).toEqual({ projectId: null })
    expect(matchProjectRoute('/projects/p-%E0%A4%A')).toEqual({ projectId: null })
  })
})
