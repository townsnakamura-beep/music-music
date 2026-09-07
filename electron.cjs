const { app, BrowserWindow, ipcMain } = require('electron')
const { RtAudio, RtAudioApi } = require('audify')
const path = require('path')

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
    const indexPath = path.join(__dirname, 'dist/index.html')
    mainWindow.loadFile(indexPath)
  } else {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      setTimeout(() => mainWindow.loadURL('http://localhost:5173'), 3000)
    })
  }
}

ipcMain.handle('close-window', () => {
  if (mainWindow) mainWindow.close()
})

ipcMain.handle('get-audio-devices', () => {
  const devices = []

  try {
    const rt = new RtAudio(RtAudioApi.WINDOWS_ASIO)
    rt.getDevices().forEach(d => {
      if (d.inputChannels > 0) {
        devices.push({
          id: d.id,
          name: d.name,
          type: 'ASIO',
          sampleRates: d.sampleRates,
          preferredSampleRate: d.preferredSampleRate,
        })
      }
    })
  } catch (err) {
    console.warn('ASIOスキャン失敗:', err.message)
  }

  try {
    const rt = new RtAudio(RtAudioApi.WINDOWS_DS)
    rt.getDevices().forEach(d => {
      if (d.inputChannels > 0 && d.isDefaultInput) {
        devices.push({
          id: d.id,
          name: 'デフォルトマイク',
          type: 'WDM',
          sampleRates: d.sampleRates,
          preferredSampleRate: d.preferredSampleRate,
        })
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
    const { id, type, sampleRate } = deviceInfo || { id: 130, type: 'ASIO', sampleRate: 48000 }
    const api = type === 'ASIO' ? RtAudioApi.WINDOWS_ASIO : RtAudioApi.WINDOWS_DS
    rtAudio = new RtAudio(api)
    rtAudio.openStream(
      null,
      { deviceId: id, nChannels: 1 },
      2, sampleRate, 256, 'MusicMusic',
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
      null,
      2, 48000, 256, 'MusicMusicOut',
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
