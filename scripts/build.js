'use strict'

// 两段式打包：
// 1) electron-builder --dir 产出 win-unpacked（node.exe 用构建机 process.execPath，本地/CI 通用）
// 2) 把 dsh 内核树（含嵌套 node_modules）原样补进 resources/dsh ——
//    electron-builder 的复制会无条件排除嵌套 node_modules，破坏内核 ESM 解析
// 3) 补写 resources/app-update.yml（--publish never 会抑制其生成，但没有它更新器找不到源）
// 4) 用 --prepackaged 直接压 NSIS，不再重新走依赖图复制
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = path.join(__dirname, '..')
const nodeExe = process.execPath // 构建机的 node 可执行文件路径

// 把构建机 node.exe 复制进项目 staging 目录，yml 用相对路径引用（最稳妥）
const nodeStage = path.join(root, 'resources', 'node', 'node.exe')
fs.mkdirSync(path.dirname(nodeStage), { recursive: true })
fs.copyFileSync(nodeExe, nodeStage)
console.log('node.exe staged from', nodeExe)

const run = (cmd) => {
  console.log('>', cmd)
  execSync(cmd, { cwd: root, stdio: 'inherit' })
}

run('npx electron-builder --dir --publish never')

const src = path.join(root, 'node_modules', '@deepseek-ai', 'dsh')
const dst = path.join(root, 'dist', 'win-unpacked', 'resources', 'dsh')
fs.rmSync(dst, { recursive: true, force: true })
fs.cpSync(src, dst, { recursive: true })
console.log('dsh kernel tree copied to', dst)

// app-update.yml：electron-updater 靠它定位 GitHub 更新源
const updCfg = [
  'provider: github',
  'owner: jiayu6153-gif',
  'repo: dsh-desktop',
  'updaterCacheDirName: dsh-desktop-updater'
].join('\n') + '\n'
fs.writeFileSync(path.join(root, 'dist', 'win-unpacked', 'resources', 'app-update.yml'), updCfg)
console.log('app-update.yml written')

// --publish never：发布由 CI 的 softprops 步骤统一负责，避免构建时向 GitHub 自动发布（需 GH_TOKEN）
run('npx electron-builder --win nsis --prepackaged dist/win-unpacked --publish never')
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
console.log(`DONE: dist/DeepSeek Harness Desktop-Setup-${version}.exe`)
