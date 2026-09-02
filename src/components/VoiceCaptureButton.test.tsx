import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

const androidSpeechMocks = vi.hoisted(() => ({
  nativeAndroid: false,
  recognizeWithAndroid: vi.fn(),
}))

vi.mock('../core/speech/AndroidSpeechRecognition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/speech/AndroidSpeechRecognition')>()
  return {
    ...actual,
    isNativeAndroidSpeechRecognition: () => androidSpeechMocks.nativeAndroid,
    recognizeWithAndroid: androidSpeechMocks.recognizeWithAndroid,
  }
})

import { AndroidSpeechRecognitionError } from '../core/speech/AndroidSpeechRecognition'
import {
  VoiceCaptureButton,
  VoiceCaptureFailureNotice,
  type VoiceCaptureFailure,
} from './VoiceCaptureButton'

interface MockErrorEvent extends Event {
  error?: string
}

interface MockResultEvent extends Event {
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>
}

class MockRecognition {
  static latest: MockRecognition | undefined
  static startError: unknown

  lang = ''
  interimResults = true
  continuous = true
  onresult: ((event: MockResultEvent) => void) | null = null
  onerror: ((event: MockErrorEvent) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn(() => {
    if (MockRecognition.startError) throw MockRecognition.startError
  })
  stop = vi.fn()

  constructor() {
    MockRecognition.latest = this
  }
}

function installRecognition() {
  Object.defineProperty(window, 'SpeechRecognition', {
    configurable: true,
    value: MockRecognition,
  })
}

function errorEvent(error: string): MockErrorEvent {
  const event = new Event('error') as MockErrorEvent
  Object.defineProperty(event, 'error', { value: error })
  return event
}

function renderHarness() {
  const onTranscript = vi.fn()
  const onUnavailable = vi.fn()

  function Harness() {
    const [failure, setFailure] = useState<VoiceCaptureFailure>()
    return (
      <>
        <VoiceCaptureButton
          onTranscript={onTranscript}
          onUnavailable={(nextFailure) => {
            onUnavailable(nextFailure)
            setFailure(nextFailure)
          }}
        />
        {failure && <VoiceCaptureFailureNotice failure={failure} />}
      </>
    )
  }

  render(<Harness />)
  return { onTranscript, onUnavailable }
}

afterEach(() => {
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
  MockRecognition.latest = undefined
  MockRecognition.startError = undefined
  androidSpeechMocks.nativeAndroid = false
  androidSpeechMocks.recognizeWithAndroid.mockReset()
})

describe('VoiceCaptureButton Web Speech errors', () => {
  it('keeps the manual fallback available when Web Speech is unsupported', async () => {
    const user = userEvent.setup()
    const { onUnavailable } = renderHarness()

    await user.click(screen.getByRole('button', { name: 'Надиктовать задачу' }))

    expect(onUnavailable).toHaveBeenCalledWith('unsupported')
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('aria-atomic', 'true')
    expect(status).toHaveTextContent('Голосовой ввод не поддерживается этим браузером')
    expect(status).toHaveTextContent('Введите фразу вручную')
  })

  it.each([
    ['not-allowed', 'permission-denied', 'Доступ к микрофону запрещён'],
    ['service-not-allowed', 'permission-denied', 'Доступ к микрофону запрещён'],
    ['no-speech', 'no-speech', 'Речь не распознана'],
    ['network', 'network', 'Голосовой сервис недоступен из-за ошибки сети'],
    ['audio-capture', 'other', 'Не удалось использовать голосовой ввод'],
  ] as const)('maps %s to the typed %s state and an accessible message', async (error, failure, message) => {
    installRecognition()
    const user = userEvent.setup()
    const { onUnavailable } = renderHarness()

    await user.click(screen.getByRole('button', { name: 'Надиктовать задачу' }))
    expect(MockRecognition.latest?.lang).toBe('ru-RU')
    expect(screen.getByRole('button', { name: 'Остановить диктовку' })).toHaveAttribute('aria-pressed', 'true')

    act(() => MockRecognition.latest?.onerror?.(errorEvent(error)))

    expect(onUnavailable).toHaveBeenCalledWith(failure)
    expect(screen.getByRole('status')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: 'Надиктовать задачу' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('classifies a synchronous microphone denial and leaves the retry control usable', async () => {
    installRecognition()
    MockRecognition.startError = new DOMException('denied', 'NotAllowedError')
    const user = userEvent.setup()
    const { onUnavailable } = renderHarness()

    await user.click(screen.getByRole('button', { name: 'Надиктовать задачу' }))

    expect(onUnavailable).toHaveBeenCalledWith('permission-denied')
    expect(screen.getByRole('status')).toHaveTextContent('Доступ к микрофону запрещён')
    expect(screen.getByRole('button', { name: 'Надиктовать задачу' })).toBeEnabled()
  })

  it('ignores a late end event from a failed recognizer after retry starts', async () => {
    installRecognition()
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByRole('button', { name: 'Надиктовать задачу' }))
    const failedRecognition = MockRecognition.latest!
    act(() => failedRecognition.onerror?.(errorEvent('network')))

    await user.click(screen.getByRole('button', { name: 'Надиктовать задачу' }))
    const retryRecognition = MockRecognition.latest!
    expect(retryRecognition).not.toBe(failedRecognition)
    expect(screen.getByRole('button', { name: 'Остановить диктовку' })).toHaveAttribute('aria-pressed', 'true')

    act(() => failedRecognition.onend?.())

    expect(screen.getByRole('button', { name: 'Остановить диктовку' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Остановить диктовку' }))
    expect(retryRecognition.stop).toHaveBeenCalledOnce()
  })

  it('uses Android system recognition and disables duplicate starts while it is pending', async () => {
    const user = userEvent.setup()
    androidSpeechMocks.nativeAndroid = true
    let resolveRecognition!: (result: { status: 'recognized'; transcript: string }) => void
    androidSpeechMocks.recognizeWithAndroid.mockReturnValue(new Promise((resolve) => {
      resolveRecognition = resolve
    }))
    const { onTranscript, onUnavailable } = renderHarness()

    await user.click(screen.getByRole('button', { name: 'Надиктовать задачу' }))
    expect(androidSpeechMocks.recognizeWithAndroid).toHaveBeenCalledWith('ru-RU')
    expect(screen.getByRole('button', { name: 'Идёт системная диктовка' })).toBeDisabled()

    act(() => resolveRecognition({ status: 'recognized', transcript: 'купить молоко завтра' }))
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('купить молоко завтра'))
    expect(onUnavailable).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Надиктовать задачу' })).toBeEnabled()
  })

  it('treats Android cancellation as silent and maps a missing recognizer to the manual fallback', async () => {
    const user = userEvent.setup()
    androidSpeechMocks.nativeAndroid = true
    androidSpeechMocks.recognizeWithAndroid.mockResolvedValueOnce({ status: 'cancelled' })
    const { onUnavailable } = renderHarness()

    await user.click(screen.getByRole('button', { name: 'Надиктовать задачу' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Надиктовать задачу' })).toBeEnabled())
    expect(onUnavailable).not.toHaveBeenCalled()

    androidSpeechMocks.recognizeWithAndroid.mockRejectedValueOnce(
      new AndroidSpeechRecognitionError('no-activity', 'Нет системного распознавателя'),
    )
    await user.click(screen.getByRole('button', { name: 'Надиктовать задачу' }))
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith('unsupported'))
    expect(screen.getByRole('status')).toHaveTextContent('Голосовой ввод не поддерживается этим браузером')
  })
})
