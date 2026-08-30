'use strict'

const { app, BrowserWindow, dialog, Notification, clipboard, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { createTray } = require('./tray')
const { Kernel } = require('./kernel')
const updater = require('./updater')

const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js')
const ICON_512 = path.join(__dirname, '..', '..', 'assets', 'icon-512.png')

// 固定应用名，保证开发与打包的 userData（配置/日志目录）一致
app.setName('dsh-desktop')

// 单实例锁：重复启动只唤起已有窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  run()
}

function run() {
  app.setAppUserModelId('com.dsh.desktop')

  const silentStart = process.argv.slice(1).includes('--silent')

  let mainWindow = null
  let splashWindow = null
  let marketWindow = null
  let trayApi = null
  let kernel = null
  let quitting = false
  let kernelUp = false
  let baseUrl = ''
  let restartCount = 0

  const userData = app.getPath('userData')
  const configPath = path.join(userData, 'config.json')
  const logDir = path.join(userData, 'logs')

  fs.mkdirSync(logDir, { recursive: true })
  const logStream = fs.createWriteStream(path.join(logDir, 'main.log'), { flags: 'a' })
  const logLine = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`
    console.log(line)
    logStream.write(line + '\n')
  }

  const loadConfig = () => {
    try {
      // 剥 BOM：记事本等编辑器保存的 UTF-8 会带 EF BB BF，直接 JSON.parse 会失败
      const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')
      return JSON.parse(raw)
    } catch (err) {
      logLine(`config load failed (${configPath}): ${err.message}`)
      return {}
    }
  }
  const saveConfig = (cfg) => {
    try {
      fs.mkdirSync(userData, { recursive: true })
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2))
    } catch (err) { logLine('config save failed: ' + err.message) }
  }
  const resolveHarnessHome = () => loadConfig().harnessHome || path.join(os.homedir(), '.dsh')

  const sendSplash = (text) => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('kernel-status', text)
    }
  }
  const notify = (title, body) => {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  }

  // ---------- 窗口 ----------
  function createSplash() {
    if (splashWindow && !splashWindow.isDestroyed()) return
    splashWindow = new BrowserWindow({
      width: 400, height: 250,
      frame: false, transparent: true, resizable: false, movable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false,
      webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false }
    })
    splashWindow.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'))
    splashWindow.once('ready-to-show', () => { splashWindow.show() })
    splashWindow.on('closed', () => { splashWindow = null })
  }

  function closeSplash() {
    if (splashWindow && !splashWindow.isDestroyed()) { splashWindow.close(); splashWindow = null }
  }

  function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
    if (!kernelUp || !baseUrl) return null
    mainWindow = new BrowserWindow({
      width: 1280, height: 800, minWidth: 940, minHeight: 600,
      show: false, icon: ICON_512, autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    })
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost')) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: { webPreferences: { contextIsolation: true, nodeIntegration: false } }
        }
      }
      shell.openExternal(url)
      return { action: 'deny' }
    })
    mainWindow.loadURL(baseUrl)
    mainWindow.once('ready-to-show', () => {
      closeSplash()
      if (!silentStart) mainWindow.show()
    })
    mainWindow.on('close', (event) => {
      // 点 × 最小化到托盘，托盘“退出”才真正退出
      if (!quitting) { event.preventDefault(); mainWindow.hide() }
    })
    mainWindow.on('closed', () => { mainWindow = null })
    return mainWindow
  }

  function showMain() {
    if (kernelUp && (!mainWindow || mainWindow.isDestroyed())) createMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() }
  }

  function openMarket() {
    if (marketWindow && !marketWindow.isDestroyed()) { marketWindow.show(); marketWindow.focus(); return }
    marketWindow = new BrowserWindow({
      width: 920, height: 660, title: '插件市场 — DeepSeek Harness Desktop',
      icon: ICON_512, autoHideMenuBar: true,
      webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false }
    })
    marketWindow.loadFile(path.join(__dirname, '..', 'renderer', 'market.html'))
    marketWindow.on('closed', () => { marketWindow = null })
  }

  // ---------- 内核 ----------
  async function bootKernel() {
    if (kernelUp) return baseUrl
    sendSplash('正在分配随机端口…')
    const home = resolveHarnessHome()
    logLine(`userData=${userData} harnessHome=${home}`)
    kernel = new Kernel({
      dataDir: home,
      stabilityMs: 5000,
      onOutput: (line) => {
        logLine('[kernel] ' + line)
        if (line.trim()) sendSplash(line.trim().slice(0, 100))
      }
    })
    kernel.on('exit', (code, signal) => {
      kernelUp = false
      refreshTray()
      if (quitting) return
      logLine(`kernel exited (code=${code} signal=${signal})`)
      restartCount += 1
      if (restartCount > 5) {
        dialog.showErrorBox('DeepSeek Harness Desktop', '内核连续崩溃超过 5 次，已停止自动重启。\n日志位置：' + logDir)
        notify('DeepSeek Harness Desktop', '内核连续崩溃，已停止自动重启')
        return
      }
      notify('DeepSeek Harness Desktop', `内核意外退出，2 秒后自动重启（第 ${restartCount} 次）`)
      setTimeout(async () => {
        if (quitting) return
        try {
          await bootKernel()
          showMain()
        } catch (err) {
          logLine('kernel restart failed: ' + err.message)
        }
      }, 2000)
    })
    try {
      baseUrl = await kernel.start()
      kernelUp = true
      restartCount = 0
      logLine('kernel ready at ' + baseUrl)
      sendSplash('内核已就绪：' + baseUrl)
      refreshTray()
      return baseUrl
    } catch (err) {
      kernelUp = false
      throw err
    }
  }

  async function stopKernel() {
    if (!kernelUp && !kernel) return
    if (kernel) await kernel.stop()
    kernelUp = false
    baseUrl = ''
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.destroy(); mainWindow = null }
    refreshTray()
    logLine('kernel stopped by user')
  }

  // ---------- 托盘 ----------
  const refreshTray = () => { if (trayApi) trayApi.rebuild() }

  // 托盘必须在 app ready 之后创建
  function setupTray() {
    trayApi = createTray({
    isKernelUp: () => kernelUp,
    isAutostart: () => app.getLoginItemSettings().openAtLogin,
    onShow: showMain,
    onCopyUrl: () => {
      if (!baseUrl) return
      clipboard.writeText(baseUrl)
      notify('DeepSeek Harness Desktop', '访问地址已复制：' + baseUrl)
    },
    onToggleKernel: async () => {
      if (kernelUp) {
        await stopKernel()
      } else {
        try {
          await bootKernel()
          if (!silentStart) showMain()
        } catch (err) {
          dialog.showErrorBox('DeepSeek Harness Desktop', '内核启动失败：' + err.message)
        }
      }
    },
    onOpenMarket: openMarket,
    onCheckUpdate: () => updater.check(),
    onToggleAutostart: (value) => app.setLoginItemSettings({ openAtLogin: value }),
    onQuit: () => { quitting = true; app.quit() }
    })
  }

  // ---------- 插件市场 IPC ----------
  ipcMain.handle('market:fetch', async (_event, url) => {
    try {
      const { net } = require('electron')
      const res = await net.fetch(url)
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status }
      return { ok: true, data: await res.json() }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    }
  })

  ipcMain.handle('market:install', async (_event, item) => {
    try {
      if (!item || typeof item.url !== 'string' || !item.url) return { ok: false, error: '条目缺少下载地址' }
      const { net } = require('electron')
      const res = await net.fetch(item.url)
      if (!res.ok) return { ok: false, error: '下载失败 HTTP ' + res.status }
      const buf = Buffer.from(await res.arrayBuffer())
      const id = String(item.id || '').replace(/[^A-Za-z0-9._-]/g, '') || ('plugin-' + Date.now())
      const dest = path.join(resolveHarnessHome(), '.agent-presets', id)
      const tmpZip = path.join(app.getPath('temp'), `dsh-market-${id}-${Date.now()}.zip`)
      fs.writeFileSync(tmpZip, buf)
      const { execFile } = require('child_process')
      const psCmd = `Expand-Archive -LiteralPath '${tmpZip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`
      await new Promise((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { windowsHide: true }, (err) => (err ? reject(err) : resolve()))
      })
      try { fs.unlinkSync(tmpZip) } catch {}
      return { ok: true, dest }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    }
  })

  // ---------- 应用生命周期 ----------
  app.on('second-instance', () => { showMain() })

  // 常驻托盘：所有窗口关闭也不退出
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => { quitting = true })

  app.on('will-quit', () => {
    try { if (kernel) kernel.stop() } catch {}
    try { logStream.end() } catch {}
  })

  app.whenReady().then(async () => {
    logLine('app starting' + (silentStart ? ' (silent)' : ''))
    setupTray()
    createSplash()
    sendSplash('正在启动 DeepSeek Harness 内核…')
    try {
      await bootKernel()
      createMainWindow()
    } catch (err) {
      logLine('boot failed: ' + err.message)
      sendSplash('启动失败：' + err.message)
      dialog.showErrorBox('DeepSeek Harness Desktop', '内核启动失败：' + err.message + '\n\n日志：' + logDir)
      quitting = true
      app.quit()
    }
    if (app.isPackaged) {
      setTimeout(() => { try { updater.check() } catch {} }, 15000)
    }
  })
}
