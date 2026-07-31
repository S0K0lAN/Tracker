import { useLayoutEffect, useRef, useState } from 'react'
import { Download, ExternalLink, File, Minus, Plus, X } from 'lucide-react'
import type { Attachment } from '../domain/models'
import { trapTabKey } from './focusTrap'
import './attachment-viewer.css'

export function AttachmentViewer({ attachment, onClose }: { attachment: Attachment; onClose(): void }) {
  const [zoom, setZoom] = useState(1)
  const closeRef = useRef<HTMLButtonElement>(null)
  const viewerRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)
  const canPreviewImage = attachment.type.startsWith('image/') && attachment.dataUrl
  const canEmbed = attachment.dataUrl && (attachment.type === 'application/pdf' || attachment.type.startsWith('text/'))

  useLayoutEffect(() => {
    closeRef.current?.focus()
    return () => {
      requestAnimationFrame(() => {
        if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
      })
    }
  }, [])

  return (
    <div className="attachment-viewer__backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={viewerRef}
        className="attachment-viewer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="attachment-viewer-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
            return
          }
          trapTabKey(event, viewerRef.current)
        }}
      >
        <header>
          <span className="attachment-viewer__file-icon"><File size={18} /></span>
          <div>
            <h2 id="attachment-viewer-title">{attachment.name}</h2>
            <small>{formatFileSize(attachment.size)} · {attachment.type || 'тип не определён'}</small>
          </div>
          {attachment.dataUrl && (
            <a className="icon-button" href={attachment.dataUrl} download={attachment.name} aria-label={`Скачать ${attachment.name}`}>
              <Download size={18} />
            </a>
          )}
          {canPreviewImage && (
            <span className="attachment-viewer__zoom">
              <button type="button" className="icon-button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} aria-label="Уменьшить изображение"><Minus size={16} /></button>
              <small>{Math.round(zoom * 100)}%</small>
              <button type="button" className="icon-button" onClick={() => setZoom((value) => Math.min(3, value + 0.25))} aria-label="Увеличить изображение"><Plus size={16} /></button>
            </span>
          )}
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Закрыть просмотр вложения"><X size={19} /></button>
        </header>
        <div className="attachment-viewer__content">
          {canPreviewImage ? (
            <img src={attachment.dataUrl} alt={attachment.name} style={{ transform: `scale(${zoom})` }} />
          ) : canEmbed ? (
            <iframe src={attachment.dataUrl} title={`Просмотр ${attachment.name}`} tabIndex={-1} />
          ) : (
            <div className="attachment-viewer__empty">
              <File size={38} />
              <strong>Предпросмотр для этого типа недоступен</strong>
              <p>Файл можно сохранить и открыть в подходящем приложении.</p>
              {attachment.dataUrl && (
                <a className="button button--primary" href={attachment.dataUrl} download={attachment.name}>
                  <ExternalLink size={17} /> Открыть файл
                </a>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`
  return `${(size / 1024 / 1024).toFixed(1)} МБ`
}
