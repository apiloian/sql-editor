export async function startVoiceCapture(onAudio: (audio: Float32Array<ArrayBuffer>) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  let context: AudioContext | null = null
  try {
    context = new AudioContext({ sampleRate: 16_000 })
    await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}workers/voice-capture.js`)
    const source = context.createMediaStreamSource(stream)
    const capture = new AudioWorkletNode(context, 'voice-capture')
    const mute = context.createGain()
    mute.gain.value = 0
    source.connect(capture).connect(mute).connect(context.destination)
    let finish: (() => void) | null = null
    const audioContext = context
    let disposed = false
    function dispose() {
      if (disposed) return
      disposed = true
      finish?.()
      capture.port.onmessage = null
      source.disconnect()
      capture.disconnect()
      mute.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      void audioContext.close()
    }
    capture.port.onmessage = (event: MessageEvent<Float32Array<ArrayBuffer> | 'stopped'>) => {
      if (event.data === 'stopped') {
        dispose()
        finish?.()
      } else onAudio(event.data)
    }
    await context.resume()
    return {
      stop: () => new Promise<void>((resolve) => { finish = resolve; capture.port.postMessage('stop') }),
      dispose,
    }
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    if (context) void context.close()
    throw error
  }
}
