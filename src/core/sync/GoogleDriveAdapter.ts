import {
  SyncProviderError,
  type RemoteHead,
  type RemoteSnapshot,
  type SyncAdapter,
  type SyncProviderDescriptor,
  type UploadOptions,
} from './SyncAdapter'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const FILE_NAME = 'focus-flow-data.json'
export const MAX_GOOGLE_DRIVE_SNAPSHOT_BYTES = 10 * 1024 * 1024

export const googleDriveDescriptor: SyncProviderDescriptor = {
  id: 'google-drive',
  name: 'Google Drive',
  description: 'Скрытая папка приложения в вашем Google Drive',
  connection: 'interactive',
  consistency: 'best-effort',
  privacyNote: 'Focus Flow откроет защищённое окно Google и получит доступ только к своей скрытой папке в Google Drive. Пароль и остальные файлы недоступны приложению.',
  connectLabel: 'Войти через Google',
  resumeLabel: 'Продолжить с Google',
  capabilities: { download: true, upload: true },
}

interface DriveFile {
  id: string
  name: string
  modifiedTime?: string
  version?: string
  size?: string
}

function toRemoteHead(file: DriveFile): RemoteHead {
  return {
    id: file.id,
    revision: String(file.version ?? file.modifiedTime ?? file.id),
    modifiedAt: file.modifiedTime,
    size: file.size ? Number(file.size) : undefined,
  }
}

function invalidRemoteSizeError() {
  return new SyncProviderError('invalid-remote', 'Копия в Google Drive превышает лимит 10 МБ')
}

function invalidUploadError(message: string, cause?: unknown) {
  return new SyncProviderError('invalid-remote', message, cause)
}

function assertAllowedSnapshotSize(size: number | undefined) {
  if (size === undefined) return
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_GOOGLE_DRIVE_SNAPSHOT_BYTES) {
    throw invalidRemoteSizeError()
  }
}

function responseContentLength(response: Response): number | undefined {
  const value = response.headers.get('content-length')
  if (value === null || !/^\d+$/.test(value.trim())) return undefined
  return Number(value)
}

async function responseTextWithinLimit(response: Response): Promise<string> {
  assertAllowedSnapshotSize(responseContentLength(response))
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_GOOGLE_DRIVE_SNAPSHOT_BYTES) {
      throw invalidRemoteSizeError()
    }
    return text
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_GOOGLE_DRIVE_SNAPSHOT_BYTES) {
      void reader.cancel().catch(() => undefined)
      throw invalidRemoteSizeError()
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

function serializeSnapshotWithinLimit(payload: unknown): string {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(payload)
  } catch (error) {
    throw invalidUploadError('Локальная копия не может быть сериализована в JSON', error)
  }
  if (serialized === undefined) {
    throw invalidUploadError('Локальная копия не может быть сериализована в JSON')
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_GOOGLE_DRIVE_SNAPSHOT_BYTES) {
    throw invalidUploadError('Локальная копия превышает лимит Google Drive 10 МБ')
  }
  return serialized
}

function errorForStatus(status: number, operation: string) {
  if (status === 401) return new SyncProviderError('auth-required', 'Требуется повторное подключение Google Drive')
  if (status === 403) return new SyncProviderError('forbidden', 'Google Drive отклонил доступ к данным приложения')
  if (status === 412) return new SyncProviderError('conflict', 'Копия в Google Drive изменилась')
  if (status === 429) return new SyncProviderError('rate-limited', 'Google Drive временно ограничил запросы')
  return new SyncProviderError('unavailable', `${operation}: ошибка Google Drive ${status}`)
}

export class GoogleDriveAdapter implements SyncAdapter {
  readonly descriptor = googleDriveDescriptor
  private readonly fetcher: typeof fetch

  constructor(
    private readonly accessToken: string,
    fetcher?: typeof fetch,
  ) {
    if (!accessToken.trim()) throw new SyncProviderError('auth-required', 'Нет активной OAuth-сессии Google Drive')
    this.fetcher = fetcher ?? globalThis.fetch.bind(globalThis)
  }

  private headers(contentType?: string): HeadersInit {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      ...(contentType ? { 'Content-Type': contentType } : {}),
    }
  }

  private async request(url: string, init: RequestInit, operation: string) {
    try {
      const response = await this.fetcher(url, init)
      if (!response.ok) throw errorForStatus(response.status, operation)
      return response
    } catch (error) {
      if (error instanceof SyncProviderError) throw error
      throw new SyncProviderError('offline', 'Не удалось связаться с Google Drive', error)
    }
  }

  private async findDataFile(): Promise<DriveFile | undefined> {
    const query = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`)
    const url = `${DRIVE_API}/files?spaces=appDataFolder&q=${query}&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime,version,size)&pageSize=10`
    const response = await this.request(url, { headers: this.headers() }, 'Поиск копии')
    const payload = (await response.json()) as { files?: DriveFile[] }
    return payload.files?.[0]
  }

  async head(): Promise<RemoteHead | null> {
    const file = await this.findDataFile()
    return file ? toRemoteHead(file) : null
  }

  async download(head?: RemoteHead): Promise<RemoteSnapshot | null> {
    const resolvedHead = head ?? await this.head()
    if (!resolvedHead) return null
    assertAllowedSnapshotSize(resolvedHead.size)
    const response = await this.request(
      `${DRIVE_API}/files/${encodeURIComponent(resolvedHead.id)}?alt=media`,
      { headers: this.headers() },
      'Загрузка копии',
    )
    try {
      const serialized = await responseTextWithinLimit(response)
      return { head: resolvedHead, payload: JSON.parse(serialized) as unknown }
    } catch (error) {
      if (error instanceof SyncProviderError) throw error
      throw new SyncProviderError('invalid-remote', 'Копия в Google Drive содержит повреждённый JSON', error)
    }
  }

  private async create(serializedPayload: string): Promise<RemoteHead> {
    const boundary = `focus_flow_${Date.now()}`
    const metadata = JSON.stringify({
      name: FILE_NAME,
      parents: ['appDataFolder'],
      mimeType: 'application/json',
    })
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      serializedPayload,
      `--${boundary}--`,
    ].join('\r\n')
    const response = await this.request(
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime,version,size`,
      {
        method: 'POST',
        headers: this.headers(`multipart/related; boundary=${boundary}`),
        body,
      },
      'Создание копии',
    )
    return toRemoteHead((await response.json()) as DriveFile)
  }

  private async update(file: DriveFile, serializedPayload: string): Promise<RemoteHead> {
    const response = await this.request(
      `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(file.id)}?uploadType=media&fields=id,name,modifiedTime,version,size`,
      {
        method: 'PATCH',
        headers: this.headers('application/json'),
        body: serializedPayload,
      },
      'Обновление копии',
    )
    return toRemoteHead((await response.json()) as DriveFile)
  }

  async upload(payload: unknown, options: UploadOptions = {}): Promise<RemoteHead> {
    const serializedPayload = serializeSnapshotWithinLimit(payload)
    const file = await this.findDataFile()
    if (!file) {
      if (typeof options.expectedRevision === 'string') {
        throw new SyncProviderError('conflict', 'Копия Google Drive была удалена на другом устройстве')
      }
      return this.create(serializedPayload)
    }
    if (options.expectedRevision === null) {
      throw new SyncProviderError('conflict', 'Копия Google Drive уже создана на другом устройстве')
    }
    const current = toRemoteHead(file)
    if (typeof options.expectedRevision === 'string' && current.revision !== options.expectedRevision) {
      throw new SyncProviderError('conflict', 'Копия Google Drive изменилась на другом устройстве')
    }
    return this.update(file, serializedPayload)
  }
}
