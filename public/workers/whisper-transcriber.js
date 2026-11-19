import { env, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1'

env.allowLocalModels = false
env.useBrowserCache = true
env.backends.onnx.wasm.numThreads = 1

let transcriberPromise = null

function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      device: 'wasm',
      dtype: 'q8',
    }).catch((error) => {
      transcriberPromise = null
      throw error
    })
  }
  return transcriberPromise
}

let session = 0
let segments = []
let committed = ''
let stopped = false
let processing = false
let nextSegment = 0

function segment() {
  return { id: nextSegment++, chunks: [], length: 0, processed: 0, transcript: '', closed: false }
}

async function drain() {
  if (processing) return
  processing = true
  const activeSession = session
  try {
    const transcriber = await getTranscriber()
    while (session === activeSession && segments.length) {
      const current = segments[0]
      if (!current.closed && current.length - current.processed < 16_000) break
      const final = current.closed
      const length = current.length
      if (length) {
        let text = current.transcript
        if (length !== current.processed) {
          const audio = new Float32Array(length)
          let offset = 0
          for (const chunk of current.chunks) {
            audio.set(chunk, offset)
            offset += chunk.length
          }
          let energy = 0
          for (const sample of audio) energy += sample * sample
          text = ''
          if (Math.sqrt(energy / length) > 0.002) {
            const output = await transcriber(audio, { return_timestamps: false })
            text = (output.text ?? '').replace(/\[(?:BLANK|BLANCK)_AUDIO\]/gi, '').trim()
          }
        }
        if (session !== activeSession) break
        current.processed = length
        current.transcript = text
        if (final) committed = [committed, text].filter(Boolean).join(' ')
        self.postMessage({ type: 'partial', session, transcript: final ? committed : [committed, text].filter(Boolean).join(' ') })
      }
      if (final) segments.shift()
      else if (!current.closed && current.length === length) break
    }
    if (session === activeSession && stopped && !segments.length) {
      self.postMessage({ type: 'complete', session, transcript: committed })
    }
  } catch (error) {
    if (session === activeSession) {
      segments = []
      self.postMessage({ type: 'error', session, message: error instanceof Error ? error.message : 'Transcription failed.' })
    }
  } finally {
    processing = false
    if (session !== activeSession && segments.length) void drain()
  }
}

self.addEventListener('message', async ({ data }) => {
  if (data.type === 'init') {
    try {
      await getTranscriber()
      self.postMessage({ type: 'ready' })
    } catch (error) {
      self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'The model could not load.' })
    }
    return
  }
  if (data.type === 'start') {
    session = data.session
    segments = [segment()]
    committed = ''
    stopped = false
    return
  }
  if (data.session !== session) return
  if (data.type === 'audio' && !stopped) {
    let current = segments[segments.length - 1]
    if (!current || current.closed) {
      current = segment()
      segments.push(current)
    }
    current.chunks.push(data.audio)
    current.length += data.audio.length
    // Bound inference windows without limiting the recording duration.
    if (current.length >= 20 * 16_000) current.closed = true
    void drain()
  } else if (data.type === 'stop') {
    stopped = true
    for (const current of segments) current.closed = true
    void drain()
  }
})
