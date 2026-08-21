const PROJECT_ROUTE_SEGMENT_PREFIX = 'p-'

export interface ProjectRouteMatch {
  projectId: string | null
}

export function projectPath(projectId: string) {
  if (!projectId) throw new Error('Project id must not be empty')
  return `/projects/${PROJECT_ROUTE_SEGMENT_PREFIX}${encodeURIComponent(projectId)}`
}

export function matchProjectRoute(path: string): ProjectRouteMatch | undefined {
  const match = /^\/projects\/([^/]+)$/.exec(path)
  if (!match) return undefined

  const segment = match[1]
  if (!segment.startsWith(PROJECT_ROUTE_SEGMENT_PREFIX)) return { projectId: null }

  const encodedId = segment.slice(PROJECT_ROUTE_SEGMENT_PREFIX.length)
  if (!encodedId) return { projectId: null }

  try {
    const projectId = decodeURIComponent(encodedId)
    return {
      projectId: projectId && encodeURIComponent(projectId) === encodedId ? projectId : null,
    }
  } catch {
    return { projectId: null }
  }
}
