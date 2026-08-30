'use strict'

const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const net = require('net')
const path = require('path')
const fs = require('fs')

/**
 * 解析内核运行时 node 二进制：
 * - 打包版：安装包内附加资源 resources/node/node.exe（与 dsh 依赖树同版本构建，自包含）
 * - 开发版：PATH 中的系统 node
 * 不用 ELECTRON_RUN_AS_NODE：koffi 等原生模块按系统 Node 24 编译，Electron 内置 Node 22 会崩溃。
 */
function resolveNodeBinary() {
  let app = null
  try { app = require('electron').app } catch {}
  if (app && app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'node', 'node.exe')
    if (fs.existsSync(bundled)) return bundled
  }
  const candidates = [
    'node',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe')
  ]
  for (const c of candidates) {
    if (c === 'node') return c
    if (fs.existsSync(c)) return c
  }
  return 'node'
}

/** 解析 dsh CLI 入口：打包版走 resources/dsh（verbatim 复制），开发版走 node_modules。 */
function resolveDshBin() {
  let app = null
  try { app = require('electron').app } catch {}
  if (app && app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'dsh', 'lib', 'bin.js')
    if (fs.existsSync(bundled)) return bundled
  }
  const pkgPath = require.resolve('@deepseek-ai/dsh/package.json')
  const pkg = require(pkgPath)
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin && pkg.bin.dsh)
  if (!binRel) throw new Error('无法从 @deepseek-ai/dsh/package.json 解析 bin 入口')
  return path.join(path.dirname(pkgPath), binRel)
}

/** 向系统要一个当前空闲的 127.0.0.1 端口。 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

/** TCP 轮询直到内核在指定端口监听。 */
function waitForPort(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ host: '127.0.0.1', port })
      sock.setTimeout(1000)
      const fail = () => {
        sock.destroy()
        if (Date.now() > deadline) reject(new Error(`等待内核监听端口 ${port} 超时`))
        else setTimeout(attempt, 250)
      }
      sock.once('connect', () => { sock.destroy(); resolve() })
      sock.once('error', fail)
      sock.once('timeout', fail)
    }
    attempt()
  })
}

/**
 * 内核进程管理：随机端口拉起 dsh web。
 * 开发与打包统一走 ELECTRON_RUN_AS_NODE（electron 二进制即内置 Node），
 * 因此目标机器无需安装 Node。
 */
class Kernel extends EventEmitter {
  constructor({ dataDir, onOutput, stabilityMs = 5000 } = {}) {
    super()
    this.dataDir = dataDir
    this.onOutput = onOutput || (() => {})
    this.stabilityMs = stabilityMs
    this.child = null
    this.port = 0
    this.lastLines = []
  }

  get url() {
    return `http://127.0.0.1:${this.port}`
  }

  async start() {
    if (this.child) throw new Error('内核已在运行')
    this.port = await findFreePort()
    const bin = resolveDshBin()
    // --expose-internals 是 cordis-plugin-hmr 的硬性要求
    const args = ['--expose-internals', bin, 'web', '--host', '127.0.0.1', '--port', String(this.port), '--no-open']
    const env = { ...process.env }
    if (this.dataDir) env.DSH_HOME = this.dataDir
    this.child = spawn(resolveNodeBinary(), args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.emit('spawn', { pid: this.child.pid, port: this.port })

    const pipe = (stream) => {
      let buf = ''
      stream.on('data', (chunk) => {
        buf += chunk.toString()
        let idx
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, '')
          buf = buf.slice(idx + 1)
          if (line.trim()) {
            this.lastLines.push(line)
            if (this.lastLines.length > 8) this.lastLines.shift()
            this.onOutput(line)
          }
        }
      })
    }
    pipe(this.child.stdout)
    pipe(this.child.stderr)

    this.child.once('exit', (code, signal) => {
      // stop() 会先把 this.child 置空，只有意外退出才对外发 'exit'
      const intentional = this.child === null
      this.child = null
      if (!intentional) this.emit('exit', code, signal)
    })

    await waitForPort(this.port)
    // 就绪稳定性窗口：端口开了之后马上崩溃的启动不算成功（如缺少启动参数）
    if (this.stabilityMs > 0) {
      await new Promise((r) => setTimeout(r, this.stabilityMs))
      if (!this.child || this.child.exitCode !== null) {
        const tail = this.lastLines.slice(-3).join(' | ').slice(0, 300)
        throw new Error('内核在端口就绪后立即退出' + (tail ? '：' + tail : ''))
      }
    }
    return this.url
  }

  async stop() {
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null) return
    await new Promise((resolve) => {
      child.once('exit', resolve)
      if (process.platform === 'win32') {
        // 连进程树一起杀，避免遗留 vite 等子进程
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      } else {
        child.kill('SIGTERM')
        setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 3000)
      }
    })
  }
}

module.exports = { Kernel, findFreePort, waitForPort }
