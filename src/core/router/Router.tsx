import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react'

interface RouterValue {
  path: string
  search: string
  navigate(path: string, options?: { replace?: boolean }): void
}

const RouterContext = createContext<RouterValue | null>(null)

export function RouterProvider({ children, initialPath }: { children: ReactNode; initialPath?: string }) {
  const [location, setLocation] = useState(initialPath ?? `${window.location.pathname}${window.location.search}`)
  const queryIndex = location.indexOf('?')
  const path = queryIndex >= 0 ? location.slice(0, queryIndex) : location
  const search = queryIndex >= 0 ? location.slice(queryIndex) : ''

  const navigate = useCallback((nextPath: string, options?: { replace?: boolean }) => {
    if (!initialPath) {
      if (options?.replace) window.history.replaceState(null, '', nextPath)
      else window.history.pushState(null, '', nextPath)
    }
    setLocation(nextPath)
  }, [initialPath])

  useEffect(() => {
    if (initialPath) return
    const onPopState = () => setLocation(`${window.location.pathname}${window.location.search}`)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [initialPath])

  const value = useMemo<RouterValue>(
    () => ({
      path,
      search,
      navigate,
    }),
    [navigate, path, search],
  )

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter() {
  const value = useContext(RouterContext)
  if (!value) throw new Error('useRouter must be used inside RouterProvider')
  return value
}

export function NavLink({
  to,
  className,
  children,
  onClick,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className'> & {
  to: string
  className?: string | ((state: { isActive: boolean }) => string)
  children: ReactNode
}) {
  const { path, navigate } = useRouter()
  const isActive = path === to || (to !== '/' && path.startsWith(`${to}/`))
  const resolvedClassName = typeof className === 'function' ? className({ isActive }) : className

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }

  return (
    <a {...props} href={to} className={resolvedClassName} aria-current={isActive ? 'page' : undefined} onClick={handleClick}>
      {children}
    </a>
  )
}
