'use strict'

// 独立验证脚本：用本仓库的 @deepseek-ai/dsh 在随机端口 + 临时 DSH_HOME 上拉起 dsh web，
// 确认内核能独立启动，再开始 Electron 外壳联调。
const { spawn } = require('child_process')
const net = require('net')
const path = require('path')
const os = require('os')
const fs = require('fs')

const dshPkgPath = require.resolve('@deepseek-ai/dsh/package.json')
const dshPkg = require(dshPkgPath)
const binRel = typeof dshPkg.bin === 'string' ? dshPkg.bin : dshPkg.bin.dsh
const bin = path.join(path.dirname(dshPkgPath), binRel)

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port
      s.close(() => resolve(port))
    })
  })
}

function waitPort(port, ms) {
  const end = Date.now() + ms
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect({ host: '127.0.0.1', port })
      sock.once('connect', () => { sock.destroy(); resolve() })
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() > end) reject(new Error('timeout waiting for port ' + port))
        else setTimeout(tryOnce, 250)
      })
    }
    tryOnce()
  })
}

async function main() {
  const port = await freePort()
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-kernel-test-'))
  console.log('port =', port)
  console.log('DSH_HOME =', home)
  const child = spawn(process.execPath, [bin, 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stopping = false
  child.stdout.on('data', (d) => process.stdout.write('[out] ' + d))
  child.stderr.on('data', (d) => process.stdout.write('[err] ' + d))
  child.on('exit', (code) => {
    console.log('kernel exited code=' + code)
    process.exit(stopping ? 0 : (code == null ? 1 : code))
  })
  await waitPort(port, 60000)
  console.log('PORT OPEN — kernel is listening on', port)
  await new Promise((r) => setTimeout(r, 3000))
  console.log('stopping…')
  stopping = true
  child.kill()
  setTimeout(() => process.exit(0), 2000)
}

main().catch((err) => {
  console.error('FAILED:', err.message)
  process.exit(1)
})
