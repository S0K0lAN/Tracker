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

export const googleDriveDescriptor: SyncProviderDescriptor = {
  id: 'google-drive',
  name: 'Google Drive',
  description: 'Скрытая папка приложения в вашем Google Drive',
  connection: 'interactive',
  consistency: 'best-effort',
  privacyNote: 'Используется скрытая папка приложения и минимальный доступ drive.appdata.',
  configFields: [{
    key: 'clientId',
    label: 'Google OAuth Client ID',
    persistence: 'public',
    description: 'Публичный Client ID сохраняется только на этом устройстве. Access token хранится только в памяти.',
    placeholder: 'Можно задать через VITE_GOOGLE_CLIENT_ID',
    required: true,
  }],
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
    const response = await this.request(
      `${DRIVE_API}/files/${encodeURIComponent(resolvedHead.id)}?alt=media`,
      { headers: this.headers() },
      'Загрузка копии',
    )
    try {
      return { head: resolvedHead, payload: await response.json() }
    } catch (error) {
      throw new SyncProviderError('invalid-remote', 'Копия в Google Drive содержит повреждённый JSON', error)
    }
  }

  private async create(payload: unknown): Promise<RemoteHead> {
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
      JSON.stringify(payload),
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

  private async update(file: DriveFile, payload: unknown): Promise<RemoteHead> {
    const response = await this.request(
      `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(file.id)}?uploadType=media&fields=id,name,modifiedTime,version,size`,
      {
        method: 'PATCH',
        headers: this.headers('application/json'),
        body: JSON.stringify(payload),
      },
      'Обновление копии',
    )
    return toRemoteHead((await response.json()) as DriveFile)
  }

  async upload(payload: unknown, options: UploadOptions = {}): Promise<RemoteHead> {
    const file = await this.findDataFile()
    if (!file) {
      if (options.expectedRevision) throw new SyncProviderError('conflict', 'Копия Google Drive была удалена на другом устройстве')
      return this.create(payload)
    }
    const current = toRemoteHead(file)
    if (options.expectedRevision && current.revision !== options.expectedRevision) {
      throw new SyncProviderError('conflict', 'Копия Google Drive изменилась на другом устройстве')
    }
    return this.update(file, payload)
  }
}
