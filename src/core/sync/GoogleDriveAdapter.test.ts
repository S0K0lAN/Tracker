import { describe, expect, it, vi } from 'vitest'
import { createSeedState } from '../../domain/seed'
import { GoogleDriveAdapter } from './GoogleDriveAdapter'

describe('GoogleDriveAdapter', () => {
  it('uses appDataFolder and drive v3 for connection checks', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ files: [] }), { status: 200 }))
    const adapter = new GoogleDriveAdapter('token', fetcher)

    await expect(adapter.testConnection()).resolves.toBe(true)
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('spaces=appDataFolder'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }),
    )
  })

  it('creates a JSON snapshot in appDataFolder when no remote file exists', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'remote-id', name: 'focus-flow-data.json' }), { status: 200 }))
    const adapter = new GoogleDriveAdapter('token', fetcher)

    const result = await adapter.sync(createSeedState())

    expect(result.remoteId).toBe('remote-id')
    expect(fetcher.mock.calls[1][0]).toContain('upload/drive/v3/files?uploadType=multipart')
    expect(fetcher.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'POST' }))
    expect(String(fetcher.mock.calls[1][1]?.body)).toContain('appDataFolder')
  })

  it('updates an existing remote snapshot without creating a duplicate', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ id: 'existing-id', name: 'focus-flow-data.json' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const adapter = new GoogleDriveAdapter('token', fetcher)

    const result = await adapter.sync(createSeedState())

    expect(result.remoteId).toBe('existing-id')
    expect(fetcher.mock.calls[1][0]).toContain('/files/existing-id?uploadType=media')
    expect(fetcher.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'PATCH' }))
  })

  it('surfaces Drive API errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }))
    const adapter = new GoogleDriveAdapter('invalid', fetcher)
    await expect(adapter.sync(createSeedState())).rejects.toThrow('Google Drive: 401')
  })
})
