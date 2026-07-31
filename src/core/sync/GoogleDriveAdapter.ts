import type { AppState } from '../../domain/models'
import type { SyncAdapter, SyncResult } from './SyncAdapter'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const FILE_NAME = 'focus-flow-data.json'

interface DriveFile {
  id: string
  name: string
  modifiedTime?: string
}

export class GoogleDriveAdapter implements SyncAdapter {
  readonly id = 'google-drive'
  readonly name = 'Google Drive'

  constructor(
    private readonly accessToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private headers(contentType?: string): HeadersInit {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      ...(contentType ? { 'Content-Type': contentType } : {}),
    }
  }

  async testConnection(): Promise<boolean> {
    const response = await this.fetcher(
      `${DRIVE_API}/files?spaces=appDataFolder&pageSize=1&fields=files(id,name)`,
      { headers: this.headers() },
    )
    return response.ok
  }

  private async findDataFile(): Promise<DriveFile | undefined> {
    const query = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`)
    const response = await this.fetcher(
      `${DRIVE_API}/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)&pageSize=1`,
      { headers: this.headers() },
    )
    if (!response.ok) throw new Error(`Google Drive: ${response.status}`)
    const payload = (await response.json()) as { files?: DriveFile[] }
    return payload.files?.[0]
  }

  private async createDataFile(state: AppState): Promise<DriveFile> {
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
      JSON.stringify(state),
      `--${boundary}--`,
    ].join('\r\n')
    const response = await this.fetcher(
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime`,
      {
        method: 'POST',
        headers: this.headers(`multipart/related; boundary=${boundary}`),
        body,
      },
    )
    if (!response.ok) throw new Error(`Google Drive upload: ${response.status}`)
    return (await response.json()) as DriveFile
  }

  private async updateDataFile(fileId: string, state: AppState): Promise<void> {
    const response = await this.fetcher(
      `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: this.headers('application/json'),
        body: JSON.stringify(state),
      },
    )
    if (!response.ok) throw new Error(`Google Drive update: ${response.status}`)
  }

  async sync(localState: AppState): Promise<SyncResult> {
    const file = await this.findDataFile()
    if (file) {
      await this.updateDataFile(file.id, localState)
      return { state: localState, remoteId: file.id, message: 'Данные обновлены в Google Drive' }
    }
    const created = await this.createDataFile(localState)
    return { state: localState, remoteId: created.id, message: 'Создана защищённая копия в Google Drive' }
  }
}
