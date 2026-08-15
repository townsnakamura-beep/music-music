import { useState, useRef, useEffect } from 'react'
import { io } from 'socket.io-client'
import './App.css'

const SIGNALING_SERVER_URL = 'https://music-music.onrender.com'

const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

function App() {
  const [connectionStatus, setConnectionStatus] = useState('未接続')
  const [myId, setMyId] = useState(null)
  const [peerId, setPeerId] = useState(null)
  const [isCallActive, setIsCallActive] = useState(false)
  const [error, setError] = useState(null)
  const [localVolume, setLocalVolume] = useState(0)
  const [remoteVolume, setRemoteVolume] = useState(0)

  const socketRef = useRef(null)
  const peerConnectionRef = useRef(null)
  const localStreamRef = useRef(null)
  const remoteAudioRef = useRef(null)
  const audioContextRef = useRef(null)
  const localAnalyserRef = useRef(null)
  const remoteAnalyserRef = useRef(null)
  const animationRef = useRef(null)

  useEffect(() => {
    const socket = io(SIGNALING_SERVER_URL)
    socketRef.current = socket

    socket.on('connect', () => {
      setMyId(socket.id)
      setConnectionStatus('サーバーに接続済み・相手を待機中')
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
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [])

  const setupPeerConnection = async (targetId) => {
    if (!localStreamRef.current) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      localStreamRef.current = stream
    }

    const pc = new RTCPeerConnection(ICE_SERVERS)
    peerConnectionRef.current = pc

    localStreamRef.current.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current)
    })

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', {
          to: targetId,
          candidate: event.candidate,
        })
      }
    }

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0]
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream
      }
      setupAnalysers(remoteStream)
      setIsCallActive(true)
      setConnectionStatus('通話中')
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setConnectionStatus('接続が切断されました')
        setIsCallActive(false)
      }
    }
  }

  const callPeer = async () => {
    if (!peerId) return
    try {
      await setupPeerConnection(peerId)
      const offer = await peerConnectionRef.current.createOffer()
      await peerConnectionRef.current.setLocalDescription(offer)
      socketRef.current.emit('offer', { to: peerId, offer })
    } catch (err) {
      setError('発信エラー: ' + err.message)
    }
  }

  const setupAnalysers = (remoteStream) => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'interactive',
    })
    audioContextRef.current = audioContext

    const remoteSource = audioContext.createMediaStreamSource(remoteStream)
    const remoteAnalyser = audioContext.createAnalyser()
    remoteAnalyser.fftSize = 2048
    remoteSource.connect(remoteAnalyser)
    remoteAnalyserRef.current = remoteAnalyser

    if (localStreamRef.current) {
      const localSource = audioContext.createMediaStreamSource(localStreamRef.current)
      const localAnalyser = audioContext.createAnalyser()
      localAnalyser.fftSize = 2048
      localSource.connect(localAnalyser)
      localAnalyserRef.current = localAnalyser
    }

    updateVolumes()
  }

  const getRms = (analyser) => {
    if (!analyser) return 0
    const dataArray = new Uint8Array(analyser.fftSize)
    analyser.getByteTimeDomainData(dataArray)
    let sum = 0
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128
      sum += normalized * normalized
    }
    return Math.sqrt(sum / dataArray.length)
  }

  const updateVolumes = () => {
    setLocalVolume(getRms(localAnalyserRef.current))
    setRemoteVolume(getRms(remoteAnalyserRef.current))
    animationRef.current = requestAnimationFrame(updateVolumes)
  }

  return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <h1>🎸 ミュージックミュージック</h1>
      <p>URLを送って、一緒に弾こう。</p>
      <p style={{ marginTop: '20px' }}>状態：{connectionStatus}</p>
      <p style={{ fontSize: '12px', color: '#888' }}>自分のID：{myId}</p>
      {peerId && <p style={{ fontSize: '12px', color: '#888' }}>相手のID：{peerId}</p>}

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {peerId && !isCallActive && (
        <button onClick={callPeer} style={{ fontSize: '18px', padding: '10px 20px', marginTop: '20px' }}>
          相手に発信する
        </button>
      )}

      {isCallActive && (
        <>
          <p style={{ color: 'green', fontWeight: 'bold', marginTop: '20px' }}>✅ 通話接続中</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '40px', marginTop: '20px' }}>
            <div>
              <p>自分のマイク</p>
              <div style={{ width: '150px', height: '20px', background: '#333', borderRadius: '6px' }}>
                <div style={{ width: `${Math.min(localVolume * 300, 100)}%`, height: '100%', background: '#48bb78', borderRadius: '6px' }} />
              </div>
            </div>
            <div>
              <p>相手から届いた音</p>
              <div style={{ width: '150px', height: '20px', background: '#333', borderRadius: '6px' }}>
                <div style={{ width: `${Math.min(remoteVolume * 300, 100)}%`, height: '100%', background: '#4299e1', borderRadius: '6px' }} />
              </div>
            </div>
          </div>
          <p style={{ marginTop: '20px', fontSize: '14px', color: '#888' }}>
            片方で声を出して、もう片方の「相手から届いた音」が反応するか確認してください
          </p>
        </>
      )}

      <audio ref={remoteAudioRef} autoPlay />
    </div>
  )
}

export default App