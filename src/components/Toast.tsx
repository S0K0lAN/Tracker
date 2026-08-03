import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'

export function Toast({
  tone = 'info',
  children,
  action,
  onClose,
}: {
  tone?: 'success' | 'error' | 'info'
  children: React.ReactNode
  action?: { label: string; onClick: () => void }
  onClose?: () => void
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? CircleAlert : Info
  return (
    <div className={`toast toast--${tone}`} role="status">
      <Icon size={18} />
      <span>{children}</span>
      {action && <button className="toast__action" onClick={action.onClick}>{action.label}</button>}
      {onClose && (
        <button className="icon-button" onClick={onClose} aria-label="Закрыть">
          <X size={16} />
        </button>
      )}
    </div>
  )
}
