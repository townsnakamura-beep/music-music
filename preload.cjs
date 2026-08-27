const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 既存
  startAudio: () => ipcRenderer.invoke('start-audio'),
  stopAudio: () => ipcRenderer.invoke('stop-audio'),
  onAudioData: (callback) => ipcRenderer.on('audio-data', (event, data) => callback(data)),

  // 新規追加：ASIO出力
  startAudioOutput: () => ipcRenderer.invoke('start-audio-output'),
  stopAudioOutput: () => ipcRenderer.invoke('stop-audio-output'),
  audioPlay: (pcmBuffer) => ipcRenderer.send('audio-play', pcmBuffer),
})
