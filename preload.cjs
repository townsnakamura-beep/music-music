const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  startAudio: () => ipcRenderer.invoke('start-audio'),
  stopAudio: () => ipcRenderer.invoke('stop-audio'),
  onAudioData: (callback) => ipcRenderer.on('audio-data', (event, data) => callback(data)),
})