import { useState, useRef } from 'react'
import './App.css'

function App() {
  const [isListening, setIsListening] = useState(false)
  const [volume, setVolume] = useState(0)
  const [error, setError] = useState(null)
  const [latencyResult, setLatencyResult] = useState(null)
  const [measuring, setMeasuring] = useState(false)
  const [audioInfo, setAudioInfo] = useState(null)
  const [latencyHistory, setLatencyHistory] = useState([])
  const [autoRunning, setAutoRunning] = useState(false)
  const [devices, setDevices] = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')

  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const animationRef = useRef(null)
  const streamRef = useRef(null)
  const beepStartTimeRef = useRef(null)
  const thresholdRef = useRef(0.05)
  const autoCountRef = useRef(0)
  const autoTotalRef = useRef(6)

  // 利用可能なオーディオ入力デバイスを取得
  const loadDevices = async () => {
    await navigator.mediaDevices.getUserMedia({ audio: true })
    const allDevices = await navigator.mediaDevices.enumerateDevices()
    const audioInputs = allDevices.filter((d) => d.kind === 'audioinput')
    setDevices(audioInputs)
    // AMS-22を自動選択
    const ams = audioInputs.find((d) => d.label.toLowerCase().includes('ams'))
    if (ams) setSelectedDeviceId(ams.deviceId)
  }

  const startListening = async () => {
    try {
      await loadDevices()

      const constraints = {
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive',
        sampleRate: 48000,
      })
      audioContextRef.current = audioContext

      const baseLatency = audioContext.baseLatency || 0
      const outputLatency = audioContext.outputLatency || 0
      setAudioInfo({
        baseLatency: (baseLatency * 1000).toFixed(2),
        outputLatency: (outputLatency * 1000).toFixed(2),
        sampleRate: audioContext.sampleRate,
      })

      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      analyserRef.current = analyser
      source.connect(analyser)

      setIsListening(true)
      setError(null)
      updateVolume()
    } catch (err) {
      setError('マイクへのアクセスエラー: ' + err.message)
    }
  }

  const updateVolume = () => {
    const analyser = analyserRef.current
    if (!analyser) return

    const dataArray = new Uint8Array(analyser.fftSize)
    analyser.getByteTimeDomainData(dataArray)

    let sum = 0
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128
      sum += normalized * normalized
    }
    const rms = Math.sqrt(sum / dataArray.length)
    setVolume(rms)

    if (beepStartTimeRef.current !== null && rms > thresholdRef.current) {
      const elapsed = performance.now() - beepStartTimeRef.current
      setLatencyResult(elapsed)
      setLatencyHistory((prev) => [...prev, elapsed])
      beepStartTimeRef.current = null
      setMeasuring(false)

      if (autoCountRef.current < autoTotalRef.current) {
        autoCountRef.current += 1
        setTimeout(() => {
          if (autoCountRef.current < autoTotalRef.current) {
            playBeepAndMeasure()
          } else {
            setAutoRunning(false)
          }
        }, 1000)
      } else {
        setAutoRunning(false)
      }
    }

    animationRef.current = requestAnimationFrame(updateVolume)
  }

  const stopListening = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
    if (audioContextRef.current) audioContextRef.current.close()
    setIsListening(false)
    setVolume(0)
  }

  const playBeepAndMeasure = () => {
    setLatencyResult(null)
    setMeasuring(true)
    const ctx = audioContextRef.current
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 1000
    gainNode.gain.value = 0.8
    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)
    beepStartTimeRef.current = performance.now()
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.1)
  }

  const startAutoMeasure = () => {
    setLatencyHistory([])
    autoCountRef.current = 0
    setAutoRunning(true)
    playBeepAndMeasure()
  }

  const copyHistory = () => {
    const text = latencyHistory.map((v, i) => `${i + 1}回目：${v.toFixed(1)} ms`).join('\n')
    navigator.clipboard.writeText(text)
  }

  const volumePercent = Math.min(volume * 300, 100)

  return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <h1>🎸 レイテンシ計測（AMS-22対応）</h1>

      {/* デバイス選択 */}
      {devices.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <label>入力デバイス：</label>
          <select
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            style={{ marginLeft: '8px', padding: '4px 8px' }}
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'デバイス'}
              </option>
            ))}
          </select>
        </div>
      )}

      {!isListening ? (
        <button onClick={startListening} style={{ fontSize: '18px', padding: '10px 20px' }}>
          マイクを開始
        </button>
      ) : (
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={stopListening} style={{ fontSize: '16px', padding: '10px 20px' }}>
            停止
          </button>
          <button
            onClick={playBeepAndMeasure}
            disabled={measuring || autoRunning}
            style={{ fontSize: '16px', padding: '10px 20px', background: measuring ? '#ccc' : '#4299e1', color: 'white', border: 'none', borderRadius: '6px' }}
          >
            {measuring ? '計測中...' : '1回計測'}
          </button>
          <button
            onClick={startAutoMeasure}
            disabled={measuring || autoRunning}
            style={{ fontSize: '16px', padding: '10px 20px', background: autoRunning ? '#ccc' : '#9f7aea', color: 'white', border: 'none', borderRadius: '6px' }}
          >
            {autoRunning ? '連続計測中...' : '6回連続計測'}
          </button>
        </div>
      )}

      {error && <p style={{ color: 'red', marginTop: '10px' }}>{error}</p>}

      {audioInfo && (
        <div style={{ marginTop: '16px', fontSize: '13px', color: '#666' }}>
          Base Latency: {audioInfo.baseLatency} ms ／
          Output Latency: {audioInfo.outputLatency} ms ／
          Sample Rate: {audioInfo.sampleRate} Hz
        </div>
      )}

      <div style={{ marginTop: '24px' }}>
        <p>入力レベル：</p>
        <div style={{ width: '100%', maxWidth: '500px', height: '30px', background: '#333', margin: '0 auto', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ width: `${volumePercent}%`, height: '100%', background: volumePercent > 80 ? '#e53e3e' : '#48bb78', transition: 'width 0.05s ease-out' }} />
        </div>
        <p>{(volume * 100).toFixed(1)} %</p>
      </div>

      {latencyResult !== null && (
        <div style={{ marginTop: '20px', fontSize: '28px', fontWeight: 'bold' }}>
          {latencyResult.toFixed(1)} ms
        </div>
      )}

      {latencyHistory.length > 0 && (
        <div style={{ marginTop: '24px', maxWidth: '400px', margin: '24px auto', background: '#f7f7f7', padding: '20px', borderRadius: '8px', textAlign: 'left' }}>
          <h3 style={{ marginTop: 0 }}>計測結果</h3>
          {latencyHistory.map((v, i) => (
            <p key={i} style={{ margin: '4px 0' }}>{i + 1}回目：{v.toFixed(1)} ms</p>
          ))}
          <p style={{ fontWeight: 'bold', marginTop: '12px' }}>
            平均：{(latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length).toFixed(1)} ms
          </p>
          <button onClick={copyHistory} style={{ marginTop: '8px', padding: '8px 16px', background: '#48bb78', color: 'white', border: 'none', borderRadius: '6px' }}>
            結果をコピー
          </button>
        </div>
      )}
    </div>
  )
}

export default App
