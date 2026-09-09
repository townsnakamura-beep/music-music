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
    // CPU使用率（前後100msで計測）
    const cpuStart = process.cpuUsage()
    const start = Date.now()
    while (Date.now() - start < 100) {}
    const cpuEnd = process.cpuUsage(cpuStart)
    const cpuPercent = Math.round((cpuEnd.user + cpuEnd.system) / 1000 / 100)

    // メモリ
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const freeMemGB = (freeMem / 1024 / 1024 / 1024).toFixed(1)

    // ネットワーク（有線/WiFi判別）
    const nets = os.networkInterfaces()
    let isWired = false
    let isWifi = false
    for (const name of Object.keys(nets)) {
      const lower = name.toLowerCase()
      if (lower.includes('ethernet') || lower.includes('eth') || lower.includes('local area')) {
        isWired = true
      }
      if (lower.includes('wi-fi') || lower.includes('wireless') || lower.includes('wlan')) {
        isWifi = true
      }
    }

    return {
      cpuPercent: Math.min(cpuPercent, 100),
      freeMemGB,
      totalMemGB: (totalMem / 1024 / 1024 / 1024).toFixed(1),
      isWired,
      isWifi,
      platform: os.platform(),
      release: os.release(),
    }
  } catch (err) {
    return { cpuPercent: 0, freeMemGB: '0', totalMemGB: '0', isWired: false, isWifi: false }
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
    console.log(`録音開始 deviceId:${id} type:${type} sampleRate:${sampleRate} bufferSize:${bufferSize}`)
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
