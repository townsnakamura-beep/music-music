const { app, BrowserWindow, ipcMain } = require('electron')
const { RtAudio, RtAudioApi } = require('audify')

let mainWindow
let rtAudio = null
let isStreaming = false

// ── ASIO出力 ──────────────────────────────────────────────
let rtAudioOut = null
let isOutputStreaming = false
let outputQueue = Buffer.alloc(0)
// ──────────────────────────────────────────────────────────

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

// ── ASIO入力（既存） ──────────────────────────────────────
ipcMain.handle('start-audio', () => {
  try {
    if (isStreaming) return
    rtAudio = new RtAudio(RtAudioApi.WINDOWS_ASIO)
    rtAudio.openStream(
      null,
      { deviceId: 130, nChannels: 1 },
      2,
      44100,
      256,
      'MusicMusic',
      (pcmBuffer) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('audio-data', pcmBuffer)
        }
      }
    )
    rtAudio.start()
    isStreaming = true
    console.log('ASIO入力開始 ZOOM AMS-22 256samples@44100Hz')
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

// ── ASIO出力（新規追加） ──────────────────────────────────

ipcMain.handle('start-audio-output', () => {
  try {
    if (isOutputStreaming) return
    rtAudioOut = new RtAudio(RtAudioApi.WINDOWS_ASIO)
    rtAudioOut.openStream(
      { deviceId: 130, nChannels: 1 },
      null,
      2,
      44100,
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
    console.log('ASIO出力開始 ZOOM AMS-22 256samples@44100Hz')
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

// ──────────────────────────────────────────────────────────

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
