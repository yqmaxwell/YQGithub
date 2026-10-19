const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jardiffBridge', {
  chooseJar: (title) => ipcRenderer.invoke('dialog:choose-jar', title),
  chooseDirectory: (title) => ipcRenderer.invoke('dialog:choose-directory', title),
  chooseFile: (title) => ipcRenderer.invoke('dialog:choose-file', title)
})
