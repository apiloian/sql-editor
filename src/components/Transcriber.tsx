import { useEffect, useRef, useState } from 'react'
import { Icon } from '@clickhouse/click-ui'
import { Mic } from 'lucide-react'
import { startVoiceCapture } from '../lib/voiceCapture'

type VoiceState =
  | { status: 'idle' | 'loading' | 'requesting' | 'listening' | 'transcribing' }
  | { status: 'error'; message: string }
type WorkerMessage =
  | { type: 'ready' }
  | { type: 'partial' | 'complete'; session: number; transcript: string }
  | { type: 'error'; session?: number; message: string }

function isSupported() {
  return typeof Worker !== 'undefined' && typeof AudioWorkletNode !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof AudioContext !== 'undefined'
}

type TranscriberProps = {
  onTranscriptComplete: (text: string) => void
  onTranscriptPartial: (text: string) => void
  onActiveChange: (active: boolean) => void
}

export function Transcriber({ onTranscriptComplete, onTranscriptPartial, onActiveChange }: TranscriberProps) {
  const [state, setState] = useState<VoiceState>({ status: 'idle' })
  const workerRef = useRef<Worker | null>(null)
  const captureRef = useRef<Awaited<ReturnType<typeof startVoiceCapture>> | null>(null)
  const sessionRef = useRef(0)
  const modelReadyRef = useRef(false)
  const latestTranscript = useRef('')
  const mountedRef = useRef(true)
  const busyRef = useRef(false)
  const readyRef = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null)
  const supported = isSupported()
  const callbacksRef = useRef({ onTranscriptComplete, onTranscriptPartial, onActiveChange })
  useEffect(() => { callbacksRef.current = { onTranscriptComplete, onTranscriptPartial, onActiveChange } }, [onTranscriptComplete, onTranscriptPartial, onActiveChange])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      readyRef.current?.reject(new Error('Voice input was closed.'))
      readyRef.current = null
      captureRef.current?.dispose()
      workerRef.current?.terminate()
    }
  }, [])

  function fail(message: string) {
    captureRef.current?.dispose()
    captureRef.current = null
    busyRef.current = false
    if (!mountedRef.current) return
    if (latestTranscript.current) callbacksRef.current.onTranscriptComplete(latestTranscript.current)
    latestTranscript.current = ''
    callbacksRef.current.onTranscriptPartial('')
    callbacksRef.current.onActiveChange(false)
    setState({ status: 'error', message })
  }

  function handleMessage(message: WorkerMessage) {
    if (!mountedRef.current) return
    if ('session' in message && message.session !== undefined && message.session !== sessionRef.current) return
    if (message.type === 'ready') {
      modelReadyRef.current = true
      readyRef.current?.resolve()
      readyRef.current = null
    } else if (message.type === 'error') {
      readyRef.current?.reject(new Error(message.message))
      readyRef.current = null
      fail(message.message)
    } else if (message.type === 'partial') {
      latestTranscript.current = message.transcript.trim()
      callbacksRef.current.onTranscriptPartial(latestTranscript.current)
    } else {
      busyRef.current = false
      const text = message.transcript.trim()
      if (text) callbacksRef.current.onTranscriptComplete(text)
      callbacksRef.current.onTranscriptPartial('')
      callbacksRef.current.onActiveChange(false)
      latestTranscript.current = ''
      setState({ status: 'idle' })
    }
  }

  async function startRecording() {
    if (!supported || busyRef.current) return
    busyRef.current = true
    latestTranscript.current = ''
    try {
      if (!workerRef.current) {
        const worker = new Worker(`${import.meta.env.BASE_URL}workers/whisper-transcriber.js`, { type: 'module' })
        workerRef.current = worker
        worker.onmessage = (event: MessageEvent<WorkerMessage>) => handleMessage(event.data)
        worker.onerror = () => {
          worker.terminate()
          workerRef.current = null
          modelReadyRef.current = false
          handleMessage({ type: 'error', message: 'The local voice model could not load. Check your connection and try again.' })
        }
      }
      if (!modelReadyRef.current) {
        setState({ status: 'loading' })
        await new Promise<void>((resolve, reject) => {
          readyRef.current = { resolve, reject }
          workerRef.current?.postMessage({ type: 'init' })
        })
      }
      if (!mountedRef.current) return
      setState({ status: 'requesting' })
      const session = ++sessionRef.current
      workerRef.current?.postMessage({ type: 'start', session })
      const capture = await startVoiceCapture((audio) => {
        if (mountedRef.current && session === sessionRef.current) workerRef.current?.postMessage({ type: 'audio', session, audio }, [audio.buffer])
      })
      if (!mountedRef.current) { capture.dispose(); return }
      captureRef.current = capture
      callbacksRef.current.onActiveChange(true)
      setState({ status: 'listening' })
    } catch (error) {
      fail(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone permission was denied.' : error instanceof Error ? error.message : 'Voice input could not start.')
    }
  }

  async function stopRecording() {
    const capture = captureRef.current
    if (!capture) return
    captureRef.current = null
    setState({ status: 'transcribing' })
    await capture.stop()
    if (mountedRef.current) workerRef.current?.postMessage({ type: 'stop', session: sessionRef.current })
  }

  const labels = { idle: 'Start voice input', loading: 'Loading local voice model…', requesting: 'Waiting for microphone permission…', listening: 'Stop recording', transcribing: 'Transcribing locally…', error: 'Retry voice input' }
  const busy = state.status === 'loading' || state.status === 'requesting' || state.status === 'transcribing'
  const label = supported ? labels[state.status] : 'Voice input is not supported in this browser'

  return <div className="voice-input">
    <button className="assistant-voice" type="button" disabled={!supported || busy} aria-label={label} title={label} aria-pressed={state.status === 'listening'} onClick={() => {
      if (state.status === 'listening') {
        void stopRecording()
      } else void startRecording()
    }}>{state.status === 'listening' || busy ? <Icon name={state.status === 'listening' ? 'stop' : 'loading-animated'} size="sm" aria-hidden="true" /> : <Mic size={16} strokeWidth={1.6} aria-hidden="true" />}</button>
    {(busy || state.status === 'listening' || state.status === 'error') && <span className="voice-status" role={state.status === 'error' ? 'alert' : 'status'}>{state.status === 'error' ? state.message : state.status === 'listening' ? 'Listening… your words appear as they are transcribed.' : label}</span>}
  </div>
}
