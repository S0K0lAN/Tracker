const DATA_URL_PATTERN = /^data:([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+);base64,([a-z0-9+/]*={0,2})$/i

export const MAX_ATTACHMENT_BYTES = 1_000_000
export const MAX_ATTACHMENT_DATA_URL_LENGTH = 1_400_000

export function attachmentDataUrlMimeType(dataUrl: unknown): string | undefined {
  if (typeof dataUrl !== 'string') return undefined
  if (dataUrl.length > MAX_ATTACHMENT_DATA_URL_LENGTH) return undefined
  const match = DATA_URL_PATTERN.exec(dataUrl)
  return match?.[1].toLowerCase()
}

export function safeAttachmentDataUrl(dataUrl: unknown, mimeType: unknown): string | undefined {
  if (typeof dataUrl !== 'string' || typeof mimeType !== 'string' || !mimeType.trim()) return undefined
  const encodedMimeType = attachmentDataUrlMimeType(dataUrl)
  if (!encodedMimeType || encodedMimeType !== mimeType.trim().toLowerCase()) return undefined
  return dataUrl
}
