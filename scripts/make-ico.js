'use strict'
// 把 assets/icon-256.png 打包成单图 ICO（Vista+ 支持 PNG-in-ICO，Windows 与 NSIS 均可用）
// 绕开 electron-builder 的 icon-tool（它转换我们的 PNG 会原生崩溃）
const fs = require('fs')
const path = require('path')

const inFile = path.join(__dirname, '..', 'assets', 'icon-256.png')
const outFile = path.join(__dirname, '..', 'assets', 'icon.ico')
const png = fs.readFileSync(inFile)

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(1, 4) // count

const entry = Buffer.alloc(16)
entry[0] = 0 // width 256 -> 0
entry[1] = 0 // height 256 -> 0
entry[2] = 0 // palette colors
entry[3] = 0 // reserved
entry.writeUInt16LE(1, 4) // planes
entry.writeUInt16LE(32, 6) // bpp
entry.writeUInt32LE(png.length, 8) // bytes
entry.writeUInt32LE(6 + 16, 12) // offset

fs.writeFileSync(outFile, Buffer.concat([header, entry, png]))
console.log('wrote', outFile, `(${6 + 16 + png.length} bytes)`)
