const { app, BrowserWindow, ipcMain } = require('electron')
const portAudio = require('naudiodon')

// チE�E��E�イス一覧確認用�E�E�E�確認後削除�E�E�E�E
console.log('=== Audio Devices ===')
console.log(JSON.stringify(portAudio.getDevices(), null, 2))

let mainWindow
let audioInput

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: __dirname + '/preload.cjs',
    },
    title: 'ミュージチE�E��E�ミュージチE�E��E�',
  })

  mainWindow.loadURL('http://localhost:5173').catch(() => {
    setTimeout(() => mainWindow.loadURL('http://localhost:5173'), 3000)
  })
}

ipcMain.handle('start-audio', () => {
  try {
    audioInput = new portAudio.AudioIO({
      inOptions: {
        channelCount: 1,
        sampleFormat: portAudio.SampleFormat16Bit,
        sampleRate: 44100,
        deviceId: -1,
        closeOnError: true,
      }
    })

    audioInput.on('data', (chunk) => {
      if (mainWindow) {
        mainWindow.webContents.send('audio-data', chunk)
      }
    })

    audioInput.on('error', (err) => {
      console.error('音声エラー:', err)
    })

    audioInput.start()
    console.log('naudiodon音声キャプチャ開姁EdeviceId: -1')
  } catch (err) {
    console.error('start-audio失敁E', err)
    throw err
  }
})

ipcMain.handle('stop-audio', () => {
  if (audioInput) {
    audioInput.quit()
    audioInput = null
    console.log('naudiodon音声キャプチャ停止')
  }
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (audioInput) audioInput.quit()
  if (process.platform !== 'darwin') app.quit()
})
