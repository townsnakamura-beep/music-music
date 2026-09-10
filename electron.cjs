const { app, BrowserWindow, ipcMain } = require('electron')
const { RtAudio, RtAudioApi } = require('audify')
const path = require('path')
const os = require('os')

let mainWindow
let rtAudio = null
let isStreaming = false
let rtAudioOut = null
let isOutputStreaming = false
let outputQueue = Buffer.alloc(0)

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: __dirname + '/preload.cjs',
    },
    title: 'OTO',
  })

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'))
  } else {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      setTimeout(() => mainWindow.loadURL('http://localhost:5173'), 3000)
    })
  }
}

ipcMain.handle('close-window', () => {
  if (mainWindow) mainWindow.close()
})

ipcMain.handle('get-system-info', () => {
  try {
    const cpuStart = process.cpuUsage()
    const start = Date.now()
    while (Date.now() - start < 100) {}
    const cpuEnd = process.cpuUsage(cpuStart)
    const cpuPercent = Math.min(Math.round((cpuEnd.user + cpuEnd.system) / 1000 / 100), 100)

    const totalMem = os.totalmem()
    const freeMem = os.freemem()

    // ネットワーク判別
    const nets = os.networkInterfaces()
    let connectionType = 'unknown' // wired / wifi / tethering / vpn / virtual / unknown

    for (const name of Object.keys(nets)) {
      const lower = name.toLowerCase()
      const iface = nets[name]
      const hasAddr = iface && iface.some(i => !i.internal && i.family === 'IPv4')
      if (!hasAddr) continue

      if (
        lower.includes('wi-fi') || lower.includes('wifi') ||
        lower.includes('wireless') || lower.includes('wlan') || lower.includes('無線')
      ) {
        if (connectionType === 'unknown') connectionType = 'wifi'
      } else if (
        lower.includes('tun') || lower.includes('tap') ||
        lower.includes('vpn') || lower.includes('nordvpn') ||
        lower.includes('expressvpn')
      ) {
        if (connectionType === 'unknown') connectionType = 'vpn'
      } else if (
        lower.includes('vmware') || lower.includes('virtualbox') ||
        lower.includes('hyper-v') || lower.includes('vethernet') ||
        lower.includes('docker')
      ) {
        if (connectionType === 'unknown') connectionType = 'virtual'
      } else if (
        lower.includes('rndis') || lower.includes('mobile') ||
        lower.includes('bluetooth') || lower.includes('bt')
      ) {
        if (connectionType === 'unknown') connectionType = 'tethering'
      } else {
        // WiFi・VPN・仮想・テザリング以外 → 有線とみなす
        connectionType = 'wired'
      }
    }

    return {
      cpuPercent,
      freeMemGB: (freeMem / 1024 / 1024 / 1024).toFixed(1),
      totalMemGB: (totalMem / 1024 / 1024 / 1024).toFixed(1),
      connectionType,
      platform: os.platform(),
      release: os.release(),
    }
  } catch (err) {
    return { cpuPercent: 0, freeMemGB: '0', totalMemGB: '0', connectionType: 'unknown' }
  }
})

ipcMain.handle('get-audio-devices', () => {
  const devices = []
  try {
    const rt = new RtAudio(RtAudioApi.WINDOWS_ASIO)
    rt.getDevices().forEach(d => {
      if (d.inputChannels > 0) {
        devices.push({ id: d.id, name: d.name, type: 'ASIO', sampleRates: d.sampleRates, preferredSampleRate: d.preferredSampleRate })
      }
    })
  } catch (err) {
    console.warn('ASIOスキャン失敗:', err.message)
  }
  try {
    const rt = new RtAudio(RtAudioApi.WINDOWS_DS)
    rt.getDevices().forEach(d => {
      if (d.inputChannels > 0 && d.isDefaultInput) {
        devices.push({ id: d.id, name: 'デフォルトマイク', type: 'WDM', sampleRates: d.sampleRates, preferredSampleRate: d.preferredSampleRate })
      }
    })
  } catch (err) {
    console.warn('WDMスキャン失敗:', err.message)
  }
  return devices
})

ipcMain.handle('start-audio', (event, deviceInfo) => {
  try {
    if (isStreaming) return
    const { id, type, sampleRate, bufferSize } = deviceInfo || { id: 130, type: 'ASIO', sampleRate: 48000, bufferSize: 128 }
    const api = type === 'ASIO' ? RtAudioApi.WINDOWS_ASIO : RtAudioApi.WINDOWS_DS
    rtAudio = new RtAudio(api)
    rtAudio.openStream(
      null,
      { deviceId: id, nChannels: 1 },
      2, sampleRate, bufferSize || 128, 'OTO',
      (pcmBuffer) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          const ab = pcmBuffer.buffer.slice(pcmBuffer.byteOffset, pcmBuffer.byteOffset + pcmBuffer.byteLength)
          mainWindow.webContents.send('audio-data', ab)
        }
      }
    )
    rtAudio.start()
    isStreaming = true
  } catch (err) {
    console.error('start-audio失敗:', err)
    throw err
  }
})

ipcMain.handle('stop-audio', () => {
  try {
    if (rtAudio && isStreaming) {
      rtAudio.stop()
      rtAudio.closeStream()
      rtAudio = null
      isStreaming = false
    }
  } catch (err) {}
})

ipcMain.handle('start-audio-output', () => {
  try {
    if (isOutputStreaming) return
    rtAudioOut = new RtAudio(RtAudioApi.WINDOWS_ASIO)
    rtAudioOut.openStream(
      { deviceId: 129, nChannels: 1 },
      null, 2, 48000, 256, 'OTOOut',
      (outputBuffer) => {
        const needed = outputBuffer.byteLength
        if (outputQueue.length >= needed) {
          outputQueue.copy(outputBuffer, 0, 0, needed)
          outputQueue = outputQueue.slice(needed)
        } else {
          outputBuffer.fill(0)
        }
      }
    )
    rtAudioOut.start()
    isOutputStreaming = true
  } catch (err) {
    console.error('start-audio-output失敗:', err)
    throw err
  }
})

ipcMain.handle('stop-audio-output', () => {
  try {
    if (rtAudioOut && isOutputStreaming) {
      rtAudioOut.stop()
      rtAudioOut.closeStream()
      rtAudioOut = null
      isOutputStreaming = false
      outputQueue = Buffer.alloc(0)
    }
  } catch (err) {}
})

ipcMain.on('audio-play', (event, pcmBuffer) => {
  if (isOutputStreaming) {
    outputQueue = Buffer.concat([outputQueue, Buffer.from(pcmBuffer)])
    const MAX_QUEUE_BYTES = 4410 * 2
    if (outputQueue.length > MAX_QUEUE_BYTES) {
      outputQueue = outputQueue.slice(outputQueue.length - MAX_QUEUE_BYTES)
    }
  }
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  try {
    if (rtAudio && isStreaming) { rtAudio.stop(); rtAudio.closeStream() }
  } catch (e) {}
  try {
    if (rtAudioOut && isOutputStreaming) { rtAudioOut.stop(); rtAudioOut.closeStream() }
  } catch (e) {}
  if (process.platform !== 'darwin') app.quit()
})
