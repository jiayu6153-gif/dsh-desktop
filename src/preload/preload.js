'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shell', {
  onStatus: (cb) => ipcRenderer.on('kernel-status', (_event, text) => cb(text)),
  fetchMarket: (url) => ipcRenderer.invoke('market:fetch', url),
  installMarket: (item) => ipcRenderer.invoke('market:install', item)
})
