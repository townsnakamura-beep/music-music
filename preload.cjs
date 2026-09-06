const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // デバイス一覧取得
  getAudioDevices: () => ipcRenderer.invoke('get-audio-devices'),

  // 録音開始（deviceIdを指定）
  startAudio: (deviceId) => ipcRenderer.invoke('start-audio', deviceId),
  stopAudio: () => ipcRenderer.invoke('stop-audio'),

  // PCMデータ受信
  onAudioData: (callback) => {
    ipcRenderer.removeAllListeners('audio-data')
    ipcRenderer.on('audio-data', (event, data) => callback(data))
  },

  // ASIO出力
  startAudioOutput: () => ipcRenderer.invoke('start-audio-output'),
  stopAudioOutput: () => ipcRenderer.invoke('stop-audio-output'),
  playAudio: (buffer) => ipcRenderer.send('audio-play', buffer),
})
