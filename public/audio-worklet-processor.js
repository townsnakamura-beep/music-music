class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._queue = []
    this._totalFrames = 0
    this._logCount = 0
    const MAX_FRAMES = 1920
    this.port.onmessage = (e) => {
      const int16 = new Int16Array(e.data)
      const float32 = new Float32Array(int16.length)
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0
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
