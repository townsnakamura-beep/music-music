class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this._queue = []
    this._totalFrames = 0
    this._logCount = 0
    this._inputSampleRate = options?.processorOptions?.inputSampleRate || 48000
    this._outputSampleRate = options?.processorOptions?.outputSampleRate || 44100
    this._ratio = this._inputSampleRate / this._outputSampleRate
    const MAX_FRAMES = 1920
    this.port.onmessage = (e) => {
      const int16 = new Int16Array(e.data)
      // リサンプリング：inputSampleRate -> outputSampleRate
      const inputLength = int16.length
      const outputLength = Math.round(inputLength / this._ratio)
      const float32 = new Float32Array(outputLength)
      for (let i = 0; i < outputLength; i++) {
        const srcIndex = i * this._ratio
        const srcIndexFloor = Math.floor(srcIndex)
        const srcIndexCeil = Math.min(srcIndexFloor + 1, inputLength - 1)
        const frac = srcIndex - srcIndexFloor
        const s0 = int16[srcIndexFloor] / 32768.0
        const s1 = int16[srcIndexCeil] / 32768.0
        float32[i] = s0 + (s1 - s0) * frac
      }
      this._queue.push(float32)
      this._totalFrames += float32.length
      while (this._totalFrames > MAX_FRAMES && this._queue.length > 1) {
        this._totalFrames -= this._queue.shift().length
      }
    }
  }

  process(inputs, outputs) {
    const output = outputs[0][0]
    if (!output) return true

    this._logCount++
    if (this._logCount % 200 === 0) {
      this.port.postMessage({ type: 'debug', frames: this._totalFrames, queue: this._queue.length })
    }

    let written = 0
    while (written < output.length && this._queue.length > 0) {
      const chunk = this._queue[0]
      const remaining = output.length - written
      if (chunk.length <= remaining) {
        output.set(chunk, written)
        written += chunk.length
        this._totalFrames -= chunk.length
        this._queue.shift()
      } else {
        output.set(chunk.subarray(0, remaining), written)
        this._queue[0] = chunk.subarray(remaining)
        this._totalFrames -= remaining
        written = output.length
      }
    }
    if (written < output.length) {
      output.fill(0, written)
    }
    return true
  }
}

registerProcessor('pcm-player-processor', PcmPlayerProcessor)
