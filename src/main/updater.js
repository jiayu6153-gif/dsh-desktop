'use strict'

const { app, dialog, Notification } = require('electron')

let autoUpdater = null

function ensure() {
  if (!app.isPackaged) return null
  if (autoUpdater) return autoUpdater
  try {
    const { autoUpdater: au } = require('electron-updater')
    autoUpdater = au
    au.autoDownload = true
    au.autoInstallOnAppQuit = true
    au.on('update-downloaded', (info) => {
      if (Notification.isSupported()) {
        new Notification({
          title: 'DeepSeek Harness Desktop',
          body: `新版本 ${info.version} 已下载，退出应用后自动安装`
        }).show()
      }
    })
    au.on('error', (err) => console.log('[updater]', err.message))
    return au
  } catch (err) {
    console.log('[updater] 加载失败:', err.message)
    return null
  }
}

function check() {
  const au = ensure()
  if (!au) {
    dialog.showMessageBox({
      type: 'info',
      title: '检查更新',
      message: '开发模式不检查更新。\n打包安装版后将从 GitHub Releases 自动检查新版本。'
    })
    return
  }
  au.checkForUpdatesAndNotify().catch((err) => console.log('[updater]', err.message))
}

module.exports = { check, ensure }
