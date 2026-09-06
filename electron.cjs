const { app, BrowserWindow, ipcMain } = require('electron')
const { RtAudio, RtAudioApi } = require('audify')

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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: __dirname + '/preload.cjs',
    },
    title: 'Music Music',
  })
  mainWindow.loadURL('http://localhost:5173').catch(() => {
    setTimeout(() => mainWindow.loadURL('http://localhost:5173'), 3000)
  })
}

// デバイス一覧取得
ipcMain.handle('get-audio-devices', () => {
  const devices = []

  // ASIOデバイスをスキャン
  try {
    const rt = new RtAudio(RtAudioApi.WINDOWS_ASIO)
    const asioDevices = rt.getDevices()
    asioDevices.forEach(d => {
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
    console.log(`ASIO デバイス ${devices.length}個検出`)
  } catch (err) {
    console.warn('ASIOスキャン失敗:', err.message)
  }

  // WDM（通常マイク）をスキャン
  try {
    const rt = new RtAudio(RtAudioApi.WINDOWS_DS)
    const wdmDevices = rt.getDevices()
    wdmDevices.forEach(d => {
      if (d.inputChannels > 0 && d.isDefaultInput) {
        devices.push({
          id: d.id,
          name: d.name + '（通常マイク）',
          type: 'WDM',
          sampleRates: d.sampleRates,
          preferredSampleRate: d.preferredSampleRate,
        })
      }
    })
    console.log('WDM デフォルトデバイス追加')
  } catch (err) {
    console.warn('WDMスキャン失敗:', err.message)
  }

  return devices
})

// ASIO入力開始（deviceIdとtypeを受け取る）
ipcMain.handle('start-audio', (event, deviceInfo) => {
  try {
    if (isStreaming) return
    const { id, type, sampleRate } = deviceInfo || { id: 130, type: 'ASIO', sampleRate: 48000 }

    const api = type === 'ASIO' ? RtAudioApi.WINDOWS_ASIO : RtAudioApi.WINDOWS_DS
    rtAudio = new RtAudio(api)
    rtAudio.openStream(
      null,
      { deviceId: id, nChannels: 1 },
      2,
      sampleRate,
      256,
      'MusicMusic',
      (pcmBuffer) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          const ab = pcmBuffer.buffer.slice(
            pcmBuffer.byteOffset,
            pcmBuffer.byteOffset + pcmBuffer.byteLength
          )
          mainWindow.webContents.send('audio-data', ab)
        }
      }
    )
    rtAudio.start()
    isStreaming = true
    console.log(`録音開始 deviceId:${id} type:${type} sampleRate:${sampleRate}`)
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
      2,
      48000,
      256,
      'MusicMusicOut',
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
