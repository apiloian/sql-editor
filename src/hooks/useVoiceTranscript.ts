import { useCallback, useEffect, useRef, useState } from 'react'
import { startVoiceCapture } from '../lib/voiceCapture'

type VoiceState =
  | { status: 'idle' | 'loading' | 'requesting' | 'listening' | 'transcribing' }
  | { status: 'error'; message: string }

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'partial' | 'complete'; session: number; transcript: string }
  | { type: 'error'; session?: number; message: string }

export function useVoiceTranscript(onComplete: (text: string) => void) {
  const [state, setState] = useState<VoiceState>({ status: 'idle' })
  const [partial, setPartial] = useState('')
  const worker = useRef<Worker | null>(null)
  const ready = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null)
  const modelReady = useRef(false)
  const capture = useRef<Awaited<ReturnType<typeof startVoiceCapture>> | null>(null)
  const session = useRef(0)
  const activeSession = useRef<number | null>(null)
  const latest = useRef('')
  const complete = useRef(onComplete)
  useEffect(() => { complete.current = onComplete }, [onComplete])

  const supported = typeof Worker !== 'undefined' && typeof AudioWorkletNode !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof AudioContext !== 'undefined'

  const release = useCallback(() => {
    activeSession.current = null
    ready.current?.reject(new Error('Voice input was closed.'))
    ready.current = null
    capture.current?.dispose()
    capture.current = null
    latest.current = ''
  }, [])
  const cancel = useCallback(() => {
    if (activeSession.current === null) return
    release()
    setPartial('')
    setState({ status: 'idle' })
  }, [release])

  useEffect(() => () => {
    release()
    worker.current?.terminate()
    worker.current = null
    modelReady.current = false
  }, [release])

  function finish(transcript: string, error?: string) {
    release()
    if (transcript) complete.current(transcript)
    setPartial('')
    setState(error ? { status: 'error', message: error } : { status: 'idle' })
  }

  async function start() {
    if (!supported || activeSession.current !== null) return
    const id = ++session.current
    activeSession.current = id
    try {
      if (!worker.current) {
        const instance = new Worker(`${import.meta.env.BASE_URL}workers/whisper-transcriber.js`, { type: 'module' })
        worker.current = instance
        instance.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
          if (data.type === 'ready') {
            modelReady.current = true
            ready.current?.resolve()
            ready.current = null
            return
          }
          const current = activeSession.current
          if (current === null || ('session' in data && data.session !== undefined && data.session !== current)) return
          if (data.type === 'error') finish(latest.current, data.message)
          else if (data.type === 'complete') finish(data.transcript.trim())
          else {
            latest.current = data.transcript.trim()
            setPartial(latest.current)
          }
        }
        instance.onerror = () => {
          instance.terminate()
          worker.current = null
          modelReady.current = false
          if (activeSession.current !== null) finish(latest.current, 'The local voice model could not load. Check your connection and try again.')
        }
      }
      if (!modelReady.current) {
        setState({ status: 'loading' })
        await new Promise<void>((resolve, reject) => {
          ready.current = { resolve, reject }
          worker.current?.postMessage({ type: 'init' })
        })
      }
      if (activeSession.current !== id) return
      setState({ status: 'requesting' })
      worker.current?.postMessage({ type: 'start', session: id })
      const nextCapture = await startVoiceCapture((audio) => {
        if (activeSession.current === id) worker.current?.postMessage({ type: 'audio', session: id, audio }, [audio.buffer])
      })
      if (activeSession.current !== id) {
        nextCapture.dispose()
        return
      }
      capture.current = nextCapture
      setState({ status: 'listening' })
    } catch (error) {
      if (activeSession.current === id) {
        finish(latest.current, error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone permission was denied.' : error instanceof Error ? error.message : 'Voice input could not start.')
      }
    }
  }

  async function stop() {
    const id = activeSession.current
    const recording = capture.current
    if (!recording || id === null || state.status !== 'listening') return
    setState({ status: 'transcribing' })
    try {
      await recording.stop()
      if (activeSession.current === id) worker.current?.postMessage({ type: 'stop', session: id })
    } catch {
      if (activeSession.current === id) finish(latest.current, 'Voice input could not finish.')
    }
  }

  return { state, partial, supported, start, stop, cancel }
}
