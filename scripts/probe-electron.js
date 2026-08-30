'use strict'

// 逐阶段打点定位 Electron 启动卡点/异常
const { app, BrowserWindow } = require('electron')
const fs = require('fs')

const log = (m) => {
  const line = `[${Date.now()}] ${m}`
  fs.appendFileSync('probe.log', line + '\n')
  console.log(line)
}

process.on('uncaughtException', (e) => { log('UNCAUGHT: ' + (e && e.stack)) })
process.on('unhandledRejection', (e) => { log('UNHANDLED: ' + (e && e.stack)) })

log('module top')
const lock = app.requestSingleInstanceLock()
log('singleInstanceLock = ' + lock)
log('userData = ' + app.getPath('userData'))

app.on('render-process-gone', (_e, d) => log('render gone: ' + JSON.stringify(d)))
app.on('child-process-gone', (_e, d) => log('child gone: ' + JSON.stringify(d)))

app.whenReady().then(() => {
  log('app ready')
  const w = new BrowserWindow({ width: 400, height: 300, show: false })
  log('window created')
  w.loadURL('data:text/html,<h1>probe</h1>')
  w.webContents.once('did-finish-load', () => {
    log('page loaded')
    setTimeout(() => { log('PROBE OK'); app.exit(0) }, 500)
  })
  setTimeout(() => { log('TIMEOUT waiting page load'); app.exit(1) }, 30000)
}).catch((e) => log('ready failed: ' + (e && e.stack)))
