import { useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'

interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
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

export function VoiceCaptureButton({
  onTranscript,
  onUnavailable,
}: {
  onTranscript(transcript: string): void
  onUnavailable(): void
}) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const toggle = () => {
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Recognition) {
      onUnavailable()
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
    recognition.onerror = () => {
      setListening(false)
      onUnavailable()
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
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
