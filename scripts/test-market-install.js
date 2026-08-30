'use strict'

// 验证插件市场安装链路（与 src/main/main.js 的 market:install 同逻辑）：
// 下载清单 → 下载 zip → PowerShell Expand-Archive 解压到 <临时家目录>/.agent-presets/<id>
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')

const BASE = process.argv[2] || 'http://127.0.0.1:8090'

async function main() {
  const manifest = await (await fetch(BASE + '/market.json')).json()
  const item = manifest.plugins[0]
  console.log('installing', item.id, 'from', item.url)
  const buf = Buffer.from(await (await fetch(item.url)).arrayBuffer())
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-market-test-'))
  const dest = path.join(home, '.agent-presets', item.id)
  const tmpZip = path.join(home, 'pkg.zip')
  fs.writeFileSync(tmpZip, buf)
  const psCmd = `Expand-Archive -LiteralPath '${tmpZip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`
  await new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { windowsHide: true }, (err) => (err ? reject(err) : resolve()))
  })
  const files = fs.readdirSync(dest)
  console.log('OK extracted to', dest, '→', files.join(', '))
  if (!files.includes('cordis.yml')) {
    console.error('FAILED: zip 内未找到 cordis.yml')
    process.exit(1)
  }
  console.log('market install path verified')
}

main().catch((err) => {
  console.error('FAILED:', err.message)
  process.exit(1)
})
