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
  const [useAsioOutput, setUseAsioOutput] = useState(false)

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
  const audioContextRef = useRef(null)
  const trackGeneratorRef = useRef(null)
  const pingIntervalRef = useRef(null)
  const pendingPingsRef = useRef({})
  const latencyHistoryRef = useRef([])
  const asioOutputContextRef = useRef(null)
  const asioOutputWorkletRef = useRef(null)

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
