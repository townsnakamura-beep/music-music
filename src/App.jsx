import { useState, useRef, useEffect, useCallback } from 'react'
import { io } from 'socket.io-client'

const SIGNALING_SERVER_URL = 'https://music-music.onrender.com'
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}
const MAX_SAMPLES = 60

const S = {
  wrap: { background: '#0d0d0d', height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif', color: '#fff', overflow: 'hidden' },
  titleBar: {
    height: '36px', background: '#080808', borderBottom: '0.5px solid #1e1e1e',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    paddingLeft: '16px', flexShrink: 0,
    WebkitAppRegion: 'drag',
    userSelect: 'none',
  },
  titleBarTitle: { fontSize: '12px', color: '#555', letterSpacing: '3px' },
  closeBtn: {
    width: '48px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', color: '#888', fontSize: '20px',
    WebkitAppRegion: 'no-drag',
  },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  side: { width: '200px', background: '#080808', borderRight: '0.5px solid #1e1e1e', display: 'flex', flexDirection: 'column', flexShrink: 0 },
  brand: { padding: '28px 24px 20px', borderBottom: '0.5px solid #1e1e1e' },
  brandName: { fontSize: '32px', fontWeight: 500, color: '#fff', letterSpacing: '6px' },
  brandTag: { fontSize: '10px', color: '#444', letterSpacing: '2px', marginTop: '4px' },
  nav: { padding: '16px 0', flex: 1 },
  ni: (active) => ({
    padding: '11px 24px', fontSize: '13px', color: active ? '#fff' : '#555',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
    borderLeft: active ? '2px solid #e84040' : '2px solid transparent',
    background: active ? '#111' : 'transparent',
  }),
  main: { flex: 1, padding: '32px 36px', overflowY: 'auto', maxWidth: '640px' },
  pgTitle: { fontSize: '22px', fontWeight: 500, color: '#fff', letterSpacing: '1px' },
  pgSub: { fontSize: '11px', color: '#aaa', marginTop: '6px', letterSpacing: '1px', marginBottom: '32px' },
  secLabel: { fontSize: '10px', color: '#666', letterSpacing: '2px', marginBottom: '12px' },
  card: { background: '#111', borderRadius: '12px', border: '0.5px solid #1e1e1e', overflow: 'hidden', marginBottom: '10px' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '0.5px solid #161616' },
  rowLast: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px' },
  rl: { fontSize: '13px', color: '#fff' },
  rs: { fontSize: '11px', color: '#888', marginTop: '3px' },
  rv: { fontSize: '12px', color: '#bbb' },
  badgeAsio: { fontSize: '10px', background: '#2a0f0f', color: '#e84040', padding: '3px 10px', borderRadius: '20px', letterSpacing: '.5px' },
  badgeOk: { fontSize: '10px', background: '#0f2a1a', color: '#3ecf8e', padding: '3px 10px', borderRadius: '20px', letterSpacing: '.5px' },
  badgeWarn: { fontSize: '10px', background: '#2a1f0f', color: '#e8a23a', padding: '3px 10px', borderRadius: '20px', letterSpacing: '.5px' },
  latBlock: { padding: '20px', background: '#111', borderRadius: '12px', border: '0.5px solid #1e1e1e', marginBottom: '10px' },
  latNum: { fontSize: '48px', fontWeight: 500, color: '#fff', lineHeight: 1 },
  latUnit: { fontSize: '13px', color: '#888', marginBottom: '8px' },
  latSub: { fontSize: '10px', color: '#888', letterSpacing: '.5px', marginBottom: '16px' },
  bufRow: { display: 'flex', gap: '8px' },
  bb: (active) => ({
    flex: 1, padding: '10px 0',
    background: active ? '#1a0808' : '#0d0d0d',
    border: active ? '0.5px solid #e84040' : '0.5px solid #222',
    borderRadius: '8px', color: active ? '#e84040' : '#888',
    fontSize: '12px', cursor: 'pointer', textAlign: 'center', letterSpacing: '.5px',
  }),
  sec: { marginBottom: '28px' },
}

function Toggle({ checked, onChange }) {
  return (
    <label style={{ position: 'relative', width: '42px', height: '24px', flexShrink: 0, display: 'block' }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ opacity: 0, width: 0, height: 0 }} />
      <span style={{
        position: 'absolute', inset: 0,
        background: checked ? '#e84040' : '#1e1e1e',
        borderRadius: '24px', cursor: 'pointer',
        border: '0.5px solid ' + (checked ? '#e84040' : '#2a2a2a'),
      }}>
        <span style={{
          position: 'absolute', width: '16px', height: '16px',
          left: checked ? '22px' : '3px', top: '3px',
          background: '#fff', borderRadius: '50%', transition: 'left .2s',
        }} />
      </span>
    </label>
  )
}

function Meter({ bars }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '24px', width: '120px' }}>
      {bars.map((b, i) => (
        <div key={i} style={{
          width: '4px', borderRadius: '1px',
          height: (b.h * 100).toFixed(0) + '%',
          background: b.h > 0.85 ? '#e84040' : b.h > 0.65 ? '#e8a23a' : '#3ecf8e',
          opacity: (0.5 + b.h * 0.5).toFixed(2),
        }} />
      ))}
    </div>
  )
}

function App() {
  const [page, setPage] = useState('session')
  const [connectionStatus, setConnectionStatus] = useState('未接続')
  const [myId, setMyId] = useState(null)
  const [peerId, setPeerId] = useState(null)
  const [isCallActive, setIsCallActive] = useState(false)
  const [error, setError] = useState(null)
  const [useNative, setUseNative] = useState(false)

  const [devices, setDevices] = useState([])
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [deviceReady, setDeviceReady] = useState(false)

  const [bufferSize, setBufferSize] = useState(128)
  const [inputGain, setInputGain] = useState(75)
  const [outputVolume, setOutputVolume] = useState(80)
  const [monitor, setMonitor] = useState(false)

  const [meterBars, setMeterBars] = useState(Array(15).fill({ h: 0.05 }))
  const meterPhaseRef = useRef(0)

  const [latencyHistory, setLatencyHistory] = useState([])
  const [latestRtt, setLatestRtt] = useState(null)
  const [minRtt, setMinRtt] = useState(null)
  const [maxRtt, setMaxRtt] = useState(null)
  const [avgRtt, setAvgRtt] = useState(null)
  const [ipcLatency, setIpcLatency] = useState(null)
  const [measuring, setMeasuring] = useState(false)

  const socketRef = useRef(null)
  const peerConnectionRef = useRef(null)
  const dataChannelRef = useRef(null)
  const localStreamRef = useRef(null)
  const remoteAudioRef = useRef(null)
  const trackGeneratorRef = useRef(null)
  const pingIntervalRef = useRef(null)
  const pendingPingsRef = useRef({})
  const latencyHistoryRef = useRef([])
  const selectedDeviceRef = useRef(null)
  const inputGainRef = useRef(inputGain)

  const isElectron = typeof window.electronAPI !== 'undefined'

  const ipcTimestampsRef = useRef([])
  const measureIpcLatency = useCallback((t) => {
    const ts = ipcTimestampsRef.current
    ts.push(t)
    if (ts.length > 20) ts.shift()
    if (ts.length >= 2) {
      const intervals = []
      for (let i = 1; i < ts.length; i++) intervals.push(ts[i] - ts[i - 1])
      setIpcLatency(Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length))
    }
  }, [])

  useEffect(() => { inputGainRef.current = inputGain }, [inputGain])

  useEffect(() => {
    const id = setInterval(() => {
      meterPhaseRef.current += 0.15
      const phase = meterPhaseRef.current
      const base = 0.45 + Math.sin(phase * 0.7) * 0.3
      const N = 15
      setMeterBars(Array(N).fill(0).map((_, i) => ({
        h: Math.max(0.05, Math.min(1, base * Math.sin((i / N) * Math.PI) + (Math.random() - 0.5) * 0.2))
      })))
    }, 60)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (isElectron) {
      window.electronAPI.getAudioDevices().then(devs => {
        setDevices(devs)
        if (devs.length === 1) { setSelectedDevice(devs[0]); selectedDeviceRef.current = devs[0] }
      }).catch(() => {})
    }

    const keepAlive = setInterval(() => { fetch('https://music-music.onrender.com/ping').catch(() => {}) }, 30000)
    const socket = io(SIGNALING_SERVER_URL)
    socketRef.current = socket

    socket.on('connect', () => { setMyId(socket.id); setConnectionStatus('サーバーに接続済み・相手を待機中') })
    socket.on('connect_error', () => setConnectionStatus('サーバー接続エラー'))
    socket.on('peer-available', (id) => { setPeerId(id); setConnectionStatus('相手を発見：' + id) })
    socket.on('offer', async ({ from, offer }) => {
      setPeerId(from)
      try {
        await setupPeerConnection(from)
        await peerConnectionRef.current.setRemoteDescription(offer)
        const answer = await peerConnectionRef.current.createAnswer()
        await peerConnectionRef.current.setLocalDescription(answer)
        socket.emit('answer', { to: from, answer })
      } catch (err) { setError('オファー処理エラー: ' + err.message) }
    })
    socket.on('answer', async ({ answer }) => { await peerConnectionRef.current.setRemoteDescription(answer) })
    socket.on('ice-candidate', async ({ candidate }) => {
      if (peerConnectionRef.current) try { await peerConnectionRef.current.addIceCandidate(candidate) } catch (e) {}
    })

    return () => {
      socket.disconnect()
      clearInterval(keepAlive)
      stopMeasuring()
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop())
      if (isElectron && window.electronAPI) window.electronAPI.stopAudio()
    }
  }, [])

  useEffect(() => {
    if (remoteAudioRef.current) remoteAudioRef.current.volume = outputVolume / 100
  }, [outputVolume])

  const latencyEstimateMs = () => ((bufferSize / 48000) * 1000 + 2.5).toFixed(1)

  const bufferBadge = () => {
    if (bufferSize <= 128) return { text: 'LOW LATENCY', style: S.badgeOk }
    if (bufferSize <= 256) return { text: 'STANDARD', style: S.badgeWarn }
    return { text: 'STABLE', style: S.badgeWarn }
  }

  const startAudioWithDevice = async (device) => {
    try {
      const trackGenerator = new MediaStreamTrackGenerator({ kind: 'audio' })
      trackGeneratorRef.current = trackGenerator
      const stream = new MediaStream([trackGenerator])
      localStreamRef.current = stream
      const writer = trackGenerator.writable.getWriter()
      const sampleRate = device.preferredSampleRate || 48000

      await window.electronAPI.startAudio({ id: device.id, type: device.type, sampleRate, bufferSize })
      setUseNative(true)
      setDeviceReady(true)

      window.electronAPI.onAudioData((chunk) => {
        const receivedAt = performance.now()
        measureIpcLatency(receivedAt)
        const safeBuffer = chunk instanceof ArrayBuffer ? chunk
          : chunk.buffer ? chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
          : new Uint8Array(chunk).buffer
        const int16 = new Int16Array(safeBuffer)
        const float32 = new Float32Array(int16.length)
        const gain = inputGainRef.current / 100
        for (let i = 0; i < int16.length; i++) float32[i] = (int16[i] / 32768.0) * gain
        const CHUNK = bufferSize
        for (let offset = 0; offset < float32.length; offset += CHUNK) {
          const slice = float32.slice(offset, offset + CHUNK)
          const audioData = new AudioData({
            format: 'f32', sampleRate,
            numberOfFrames: slice.length, numberOfChannels: 1,
            timestamp: (receivedAt + (offset / sampleRate) * 1000) * 1000,
            data: slice,
          })
          writer.write(audioData).catch(() => {})
        }
      })
    } catch (err) {
      await initWebAudio()
      setDeviceReady(true)
    }
  }

  const initWebAudio = async () => {
    try {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      const ctx = new AudioContext()
      localStreamRef.current = ctx.createMediaStreamDestination().stream
    }
  }

  const handleDeviceSelect = async (device) => {
    setSelectedDevice(device)
    selectedDeviceRef.current = device
    await startAudioWithDevice(device)
  }

  const handleNoBrowserStart = async () => { await initWebAudio(); setDeviceReady(true) }

  const setupPeerConnection = async (targetId) => {
    const pc = new RTCPeerConnection(ICE_SERVERS)
    peerConnectionRef.current = pc
    const dc = pc.createDataChannel('latency', { ordered: false, maxRetransmits: 0 })
    dataChannelRef.current = dc
    setupDataChannel(dc)
    pc.ondatachannel = (e) => { if (e.channel.label === 'latency') setupDataChannel(e.channel) }
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current))
    pc.onicecandidate = (e) => { if (e.candidate) socketRef.current.emit('ice-candidate', { to: targetId, candidate: e.candidate }) }
    pc.ontrack = async (e) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0]
        remoteAudioRef.current.volume = outputVolume / 100
        remoteAudioRef.current.muted = false
        remoteAudioRef.current.play().catch(() => {})
      }
      try {
        pc.getReceivers().forEach(r => {
          if (r.track.kind === 'audio' && 'jitterBufferTarget' in r) r.jitterBufferTarget = 0
        })
      } catch (e) {}
      setIsCallActive(true)
      setConnectionStatus('通話中')
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setConnectionStatus('接続が切断されました')
        setIsCallActive(false)
        stopMeasuring()
      }
    }
  }

  const setupDataChannel = (dc) => {
    dc.onmessage = (e) => {
      const now = performance.now()
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'ping') {
          if (dc.readyState === 'open') dc.send(JSON.stringify({ type: 'pong', id: msg.id, sentAt: msg.sentAt }))
        } else if (msg.type === 'pong') {
          const rtt = now - msg.sentAt
          delete pendingPingsRef.current[msg.id]
          const history = [...latencyHistoryRef.current, Math.round(rtt)]
          if (history.length > MAX_SAMPLES) history.shift()
          latencyHistoryRef.current = history
          setLatestRtt(Math.round(rtt))
          setMinRtt(Math.min(...history))
          setMaxRtt(Math.max(...history))
          setAvgRtt(Math.round(history.reduce((a, b) => a + b, 0) / history.length))
          setLatencyHistory([...history])
        }
      } catch (e) {}
    }
    dc.onopen = () => { dataChannelRef.current = dc }
  }

  const startMeasuring = () => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') {
      setError('DataChannelがまだ開いていません。')
      return
    }
    setMeasuring(true)
    latencyHistoryRef.current = []
    setLatencyHistory([])
    let pingId = 0
    pingIntervalRef.current = setInterval(() => {
      if (dataChannelRef.current?.readyState === 'open') {
        const id = pingId++
        const sentAt = performance.now()
        pendingPingsRef.current[id] = sentAt
        dataChannelRef.current.send(JSON.stringify({ type: 'ping', id, sentAt }))
      }
    }, 200)
  }

  const stopMeasuring = () => {
    setMeasuring(false)
    if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null }
  }

  const callPeer = async () => {
    if (!peerId) return
    try {
      await setupPeerConnection(peerId)
      const offer = await peerConnectionRef.current.createOffer()
      let sdp = offer.sdp.replace(/a=fmtp:111 /g, 'a=fmtp:111 ptime=10;minptime=10;useinbandfec=1;')
      const modifiedOffer = { type: offer.type, sdp }
      await peerConnectionRef.current.setLocalDescription(modifiedOffer)
      socketRef.current.emit('offer', { to: peerId, offer: modifiedOffer })
    } catch (err) { setError('発信エラー: ' + err.message) }
  }

  const renderGraph = () => {
    if (latencyHistory.length === 0) return null
    const W = 360, H = 80
    const barW = Math.max(2, W / MAX_SAMPLES - 1)
    return (
      <svg width={W} height={H} style={{ display: 'block', margin: '8px 0' }}>
        {latencyHistory.map((v, i) => {
          const barH = Math.min(H, (v / 150) * H)
          const color = v < 50 ? '#3ecf8e' : v < 100 ? '#e8a23a' : '#e84040'
          return <rect key={i} x={i * (barW + 1)} y={H - barH} width={barW} height={barH} fill={color} rx={1} />
        })}
        <line x1={0} y1={H - (50 / 150) * H} x2={W} y2={H - (50 / 150) * H} stroke="#3ecf8e" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.4} />
        <line x1={0} y1={H - (100 / 150) * H} x2={W} y2={H - (100 / 150) * H} stroke="#e84040" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.4} />
        <text x={W - 2} y={H - (50 / 150) * H - 2} fontSize={8} fill="#3ecf8e" textAnchor="end">50ms</text>
        <text x={W - 2} y={H - (100 / 150) * H - 2} fontSize={8} fill="#e84040" textAnchor="end">100ms</text>
      </svg>
    )
  }

  const rttColor = (v) => v == null ? '#555' : v < 50 ? '#3ecf8e' : v < 100 ? '#e8a23a' : '#e84040'
  const badge = bufferBadge()

  const handleClose = () => {
    if (isElectron && window.electronAPI?.closeWindow) {
      window.electronAPI.closeWindow()
    }
  }

  // ── デバイス選択画面 ──────────────────────────────────
  if (isElectron && !deviceReady) {
    return (
      <div style={S.wrap}>
        <div style={S.titleBar}>
          <span style={S.titleBarTitle}>OTO — SESSION PLATFORM</span>
          <div style={S.closeBtn} onClick={handleClose}>✕</div>
        </div>
        <div style={S.body}>
          <div style={S.side}>
            <div style={S.brand}>
              <div style={S.brandName}>OTO</div>
              <div style={S.brandTag}>SESSION PLATFORM</div>
            </div>
          </div>
          <div style={S.main}>
            <div style={S.pgTitle}>AUDIO SETUP</div>
            <div style={S.pgSub}>デバイスを選択してセッションを開始</div>

            <div style={S.sec}>
              <div style={S.secLabel}>INPUT DEVICE</div>
              <div style={S.card}>
                {devices.length === 0 ? (
                  <div style={{ padding: '20px' }}>
                    <div style={{ fontSize: '13px', color: '#888', marginBottom: '16px' }}>ASIOデバイスが見つかりませんでした</div>
                    <button onClick={handleNoBrowserStart} style={{ width: '100%', padding: '12px', fontSize: '13px', cursor: 'pointer', background: '#1a0808', color: '#e84040', border: '0.5px solid #e84040', borderRadius: '8px' }}>
                      通常マイクで開始
                    </button>
                  </div>
                ) : (
                  <>
                    {devices.map((device, i) => (
                      <div key={device.id} onClick={() => handleDeviceSelect(device)} style={{
                        ...(i === devices.length - 1 ? S.rowLast : S.row),
                        cursor: 'pointer',
                        background: selectedDevice?.id === device.id ? '#1a1a1a' : 'transparent',
                      }}>
                        <div>
                          <div style={S.rl}>{device.name}</div>
                          <div style={S.rs}>{device.type} · {device.preferredSampleRate}Hz</div>
                        </div>
                        <span style={device.type === 'ASIO' ? S.badgeAsio : S.badgeWarn}>{device.type}</span>
                      </div>
                    ))}
                    <div style={{ padding: '12px 20px', borderTop: '0.5px solid #161616' }}>
                      <span style={{ fontSize: '12px', color: '#555', cursor: 'pointer' }} onClick={handleNoBrowserStart}>通常マイクを使う</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div style={S.sec}>
              <div style={S.secLabel}>BUFFER SIZE</div>
              <div style={S.latBlock}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', marginBottom: '6px' }}>
                  <span style={S.latNum}>{latencyEstimateMs()}</span>
                  <span style={S.latUnit}>ms</span>
                  <span style={{ ...badge.style, marginLeft: '8px', marginBottom: '8px' }}>{badge.text}</span>
                </div>
                <div style={S.latSub}>推定片道遅延（ASIOバッファ + 処理）</div>
                <div style={S.bufRow}>
                  {[64, 128, 256, 512].map(size => (
                    <div key={size} style={S.bb(bufferSize === size)} onClick={() => setBufferSize(size)}>{size}</div>
                  ))}
                </div>
              </div>
            </div>

            <div style={S.sec}>
              <div style={S.secLabel}>ABOUT OTO</div>
              <div style={S.card}>
                {[
                  ['レイテンシー', '最小2ms RTT（同一LAN）'],
                  ['プロトコル', 'WebRTC Opus / P2P'],
                  ['推奨環境', 'ASIO対応オーディオIF + 有線LAN'],
                  ['バージョン', 'v0.1.0'],
                ].map(([label, val], i, arr) => (
                  <div key={label} style={i === arr.length - 1 ? S.rowLast : S.row}>
                    <div style={S.rl}>{label}</div>
                    <span style={S.rv}>{val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── メイン画面 ────────────────────────────────────────
  return (
    <div style={S.wrap}>
      <div style={S.titleBar}>
        <span style={S.titleBarTitle}>OTO — SESSION PLATFORM</span>
        <div style={S.closeBtn} onClick={handleClose}>✕</div>
      </div>
      <div style={S.body}>
        <div style={S.side}>
          <div style={S.brand}>
            <div style={S.brandName}>OTO</div>
            <div style={S.brandTag}>SESSION PLATFORM</div>
          </div>
          <div style={S.nav}>
            <div style={S.ni(page === 'session')} onClick={() => setPage('session')}>セッション</div>
            <div style={S.ni(page === 'settings')} onClick={() => setPage('settings')}>
              オーディオ設定
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#e84040', marginLeft: 'auto' }} />
            </div>
            <div style={S.ni(page === 'status')} onClick={() => setPage('status')}>接続状態</div>
          </div>
        </div>

        <div style={S.main}>

          {page === 'session' && (
            <>
              <div style={S.pgTitle}>SESSION</div>
              <div style={S.pgSub}>URLを送って、一緒に弾こう。</div>

              <div style={S.sec}>
                <div style={S.secLabel}>CONNECTION</div>
                <div style={S.card}>
                  <div style={S.row}>
                    <div style={S.rl}>状態</div>
                    <span style={isCallActive ? S.badgeOk : S.badgeWarn}>{isCallActive ? '通話中' : connectionStatus}</span>
                  </div>
                  <div style={S.row}>
                    <div style={S.rl}>自分のID</div>
                    <span style={S.rv}>{myId || '...'}</span>
                  </div>
                  {peerId && (
                    <div style={S.row}>
                      <div style={S.rl}>相手のID</div>
                      <span style={S.rv}>{peerId}</span>
                    </div>
                  )}
                  {isElectron && (
                    <div style={S.rowLast}>
                      <div style={S.rl}>オーディオ</div>
                      <span style={useNative ? S.badgeAsio : S.badgeWarn}>{useNative ? (selectedDevice?.name || 'ASIO') : 'マイク'}</span>
                    </div>
                  )}
                </div>
              </div>

              {!peerId && !isCallActive && (
                <div style={S.sec}>
                  <div style={S.secLabel}>HOW TO SESSION</div>
                  <div style={S.card}>
                    {[
                      ['① URLを共有', 'このアプリのURLを相手に送る'],
                      ['② 相手が接続', '相手が同じURLを開いて待機'],
                      ['③ CALL を押す', '相手が見つかったら発信する'],
                      ['④ 一緒に弾く', '最低遅延でリアルタイムセッション'],
                    ].map(([label, val], i, arr) => (
                      <div key={label} style={i === arr.length - 1 ? S.rowLast : S.row}>
                        <div style={S.rl}>{label}</div>
                        <span style={S.rv}>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && <div style={{ fontSize: '12px', color: '#e84040', marginBottom: '16px' }}>{error}</div>}

              {peerId && !isCallActive && (
                <div style={S.sec}>
                  <button onClick={callPeer} style={{
                    width: '100%', padding: '14px', fontSize: '14px', cursor: 'pointer',
                    background: '#1a0808', color: '#e84040', border: '0.5px solid #e84040',
                    borderRadius: '10px', letterSpacing: '1px',
                  }}>
                    CALL →
                  </button>
                </div>
              )}

              {isCallActive && (
                <div style={S.sec}>
                  <div style={S.secLabel}>LATENCY — DataChannel RTT</div>
                  <div style={S.latBlock}>
                    <div style={{ display: 'flex', gap: '24px', marginBottom: '16px' }}>
                      <div>
                        <div style={{ fontSize: '48px', fontWeight: 500, color: rttColor(latestRtt), lineHeight: 1 }}>{latestRtt != null ? latestRtt : '--'}</div>
                        <div style={{ fontSize: '10px', color: '#888', letterSpacing: '1px', marginTop: '4px' }}>LATEST RTT (ms)</div>
                      </div>
                      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', paddingBottom: '20px' }}>
                        {[['AVG', avgRtt], ['MIN', minRtt], ['MAX', maxRtt]].map(([label, val]) => (
                          <div key={label} style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '22px', fontWeight: 500, color: rttColor(val) }}>{val != null ? val : '--'}</div>
                            <div style={{ fontSize: '10px', color: '#888', letterSpacing: '1px' }}>{label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {renderGraph()}
                    <div style={{ fontSize: '10px', color: '#777', marginTop: '8px', marginBottom: '12px' }}>
                      緑 &lt;50ms ／ 黄 50〜100ms ／ 赤 &gt;100ms ／ RTT = 往復（片道はおよそ÷2）
                    </div>
                    <button onClick={measuring ? stopMeasuring : startMeasuring} style={{
                      padding: '8px 20px', fontSize: '12px', cursor: 'pointer',
                      background: measuring ? '#1a1a1a' : '#1a0808',
                      color: measuring ? '#666' : '#e84040',
                      border: '0.5px solid ' + (measuring ? '#333' : '#e84040'),
                      borderRadius: '8px', letterSpacing: '.5px',
                    }}>
                      {measuring ? '⏹ 計測停止' : '▶ 計測開始'}
                    </button>
                  </div>
                  {useNative && ipcLatency != null && (
                    <div style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>
                      ASIOチャンク間隔：<span style={{ color: ipcLatency < 15 ? '#3ecf8e' : '#e8a23a' }}>約{ipcLatency}ms</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {page === 'settings' && (
            <>
              <div style={S.pgTitle}>AUDIO SETTINGS</div>
              <div style={S.pgSub}>最低遅延のためにインターフェイスを設定</div>

              <div style={S.sec}>
                <div style={S.secLabel}>INPUT DEVICE</div>
                <div style={S.card}>
                  <div style={S.row}>
                    <div>
                      <div style={S.rl}>デバイス</div>
                      <div style={S.rs}>{selectedDevice?.name || 'マイク'}</div>
                    </div>
                    <span style={useNative ? S.badgeAsio : S.badgeWarn}>{useNative ? 'ASIO' : 'WDM'}</span>
                  </div>
                  <div style={S.rowLast}>
                    <div style={S.rl}>サンプリングレート</div>
                    <span style={S.rv}>{selectedDevice?.preferredSampleRate || 48000} Hz</span>
                  </div>
                </div>
              </div>

              <div style={S.sec}>
                <div style={S.secLabel}>BUFFER SIZE</div>
                <div style={S.latBlock}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', marginBottom: '6px' }}>
                    <span style={S.latNum}>{latencyEstimateMs()}</span>
                    <span style={S.latUnit}>ms</span>
                    <span style={{ ...badge.style, marginLeft: '8px', marginBottom: '8px' }}>{badge.text}</span>
                  </div>
                  <div style={S.latSub}>推定片道遅延（ASIOバッファ + 処理）</div>
                  <div style={S.bufRow}>
                    {[64, 128, 256, 512].map(size => (
                      <div key={size} style={S.bb(bufferSize === size)} onClick={() => setBufferSize(size)}>{size}</div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={S.sec}>
                <div style={S.secLabel}>VOLUME</div>
                <div style={S.card}>
                  <div style={S.row}>
                    <div style={S.rl}>入力ゲイン</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <Meter bars={meterBars} />
                      <input type="range" min="0" max="100" value={inputGain}
                        onChange={e => setInputGain(Number(e.target.value))}
                        style={{ width: '80px', accentColor: '#e84040' }} />
                      <span style={S.rv}>{inputGain}%</span>
                    </div>
                  </div>
                  <div style={S.row}>
                    <div style={S.rl}>出力音量</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <input type="range" min="0" max="100" value={outputVolume}
                        onChange={e => setOutputVolume(Number(e.target.value))}
                        style={{ width: '80px', accentColor: '#e84040' }} />
                      <span style={S.rv}>{outputVolume}%</span>
                    </div>
                  </div>
                  <div style={S.rowLast}>
                    <div>
                      <div style={S.rl}>自分の音をモニター</div>
                      <div style={S.rs}>自分の演奏をスピーカーで聞く</div>
                    </div>
                    <Toggle checked={monitor} onChange={e => setMonitor(e.target.checked)} />
                  </div>
                </div>
              </div>
            </>
          )}

          {page === 'status' && (
            <>
              <div style={S.pgTitle}>CONNECTION STATUS</div>
              <div style={S.pgSub}>ネットワークとセッションの状態</div>
              <div style={S.sec}>
                <div style={S.card}>
                  {[
                    ['シグナリングサーバー', connectionStatus.includes('エラー') ? '❌ エラー' : '✅ 接続中'],
                    ['WebRTC', isCallActive ? '✅ 通話中' : '待機中'],
                    ['自分のID', myId || '...'],
                    ['相手のID', peerId || 'なし'],
                    ['RTT（最新）', latestRtt != null ? latestRtt + ' ms' : '--'],
                    ['RTT（平均）', avgRtt != null ? avgRtt + ' ms' : '--'],
                  ].map(([label, val], i, arr) => (
                    <div key={label} style={i === arr.length - 1 ? S.rowLast : S.row}>
                      <div style={S.rl}>{label}</div>
                      <span style={S.rv}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

        </div>
      </div>
      <audio ref={remoteAudioRef} autoPlay playsInline />
    </div>
  )
}

export default App
