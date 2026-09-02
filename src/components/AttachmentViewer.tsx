import { useLayoutEffect, useRef, useState } from 'react'
import { Download, ExternalLink, File, Minus, Plus, X } from 'lucide-react'
import type { Attachment } from '../domain/models'
import { safeAttachmentDataUrl } from '../domain/attachments'
import {
  decodeBase64DataUrl,
  isNativeAndroidFileSave,
  openUserFile,
  saveUserFile,
  UserFileSaveError,
} from '../core/files/UserFileSaver'
import { trapTabKey } from './focusTrap'
import './attachment-viewer.css'

export function AttachmentViewer({ attachment, onClose }: { attachment: Attachment; onClose(): void }) {
  const [zoom, setZoom] = useState(1)
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState(false)
  const [saveNotice, setSaveNotice] = useState<{ tone: 'neutral' | 'success' | 'error'; message: string }>()
  const closeRef = useRef<HTMLButtonElement>(null)
  const viewerRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)
  const dataUrl = safeAttachmentDataUrl(attachment.dataUrl, attachment.type)
  const nativeFileSave = isNativeAndroidFileSave()
  const canPreviewImage = attachment.type.startsWith('image/') && dataUrl
  const textPreview = attachment.type === 'text/plain' && dataUrl ? decodeTextDataUrl(dataUrl) : undefined
  const canEmbedPdf = !nativeFileSave && dataUrl && attachment.type === 'application/pdf'

  const saveAttachment = async () => {
    if (!dataUrl || saving || opening) return
    setSaving(true)
    setSaveNotice(undefined)
    try {
      const result = await saveUserFile({
        fileName: attachment.name,
        mimeType: attachment.type,
        bytes: decodeBase64DataUrl(dataUrl),
      })
      setSaveNotice(result.status === 'saved'
        ? { tone: 'success', message: 'Файл сохранён' }
        : { tone: 'neutral', message: 'Сохранение отменено' })
    } catch (error) {
      setSaveNotice({
        tone: 'error',
        message: error instanceof UserFileSaveError ? error.message : 'Не удалось сохранить файл',
      })
    } finally {
      setSaving(false)
    }
  }

  const openAttachment = async () => {
    if (!dataUrl || saving || opening || attachment.type !== 'application/pdf') return
    setOpening(true)
    setSaveNotice(undefined)
    try {
      await openUserFile({
        fileName: attachment.name,
        mimeType: attachment.type,
        bytes: decodeBase64DataUrl(dataUrl),
      })
      setSaveNotice({ tone: 'success', message: 'PDF открыт во внешнем приложении' })
    } catch (error) {
      setSaveNotice({
        tone: 'error',
        message: error instanceof UserFileSaveError ? error.message : 'Не удалось открыть PDF',
      })
    } finally {
      setOpening(false)
    }
  }

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
          {dataUrl && nativeFileSave && (
            <button
              type="button"
              className="icon-button"
              disabled={saving || opening}
              onClick={() => void saveAttachment()}
              aria-label={`Скачать ${attachment.name}`}
            >
              <Download size={18} />
            </button>
          )}
          {dataUrl && !nativeFileSave && (
            <a className="icon-button" href={dataUrl} download={attachment.name} aria-label={`Скачать ${attachment.name}`}>
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
        {saveNotice && (
          <p
            className={`attachment-viewer__save-status attachment-viewer__save-status--${saveNotice.tone}`}
            role={saveNotice.tone === 'error' ? 'alert' : 'status'}
          >
            {saveNotice.message}
          </p>
        )}
        <div className="attachment-viewer__content">
          {canPreviewImage ? (
            <img src={dataUrl} alt={attachment.name} style={{ transform: `scale(${zoom})` }} />
          ) : textPreview !== undefined ? (
            <pre>{textPreview}</pre>
          ) : canEmbedPdf ? (
            <iframe src={dataUrl} title={`Просмотр ${attachment.name}`} sandbox="" tabIndex={-1} />
          ) : (
            <div className="attachment-viewer__empty">
              <File size={38} />
              <strong>Предпросмотр для этого типа недоступен</strong>
              <p>Файл можно сохранить и открыть в подходящем приложении.</p>
              {dataUrl && nativeFileSave && attachment.type === 'application/pdf' && (
                <div className="attachment-viewer__native-actions">
                  <button type="button" className="button button--primary" disabled={saving || opening} onClick={() => void openAttachment()}>
                    <ExternalLink size={17} /> {opening ? 'Открываем…' : 'Открыть PDF'}
                  </button>
                  <button type="button" className="button button--ghost" disabled={saving || opening} onClick={() => void saveAttachment()}>
                    <Download size={17} /> {saving ? 'Сохраняем…' : 'Сохранить файл'}
                  </button>
                </div>
              )}
              {dataUrl && nativeFileSave && attachment.type !== 'application/pdf' && (
                <button type="button" className="button button--primary" disabled={saving || opening} onClick={() => void saveAttachment()}>
                  <Download size={17} /> {saving ? 'Сохраняем…' : 'Сохранить файл'}
                </button>
              )}
              {dataUrl && !nativeFileSave && (
                <a className="button button--primary" href={dataUrl} download={attachment.name}>
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

function decodeTextDataUrl(dataUrl: string): string | undefined {
  try {
    const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}
