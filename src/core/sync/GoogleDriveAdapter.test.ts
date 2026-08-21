import { describe, expect, it, vi } from 'vitest'
import { GoogleDriveAdapter, MAX_GOOGLE_DRIVE_SNAPSHOT_BYTES } from './GoogleDriveAdapter'
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

  it('rejects oversized Drive metadata before downloading the body', async () => {
    const fetcher = vi.fn()
    const adapter = new GoogleDriveAdapter('token', fetcher)

    await expect(adapter.download({
      id: 'remote-id',
      revision: '7',
      size: MAX_GOOGLE_DRIVE_SNAPSHOT_BYTES + 1,
    })).rejects.toMatchObject({ code: 'invalid-remote' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects an oversized Content-Length before reading or parsing the body', async () => {
    const text = vi.fn().mockResolvedValue('{}')
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Length': String(MAX_GOOGLE_DRIVE_SNAPSHOT_BYTES + 1) }),
      body: null,
      text,
    } as unknown as Response
    const fetcher = vi.fn().mockResolvedValue(response)
    const adapter = new GoogleDriveAdapter('token', fetcher)

    await expect(adapter.download({ id: 'remote-id', revision: '7' })).rejects.toMatchObject({
      code: 'invalid-remote',
    })
    expect(text).not.toHaveBeenCalled()
  })

  it('bounds streamed response bytes before attempting JSON parsing', async () => {
    const oversizedBody = new Uint8Array(MAX_GOOGLE_DRIVE_SNAPSHOT_BYTES + 1)
    const fetcher = vi.fn().mockResolvedValue(new Response(oversizedBody, { status: 200 }))
    const adapter = new GoogleDriveAdapter('token', fetcher)

    await expect(adapter.download({ id: 'remote-id', revision: '7' })).rejects.toMatchObject({
      code: 'invalid-remote',
    })
  })

  it('supports a text-only Response fallback while still validating the payload', async () => {
    const payload = { format: 'focus-flow', formatVersion: 1, data: { tasks: [] } }
    const text = vi.fn().mockResolvedValue(JSON.stringify(payload))
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null,
      text,
    } as unknown as Response
    const fetcher = vi.fn().mockResolvedValue(response)
    const adapter = new GoogleDriveAdapter('token', fetcher)

    await expect(adapter.download({ id: 'remote-id', revision: '7' })).resolves.toEqual({
      head: { id: 'remote-id', revision: '7' },
      payload,
    })
    expect(text).toHaveBeenCalledOnce()
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

  it('accepts a serialized upload envelope exactly at the 10 MiB UTF-8 boundary', async () => {
    const payload = 'я'.repeat((MAX_GOOGLE_DRIVE_SNAPSHOT_BYTES - 2) / 2)
    expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBe(MAX_GOOGLE_DRIVE_SNAPSHOT_BYTES)
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(remoteFile), { status: 200 }))
    const adapter = new GoogleDriveAdapter('token', fetcher)

    await expect(adapter.upload(payload)).resolves.toMatchObject({ id: 'remote-id', revision: '7' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['create', undefined],
    ['update', '7'],
  ] as const)('rejects an oversized multibyte %s upload before any network request', async (_operation, expectedRevision) => {
    const payload = 'я'.repeat(MAX_GOOGLE_DRIVE_SNAPSHOT_BYTES / 2)
    expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBe(MAX_GOOGLE_DRIVE_SNAPSHOT_BYTES + 2)
    const fetcher = vi.fn()
    const adapter = new GoogleDriveAdapter('token', fetcher)

    await expect(adapter.upload(payload, { expectedRevision })).rejects.toMatchObject({
      code: 'invalid-remote',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('refuses to create when a remote snapshot appeared after the absence check', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ files: [remoteFile] }), { status: 200 }))
    const adapter = new GoogleDriveAdapter('token', fetcher)

    await expect(adapter.upload({ data: 'local' }, { expectedRevision: null })).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('refuses to update when the expected remote snapshot no longer exists', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ files: [] }), { status: 200 }))
    const adapter = new GoogleDriveAdapter('token', fetcher)

    await expect(adapter.upload({ data: 'local' }, { expectedRevision: '7' })).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
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
