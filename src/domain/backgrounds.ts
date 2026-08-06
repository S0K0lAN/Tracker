const BACKGROUND_DATA_URL_PATTERN = /^data:(image\/[a-z0-9!#$&^_.+-]+);base64,([a-z0-9+/]*={0,2})$/i

export const MAX_CUSTOM_BACKGROUND_BYTES = 1_500_000
export const MAX_CUSTOM_BACKGROUND_DATA_URL_LENGTH = 2_000_128

export function safeCustomBackgroundDataUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_CUSTOM_BACKGROUND_DATA_URL_LENGTH) return undefined
  const match = BACKGROUND_DATA_URL_PATTERN.exec(value)
  if (!match) return undefined
  const encoded = match[2]
  if (encoded.length % 4 !== 0) return undefined
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const decodedBytes = Math.floor(encoded.length * 3 / 4) - padding
  return decodedBytes <= MAX_CUSTOM_BACKGROUND_BYTES ? value : undefined
}
