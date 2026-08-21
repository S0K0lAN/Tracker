import { CURRENT_SCHEMA_VERSION } from '../../domain/migrations'
import type { AppState } from '../../domain/models'
import {
  createRemoteEnvelope,
  decodeRemoteSnapshot,
  type RemoteSnapshotEnvelope,
} from '../sync/RemoteSnapshot'

export const MAX_PORTABLE_BACKUP_BYTES = 10 * 1024 * 1024

export type PortableBackupErrorCode =
  | 'empty'
  | 'invalid-json'
  | 'invalid-backup'
  | 'invalid-state'
  | 'newer-version'
  | 'too-large'
  | 'wrong-file-type'

export class PortableBackupError extends Error {
  constructor(readonly code: PortableBackupErrorCode, message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'PortableBackupError'
  }
}

export interface PortableBackupFile {
  contents: string
  fileName: string
  envelope: RemoteSnapshotEnvelope
}

export interface ParsedPortableBackup {
  state: AppState
  generatedAt?: string
}

export function createPortableBackup(state: AppState, now = new Date()): PortableBackupFile {
  let envelope: RemoteSnapshotEnvelope
  let generatedAt: string
  let contents: string
  try {
    generatedAt = now.toISOString()
    envelope = createRemoteEnvelope(state, generatedAt)
    contents = JSON.stringify(envelope)
  } catch (error) {
    throw new PortableBackupError(
      'invalid-state',
      'Локальные данные повреждены, поэтому резервную копию нельзя создать',
      error,
    )
  }
  const timestamp = generatedAt.slice(0, 19).replace(/:/g, '-')
  if (new TextEncoder().encode(contents).byteLength > MAX_PORTABLE_BACKUP_BYTES) {
    throw new PortableBackupError(
      'too-large',
      'Текущая резервная копия превышает 10 МБ. Удалите часть больших вложений и повторите попытку',
    )
  }
  return {
    contents,
    fileName: `focus-flow-backup-${timestamp}.json`,
    envelope,
  }
}

export function parsePortableBackup(contents: string): ParsedPortableBackup {
  if (!contents.trim()) {
    throw new PortableBackupError('empty', 'Файл резервной копии пуст')
  }
  if (new TextEncoder().encode(contents).byteLength > MAX_PORTABLE_BACKUP_BYTES) {
    throw new PortableBackupError('too-large', 'Файл резервной копии превышает 10 МБ')
  }

  let payload: unknown
  try {
    payload = JSON.parse(contents)
  } catch (error) {
    throw new PortableBackupError('invalid-json', 'Файл содержит некорректный JSON', error)
  }

  if (isRecord(payload) && Number.isSafeInteger(payload.schemaVersion)
    && (payload.schemaVersion as number) > CURRENT_SCHEMA_VERSION) {
    throw new PortableBackupError(
      'newer-version',
      'Копия создана более новой версией Focus Flow. Обновите приложение',
    )
  }

  try {
    return {
      state: decodeRemoteSnapshot(payload),
      generatedAt: readGeneratedAt(payload),
    }
  } catch (error) {
    throw new PortableBackupError(
      'invalid-backup',
      'Файл не является резервной копией Focus Flow или повреждён',
      error,
    )
  }
}

export function assertPortableBackupFile(file: Pick<File, 'name' | 'size'>): void {
  if (!file.name.toLocaleLowerCase().endsWith('.json')) {
    throw new PortableBackupError('wrong-file-type', 'Выберите файл резервной копии в формате JSON')
  }
  if (file.size > MAX_PORTABLE_BACKUP_BYTES) {
    throw new PortableBackupError('too-large', 'Файл слишком большой. Максимальный размер — 10 МБ')
  }
}

function readGeneratedAt(payload: unknown): string | undefined {
  if (!isRecord(payload) || typeof payload.generatedAt !== 'string') return undefined
  return payload.generatedAt
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
