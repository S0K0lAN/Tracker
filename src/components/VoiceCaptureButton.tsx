import { useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'

interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>
}

interface SpeechRecognitionErrorEventLike extends Event {
  error?: string
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

export type VoiceCaptureFailure = 'unsupported' | 'permission-denied' | 'no-speech' | 'network' | 'other'

const FAILURE_COPY: Record<VoiceCaptureFailure, { title: string; hint: string }> = {
  unsupported: {
    title: 'Голосовой ввод не поддерживается этим браузером',
    hint: 'Введите фразу вручную — она будет разобрана так же, как диктовка.',
  },
  'permission-denied': {
    title: 'Доступ к микрофону запрещён',
    hint: 'Разрешите микрофон в настройках браузера или введите фразу вручную.',
  },
  'no-speech': {
    title: 'Речь не распознана',
    hint: 'Попробуйте произнести фразу ещё раз или введите её вручную.',
  },
  network: {
    title: 'Голосовой сервис недоступен из-за ошибки сети',
    hint: 'Проверьте соединение, повторите попытку или введите фразу вручную.',
  },
  other: {
    title: 'Не удалось использовать голосовой ввод',
    hint: 'Попробуйте ещё раз или введите фразу вручную.',
  },
}

export function classifyVoiceCaptureError(error: string | undefined): Exclude<VoiceCaptureFailure, 'unsupported'> {
  if (error === 'not-allowed' || error === 'service-not-allowed') return 'permission-denied'
  if (error === 'no-speech') return 'no-speech'
  if (error === 'network') return 'network'
  return 'other'
}

function classifyStartError(error: unknown): Exclude<VoiceCaptureFailure, 'unsupported'> {
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    return 'permission-denied'
  }
  return 'other'
}

export function VoiceCaptureFailureNotice({ failure }: { failure: VoiceCaptureFailure }) {
  const copy = FAILURE_COPY[failure]
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      <strong>{copy.title}</strong>
      <small>{copy.hint}</small>
    </div>
  )
}

export function VoiceCaptureButton({
  onTranscript,
  onUnavailable,
}: {
  onTranscript(transcript: string): void
  onUnavailable(failure: VoiceCaptureFailure): void
}) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const reportFailure = (failure: VoiceCaptureFailure, source?: SpeechRecognitionLike) => {
    if (source && recognitionRef.current !== source) return
    recognitionRef.current = null
    setListening(false)
    onUnavailable(failure)
  }

  const toggle = () => {
    if (listening) {
      const recognition = recognitionRef.current
      recognitionRef.current = null
      recognition?.stop()
      setListening(false)
      return
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Recognition) {
      reportFailure('unsupported')
      return
    }

    const recognition = new Recognition()
    recognition.lang = 'ru-RU'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript)
        .join(' ')
        .trim()
      if (transcript) onTranscript(transcript)
    }
    recognition.onerror = (event) => reportFailure(classifyVoiceCaptureError(event.error), recognition)
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return
      recognitionRef.current = null
      setListening(false)
    }
    recognitionRef.current = recognition
    setListening(true)
    try {
      recognition.start()
    } catch (error) {
      reportFailure(classifyStartError(error), recognition)
    }
  }

  return (
    <button
      type="button"
      className={`voice-capture ${listening ? 'voice-capture--listening' : ''}`}
      onClick={toggle}
      aria-label={listening ? 'Остановить диктовку' : 'Надиктовать задачу'}
      aria-pressed={listening}
      title={listening ? 'Слушаю…' : 'Надиктовать задачу'}
    >
      {listening ? <MicOff size={18} /> : <Mic size={18} />}
      <span>{listening ? 'Слушаю…' : 'Диктовка'}</span>
    </button>
  )
}
