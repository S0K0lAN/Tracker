import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AttachmentViewer } from './AttachmentViewer'

describe('AttachmentViewer URL safety', () => {
  it('never exposes an executable imported URL as a link or embedded document', () => {
    render(
      <AttachmentViewer
        attachment={{
          id: 'unsafe',
          name: 'payload.bin',
          type: 'application/octet-stream',
          size: 12,
          dataUrl: 'javascript:document.body.dataset.pwned=1',
        }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Просмотр payload.bin')).not.toBeInTheDocument()
    expect(screen.getByText('Предпросмотр для этого типа недоступен')).toBeVisible()
  })

  it('keeps a matching base64 data URL downloadable', () => {
    render(
      <AttachmentViewer
        attachment={{
          id: 'safe',
          name: 'note.txt',
          type: 'text/plain',
          size: 5,
          dataUrl: 'data:text/plain;base64,aGVsbG8=',
        }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('link', { name: 'Скачать note.txt' })).toHaveAttribute('href', 'data:text/plain;base64,aGVsbG8=')
    expect(screen.getByText('hello')).toBeVisible()
    expect(screen.queryByTitle('Просмотр note.txt')).not.toBeInTheDocument()
  })

  it('sandboxes a validated PDF preview', () => {
    render(
      <AttachmentViewer
        attachment={{
          id: 'pdf',
          name: 'brief.pdf',
          type: 'application/pdf',
          size: 8,
          dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
        }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByTitle('Просмотр brief.pdf')).toHaveAttribute('sandbox')
  })
})
