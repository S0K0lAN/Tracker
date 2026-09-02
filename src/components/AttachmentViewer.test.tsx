import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fileSaverMocks = vi.hoisted(() => ({
  nativeAndroid: false,
  openUserFile: vi.fn(),
  saveUserFile: vi.fn(),
}))

vi.mock('../core/files/UserFileSaver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/files/UserFileSaver')>()
  return {
    ...actual,
    isNativeAndroidFileSave: () => fileSaverMocks.nativeAndroid,
    openUserFile: fileSaverMocks.openUserFile,
    saveUserFile: fileSaverMocks.saveUserFile,
  }
})

import { AttachmentViewer } from './AttachmentViewer'

afterEach(() => {
  fileSaverMocks.nativeAndroid = false
  fileSaverMocks.openUserFile.mockReset()
  fileSaverMocks.saveUserFile.mockReset()
})

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

  it('uses the Android document picker for a PDF instead of promising an embedded preview', async () => {
    const user = userEvent.setup()
    fileSaverMocks.nativeAndroid = true
    fileSaverMocks.openUserFile.mockResolvedValue({ status: 'opened' })
    fileSaverMocks.saveUserFile.mockResolvedValue({ status: 'saved', destination: 'native' })
    render(
      <AttachmentViewer
        attachment={{
          id: 'android-pdf',
          name: 'brief.pdf',
          type: 'application/pdf',
          size: 8,
          dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
        }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByTitle('Просмотр brief.pdf')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть PDF' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Сохранить файл' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Открыть PDF' }))

    await waitFor(() => expect(fileSaverMocks.openUserFile).toHaveBeenCalledTimes(1))
    const openPayload = fileSaverMocks.openUserFile.mock.calls[0][0]
    expect(openPayload).toMatchObject({ fileName: 'brief.pdf', mimeType: 'application/pdf' })
    expect([...openPayload.bytes]).toEqual([37, 80, 68, 70, 45, 49, 46, 52])
    expect(screen.getByRole('status')).toHaveTextContent('PDF открыт во внешнем приложении')

    await user.click(screen.getByRole('button', { name: 'Скачать brief.pdf' }))

    await waitFor(() => expect(fileSaverMocks.saveUserFile).toHaveBeenCalledTimes(1))
    const payload = fileSaverMocks.saveUserFile.mock.calls[0][0]
    expect(payload).toMatchObject({ fileName: 'brief.pdf', mimeType: 'application/pdf' })
    expect([...payload.bytes]).toEqual([37, 80, 68, 70, 45, 49, 46, 52])
    expect(screen.getByRole('status')).toHaveTextContent('Файл сохранён')
  })
})
