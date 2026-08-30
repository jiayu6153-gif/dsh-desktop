'use strict'

// 开发诊断入口：捕获 main.js 的任何未捕获异常写入 crash.log
const { app } = require('electron')
app.setName('dsh-desktop')

const fs = require('fs')
process.on('uncaughtException', (e) => {
  try {
    fs.appendFileSync('crash.log', '[uncaught] ' + ((e && e.stack) || String(e)) + '\n')
  } catch {}
  try { app.exit(1) } catch {}
})
process.on('unhandledRejection', (e) => {
  try {
    fs.appendFileSync('crash.log', '[unhandled] ' + ((e && e.stack) || String(e)) + '\n')
  } catch {}
})

require('../src/main/main.js')
