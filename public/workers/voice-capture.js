class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(1600)
    this.offset = 0
    this.stopped = false
    this.port.onmessage = ({ data }) => {
      if (data === 'stop') {
        if (this.offset) this.port.postMessage(this.buffer.slice(0, this.offset))
        this.stopped = true
        this.port.postMessage('stopped')
      }
    }
  }

  process(inputs) {
    if (this.stopped) return false
    const channels = inputs[0]
    if (!channels?.length) return true
    for (let index = 0; index < channels[0].length; index++) {
      let sample = 0
      for (const channel of channels) sample += channel[index] / channels.length
      this.buffer[this.offset++] = sample
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer])
        this.buffer = new Float32Array(1600)
        this.offset = 0
      }
    }
    return true
  }
}

registerProcessor('voice-capture', VoiceCapture)
