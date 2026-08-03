import { describe, expect, it, vi } from 'vitest'
import { GoogleDriveAdapter } from './GoogleDriveAdapter'
import { SyncProviderError } from './SyncAdapter'

const remoteFile = {
  id: 'remote-id',
  name: 'focus-flow-data.json',
  modifiedTime: '2026-08-03T10:00:00.000Z',
  version: '7',
  size: '512',
}

describe('GoogleDriveAdapter', () => {
  it('finds the newest appDataFolder snapshot and exposes its revision', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ files: [remoteFile] }), { status: 200 }))
    const adapter = new GoogleDriveAdapter('token', fetcher)

    await expect(adapter.head()).resolves.toEqual({
      id: 'remote-id',
      revision: '7',
      modifiedAt: remoteFile.modifiedTime,
      size: 512,
    })
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/spaces=appDataFolder.*orderBy=modifiedTime%20desc/),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }),
    )
  })

  it('downloads and parses the existing remote snapshot', async () => {
    const payload = { format: 'focus-flow', formatVersion: 1, data: { tasks: [] } }
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
    const adapter = new GoogleDriveAdapter('token', fetcher)

    await expect(adapter.download({ id: 'remote-id', revision: '7' })).resolves.toEqual({
      head: { id: 'remote-id', revision: '7' },
      payload,
    })
    expect(fetcher.mock.calls[0][0]).toContain('/drive/v3/files/remote-id?alt=media')
  })

  it('creates a JSON snapshot in appDataFolder when no remote file exists', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(remoteFile), { status: 200 }))
    const adapter = new GoogleDriveAdapter('token', fetcher)

    await expect(adapter.upload({ format: 'focus-flow' })).resolves.toMatchObject({ id: 'remote-id', revision: '7' })
    expect(fetcher.mock.calls[1][0]).toContain('upload/drive/v3/files?uploadType=multipart')
    expect(fetcher.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'POST' }))
    expect(String(fetcher.mock.calls[1][1]?.body)).toContain('appDataFolder')
  })

  it('updates an existing snapshot only when the expected revision still matches', async () => {
    const updated = { ...remoteFile, version: '8', modifiedTime: '2026-08-03T10:01:00.000Z' }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [remoteFile] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }))
    const adapter = new GoogleDriveAdapter('token', fetcher)

    await expect(adapter.upload({ data: true }, { expectedRevision: '7' })).resolves.toMatchObject({ revision: '8' })
    expect(fetcher.mock.calls[1][0]).toContain('/files/remote-id?uploadType=media')
    expect(fetcher.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'PATCH' }))
  })

  it('refuses to overwrite a remote snapshot whose revision changed', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ files: [remoteFile] }), { status: 200 }))
    const adapter = new GoogleDriveAdapter('token', fetcher)

    await expect(adapter.upload({}, { expectedRevision: '6' })).rejects.toMatchObject({ code: 'conflict' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    [401, 'auth-required'],
    [403, 'forbidden'],
    [429, 'rate-limited'],
  ] as const)('classifies Drive API status %s as %s', async (status, code) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status }))
    const adapter = new GoogleDriveAdapter('invalid', fetcher)
    const error = await adapter.head().catch((caught) => caught)
    expect(error).toBeInstanceOf(SyncProviderError)
    expect(error).toMatchObject({ code })
  })
})
