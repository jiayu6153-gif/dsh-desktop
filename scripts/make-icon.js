'use strict'

// 生成占位图标（纯 Node 零依赖）：assets/icon-512.png / icon-256.png / icon-32.png
// 正式图标直接替换 assets/ 下同名文件即可。
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function encodePNG(size, pixelFn) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (1 + size * 4))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y)
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const clamp01 = (v) => Math.max(0, Math.min(1, v))

function roundedRectMask(x, y, size, radius) {
  const qx = Math.max(radius - x, x - (size - 1 - radius), 0)
  const qy = Math.max(radius - y, y - (size - 1 - radius), 0)
  const d = Math.hypot(qx, qy)
  return clamp01(radius - d + 0.5)
}

// 设计：蓝→青渐变圆角方块 + 白色圆环 + 中心圆点
function draw(size) {
  const radius = size * 0.22
  const cx = size / 2
  const cy = size / 2
  const ringR = size * 0.30
  const ringW = size * 0.055
  const dotR = size * 0.085
  return encodePNG(size, (x, y) => {
    const rectA = roundedRectMask(x, y, size, radius)
    if (rectA <= 0) return [0, 0, 0, 0]
    const t = (x + y) / (2 * (size - 1))
    const r = Math.round(0x3b + (0x0c - 0x3b) * t)
    const g = Math.round(0x5b + (0xa6 - 0x5b) * t)
    const b = Math.round(0xdb + (0x78 - 0xdb) * t)
    const d = Math.hypot(x - cx, y - cy)
    const ringA = clamp01(ringW / 2 - Math.abs(d - ringR) + 0.5)
    const dotA = clamp01(dotR - d + 0.5)
    const whiteA = Math.max(ringA, dotA)
    return [
      Math.round(r + (255 - r) * whiteA),
      Math.round(g + (255 - g) * whiteA),
      Math.round(b + (255 - b) * whiteA),
      Math.round(255 * rectA)
    ]
  })
}

const outDir = path.join(__dirname, '..', 'assets')
fs.mkdirSync(outDir, { recursive: true })
for (const size of [512, 256, 32]) {
  const file = path.join(outDir, `icon-${size}.png`)
  fs.writeFileSync(file, draw(size))
  console.log('wrote', file)
}
