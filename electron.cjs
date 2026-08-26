const { app, BrowserWindow, ipcMain } = require('electron')
const { RtAudio, RtAudioApi } = require('audify')

let mainWindow
let rtAudio = null
let isStreaming = false

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

ipcMain.handle('start-audio', () => {
  try {
    if (isStreaming) return
    rtAudio = new RtAudio(RtAudioApi.WINDOWS_ASIO)
    rtAudio.openStream(
      undefined,
      { deviceId: 130, nChannels: 1 },
      2,
      44100,
      256,
      'MusicMusic',
      (pcmBuffer) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('audio-data', pcmBuffer)
        }
      },
      null,
      null,
      (type, msg) => { console.error('ASIOエラー', msg) }
    )
    rtAudio.start()
    isStreaming = true
    console.log('ASIO開始 ZOOM AMS-22 256samples@44100Hz')
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

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  try {
    if (rtAudio && isStreaming) { rtAudio.stop(); rtAudio.closeStream() }
  } catch (e) {}
  if (process.platform !== 'darwin') app.quit()
})
