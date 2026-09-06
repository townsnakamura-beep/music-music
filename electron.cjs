const { app, BrowserWindow, ipcMain } = require('electron')
const { RtAudio, RtAudioApi } = require('audify')
const path = require('path')          // ← 追加

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

  // ↓ ここが変更点
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      setTimeout(() => mainWindow.loadURL('http://localhost:5173'), 3000)
    })
  }
}
