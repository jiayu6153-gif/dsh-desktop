'use strict'

// 两段式打包：
// 1) electron-builder --dir 产出 win-unpacked（node.exe 用构建机 process.execPath，本地/CI 通用）
// 2) 把 dsh 内核树（含嵌套 node_modules）原样补进 resources/dsh ——
//    electron-builder 的复制会无条件排除嵌套 node_modules，破坏内核 ESM 解析
// 3) 用 --prepackaged 直接压 NSIS，不再重新走依赖图复制
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

run('npx electron-builder --dir')

const src = path.join(root, 'node_modules', '@deepseek-ai', 'dsh')
const dst = path.join(root, 'dist', 'win-unpacked', 'resources', 'dsh')
fs.rmSync(dst, { recursive: true, force: true })
fs.cpSync(src, dst, { recursive: true })
console.log('dsh kernel tree copied to', dst)

run('npx electron-builder --win nsis --prepackaged dist/win-unpacked')
console.log('DONE: dist/DeepSeek Harness Desktop-Setup-0.1.0.exe')
