import { useState, useRef, useEffect, useCallback } from 'react'
import { io } from 'socket.io-client'
import './App.css'

const SIGNALING_SERVER_URL = 'https://music-music.onrender.com'

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

const MAX_SAMPLES = 60

function App() {
  const [connectionStatus, setConnectionStatus] = useState('未接続')
  const [myId, setMyId] = useState(null)
  const [peerId, setPeerId] = useState(null)
  const [isCallActive, setIsCallActive] = useState(false)
  const [error, setError] = useState(null)
  const [useNative, setUseNative] = useState(false)

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

  const isElectron = typeof window.electronAPI !== 'undefined'

  const ipcTimestampsRef = useRef([])
  const measureIpcLatency = useCallback((chunkReceivedAt) => {
    const ts = ipcTimestampsRef.current
    ts.push(chunkReceivedAt)
    if (ts.length > 20) ts.shift()
    if (ts.length >= 2) {
      const intervals = []
      for (let i = 1; i < ts.length; i++) {
        intervals.push(ts[i] - ts[i - 1])
      }
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
      setIpcLatency(Math.round(avg))
    }
  }, [])

  useEffect(() => {
    initAudio()

    const keepAlive = setInterval(() => {
      fetch('https://music-music.onrender.com/ping').catch(() => {})
    }, 30000)

    const socket = io(SIGNALING_SERVER_URL)
    socketRef.current = socket

    socket.on('connect', () => {
      setMyId(socket.id)
      setConnectionStatus('サーバーに接続済み・相手を待機中')
    })

    socket.on('connect_error', (err) => {
      setConnectionStatus('サーバー接続エラー')
      console.error('Socket.io接続エラー:', err)
    })

    socket.on('peer-available', (otherId) => {
      setPeerId(otherId)
      setConnectionStatus('相手を発見：' + otherId)
    })

    socket.on('offer', async ({ from, offer }) => {
      setPeerId(from)
      try {
        await setupPeerConnection(from)
        await peerConnectionRef.current.setRemoteDescription(offer)
        const answer = await peerConnectionRef.current.createAnswer()
        await peerConnectionRef.current.setLocalDescription(answer)
        socket.emit('answer', { to: from, answer })
      } catch (err) {
        setError('オファー処理エラー: ' + err.message)
      }
    })

    socket.on('answer', async ({ answer }) => {
      await peerConnectionRef.current.setRemoteDescription(answer)
    })

    socket.on('ice-candidate', async ({ candidate }) => {
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(candidate)
        } catch (err) {
          console.error('ICE candidate追加エラー:', err)
        }
      }
    })

    return () => {
      socket.disconnect()
      clearInterval(keepAlive)
      stopMeasuring()
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop())
      }
      if (isElectron && window.electronAPI) {
        window.electronAPI.stopAudio()
      }
    }
  }, [])

  const initAudio = async () => {
    if (isElectron && window.electronAPI) {
      try {
        const trackGenerator = new MediaStreamTrackGenerator({ kind: 'audio' })
        trackGeneratorRef.current = trackGenerator
        const stream = new MediaStream([trackGenerator])
        localStreamRef.current = stream

        const writer = trackGenerator.writable.getWriter()

        await window.electronAPI.startAudio()
        setUseNative(true)
        console.log('🚀 TrackGeneratorモード起動')

        window.electronAPI.onAudioData((chunk) => {
          const receivedAt = performance.now()
          measureIpcLatency(receivedAt)

          const int16 = new Int16Array(chunk.buffer || chunk)
          const float32 = new Float32Array(int16.length)
          for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768.0
          }

          const CHUNK_SIZE = 256
          for (let offset = 0; offset < float32.length; offset += CHUNK_SIZE) {
            const slice = float32.slice(offset, offset + CHUNK_SIZE)
            const audioData = new AudioData({
              format: 'f32',
              sampleRate: 44100,
              numberOfFrames: slice.length,
              numberOfChannels: 1,
              timestamp: (receivedAt + (offset / 44100) * 1000) * 1000,
              data: slice,
            })
            writer.write(audioData).catch(() => {})
          }
        })

      } catch (err) {
        console.warn('TrackGenerator失敗、フォールバック:', err)
        await initWebAudio()
      }
    } else {
      await initWebAudio()
    }
  }

  const initWebAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      localStreamRef.current = stream
    } catch (err) {
      console.warn('マイク取得失敗:', err.message)
    }
  }

  const setupPeerConnection = async (targetId) => {
    const pc = new RTCPeerConnection(ICE_SERVERS)
    peerConnectionRef.current = pc

    const dc = pc.createDataChannel('latency', { ordered: false, maxRetransmits: 0 })
    dataChannelRef.current = dc
    setupDataChannel(dc)

    pc.ondatachannel = (event) => {
      if (event.channel.label === 'latency') {
        setupDataChannel(event.channel)
      }
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current)
      })
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', { to: targetId, candidate: event.candidate })
      }
    }

    pc.ontrack = async (event) => {
      const remoteStream = event.streams[0]
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream
        remoteAudioRef.current.muted = false
        remoteAudioRef.current.play().catch(e => console.warn('再生エラー:', e))
      }

      try {
        const receivers = pc.getReceivers()
        receivers.forEach(receiver => {
          if (receiver.track.kind === 'audio') {
            if ('jitterBufferTarget' in receiver) {
              receiver.jitterBufferTarget = 0
            }
          }
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
    dc.onmessage = (event) => {
      const now = performance.now()
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'ping') {
          if (dc.readyState === 'open') {
            dc.send(JSON.stringify({ type: 'pong', id: msg.id, sentAt: msg.sentAt }))
          }
        } else if (msg.type === 'pong') {
          const rtt = now - msg.sentAt
          delete pendingPingsRef.current[msg.id]
          const history = [...latencyHistoryRef.current, Math.round(rtt)]
          if (history.length > MAX_SAMPLES) history.shift()
          latencyHistoryRef.current = history
          const min = Math.min(...history)
          const max = Math.max(...history)
          const avg = Math.round(history.reduce((a, b) => a + b, 0) / history.length)
          setLatestRtt(Math.round(rtt))
          setMinRtt(min)
          setMaxRtt(max)
          setAvgRtt(avg)
          setLatencyHistory([...history])
        }
      } catch (e) {}
    }
    dc.onopen = () => {
      console.log('DataChannel open')
      dataChannelRef.current = dc
    }
  }

  const startMeasuring = () => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') {
      setError('DataChannelがまだ開いていません。通話接続後に計測してください。')
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
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current)
      pingIntervalRef.current = null
    }
  }

  const callPeer = async () => {
    if (!peerId) return
    try {
      await setupPeerConnection(peerId)
      const offer = await peerConnectionRef.current.createOffer()

      let sdp = offer.sdp
      sdp = sdp.replace(
        /a=fmtp:111 /g,
        'a=fmtp:111 ptime=10;minptime=10;useinbandfec=1;'
      )
      const modifiedOffer = { type: offer.type, sdp }

      await peerConnectionRef.current.setLocalDescription(modifiedOffer)
      socketRef.current.emit('offer', { to: peerId, offer: modifiedOffer })
    } catch (err) {
      setError('発信エラー: ' + err.message)
    }
  }

  const renderGraph = () => {
    if (latencyHistory.length === 0) return null
    const W = 320
    const H = 80
    const barW = Math.max(2, W / MAX_SAMPLES - 1)
    return (
      <svg width={W} height={H} style={{ display: 'block', margin: '8px auto' }}>
        {latencyHistory.map((v, i) => {
          const barH = Math.min(H, (v / 150) * H)
          const color = v < 50 ? '#48bb78' : v < 100 ? '#ecc94b' : '#fc8181'
          return (
            <rect key={i} x={i * (barW + 1)} y={H - barH} width={barW} height={barH} fill={color} rx={1} />
          )
        })}
        <line x1={0} y1={H - (50 / 150) * H} x2={W} y2={H - (50 / 150) * H} stroke="#48bb78" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.6} />
        <line x1={0} y1={H - (100 / 150) * H} x2={W} y2={H - (100 / 150) * H} stroke="#fc8181" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.6} />
        <text x={W - 2} y={H - (50 / 150) * H - 2} fontSize={8} fill="#48bb78" textAnchor="end">50ms</text>
        <text x={W - 2} y={H - (100 / 150) * H - 2} fontSize={8} fill="#fc8181" textAnchor="end">100ms</text>
      </svg>
    )
  }

  const statStyle = { fontSize: '13px', color: '#888', margin: '2px 0' }
  const valStyle = (v, good, warn) => ({
    fontWeight: 'bold',
    color: v == null ? '#888' : v < good ? '#48bb78' : v < warn ? '#ecc94b' : '#fc8181'
  })

  return (
    <div style={{ padding: '32px', fontFamily: 'sans-serif', maxWidth: '480px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '20px', marginBottom: '4px' }}>🎸 ミュージックミュージック</h1>
      <p style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>URLを送って、一緒に弾こう。</p>

      {isElectron && (
        <p style={{ fontSize: '12px', color: useNative ? '#48bb78' : '#888', margin: '4px 0' }}>
          {useNative ? '✅ ネイティブオーディオ（低遅延モード）' : 'Web Audioモード'}
        </p>
      )}

      <p style={{ marginTop: '12px' }}>状態：{connectionStatus}</p>
      <p style={{ fontSize: '12px', color: '#888' }}>自分のID：{myId}</p>
      {peerId && <p style={{ fontSize: '12px', color: '#888' }}>相手のID：{peerId}</p>}
      {error && <p style={{ color: '#fc8181', fontSize: '13px' }}>{error}</p>}

      {peerId && !isCallActive && (
        <button onClick={callPeer} style={{ fontSize: '16px', padding: '10px 24px', marginTop: '16px', cursor: 'pointer' }}>
          相手に発信する
        </button>
      )}

      {isCallActive && (
        <p style={{ color: '#48bb78', fontWeight: 'bold', marginTop: '16px' }}>✅ 通話接続中</p>
      )}

      {isCallActive && (
        <div style={{ marginTop: '24px', border: '1px solid #333', borderRadius: '10px', padding: '16px', background: '#111', color: '#eee' }}>
          <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '12px' }}>📡 遅延計測（DataChannel RTT）</div>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginBottom: '8px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '28px', fontWeight: 'bold', ...valStyle(latestRtt, 50, 100) }}>{latestRtt != null ? `${latestRtt}` : '--'}</div>
              <div style={statStyle}>最新 RTT (ms)</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '22px', fontWeight: 'bold', ...valStyle(avgRtt, 50, 100) }}>{avgRtt != null ? `${avgRtt}` : '--'}</div>
              <div style={statStyle}>平均</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#48bb78' }}>{minRtt != null ? `${minRtt}` : '--'}</div>
              <div style={statStyle}>最小</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#fc8181' }}>{maxRtt != null ? `${maxRtt}` : '--'}</div>
              <div style={statStyle}>最大</div>
            </div>
          </div>
          {renderGraph()}
          <div style={{ fontSize: '11px', color: '#555', textAlign: 'center', marginBottom: '10px' }}>
            緑 &lt; 50ms ／ 黄 50〜100ms ／ 赤 &gt; 100ms ／ RTT = 往復（片道はおよそ÷2）
          </div>
          {useNative && (
            <div style={{ borderTop: '1px solid #222', paddingTop: '10px', marginTop: '4px' }}>
              <div style={{ fontSize: '13px', color: '#aaa' }}>
                🎛 ASIOチャンク間隔：
                <span style={{ fontWeight: 'bold', color: ipcLatency ? (ipcLatency < 15 ? '#48bb78' : '#ecc94b') : '#888' }}>
                  {ipcLatency != null ? ` 約${ipcLatency}ms` : ' 計測中...'}
                </span>
              </div>
              <div style={{ fontSize: '10px', color: '#444', marginTop: '2px' }}>
                ※ ASIOが音声をchunkとして送ってくる間隔（bufferFrames÷sampleRate）
              </div>
            </div>
          )}
          <div style={{ marginTop: '12px', textAlign: 'center' }}>
            {!measuring ? (
              <button onClick={startMeasuring} style={{ padding: '8px 20px', fontSize: '13px', cursor: 'pointer', background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: '6px' }}>
                ▶ 計測開始
              </button>
            ) : (
              <button onClick={stopMeasuring} style={{ padding: '8px 20px', fontSize: '13px', cursor: 'pointer', background: '#555', color: '#fff', border: 'none', borderRadius: '6px' }}>
                ⏹ 計測停止
              </button>
            )}
          </div>
        </div>
      )}

      <audio ref={remoteAudioRef} autoPlay playsInline />
    </div>
  )
}

export default App
