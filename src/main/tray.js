'use strict'

const { Tray, Menu, nativeImage } = require('electron')
const path = require('path')

function createTray(opts) {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon-32.png')
  const tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('DeepSeek Harness Desktop')

  function rebuild() {
    const menu = Menu.buildFromTemplate([
      { label: '打开主窗口', click: () => opts.onShow() },
      { label: '插件市场', click: () => opts.onOpenMarket() },
      { type: 'separator' },
      { label: '复制访问地址', enabled: opts.isKernelUp(), click: () => opts.onCopyUrl() },
      { label: opts.isKernelUp() ? '暂停内核' : '启动内核', click: () => opts.onToggleKernel() },
      { type: 'separator' },
      { label: '检查更新', click: () => opts.onCheckUpdate() },
      { label: '开机自启', type: 'checkbox', checked: opts.isAutostart(), click: (item) => opts.onToggleAutostart(item.checked) },
      { type: 'separator' },
      { label: '退出', click: () => opts.onQuit() }
    ])
    tray.setContextMenu(menu)
  }

  rebuild()
  tray.on('click', () => opts.onShow())
  return { tray, rebuild }
}

module.exports = { createTray }
