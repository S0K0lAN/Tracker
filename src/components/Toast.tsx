import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'

export function Toast({
  tone = 'info',
  children,
  onClose,
}: {
  tone?: 'success' | 'error' | 'info'
  children: React.ReactNode
  onClose?: () => void
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? CircleAlert : Info
  return (
    <div className={`toast toast--${tone}`} role="status">
      <Icon size={18} />
      <span>{children}</span>
      {onClose && (
        <button className="icon-button" onClick={onClose} aria-label="Закрыть">
          <X size={16} />
        </button>
      )}
    </div>
  )
}
