const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('electronAPI', {
  getAudioDevices: () => ipcRenderer.invoke('get-audio-devices'),
  startAudio: (deviceId) => ipcRenderer.invoke('start-audio', deviceId),
  stopAudio: () => ipcRenderer.invoke('stop-audio'),
  onAudioData: (callback) => {
    ipcRenderer.removeAllListeners('audio-data')
    ipcRenderer.on('audio-data', (event, data) => callback(data))
  },
  startAudioOutput: () => ipcRenderer.invoke('start-audio-output'),
  stopAudioOutput: () => ipcRenderer.invoke('stop-audio-output'),
  playAudio: (buffer) => ipcRenderer.send('audio-play', buffer),
  closeWindow: () => ipcRenderer.invoke('close-window'),
})
