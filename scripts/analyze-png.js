'use strict'
// 分析 PNG：透明像素分布边界 + 颜色统计，验证图标裁切/染色是否合理
const zlib = require('zlib')
const fs = require('fs')

const file = process.argv[2]
const buf = fs.readFileSync(file)
if (buf.readUInt32BE(0) !== 0x89504e47) { console.error('not png'); process.exit(1) }
const w = buf.readUInt32BE(16)
const h = buf.readUInt32BE(20)
const bitDepth = buf[24]
const colorType = buf[25]
console.log(`size ${w}x${h} bit=${bitDepth} colorType=${colorType}`)

// 收集 IDAT
let pos = 8
const idat = []
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos)
  const type = buf.toString('ascii', pos + 4, pos + 8)
  if (type === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + len))
  pos += 12 + len
}
const raw = zlib.inflateSync(Buffer.concat(idat))
const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
const stride = w * bpp
const px = Buffer.alloc(w * h * 4)

let srcPos = 0
for (let y = 0; y < h; y++) {
  const filter = raw[srcPos++]
  const line = raw.subarray(srcPos, srcPos + stride)
  srcPos += stride
  const out = Buffer.alloc(stride)
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? out[x - bpp] : 0
    const b = y > 0 ? px[(y - 1) * stride + x] : 0
    const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0
    let v = line[x]
    switch (filter) {
      case 0: break
      case 1: v = (v + a) & 0xff; break
      case 2: v = (v + b) & 0xff; break
      case 3: v = (v + ((a + b) >> 1)) & 0xff; break
      case 4: {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
        break
      }
    }
    out[x] = v
  }
  out.copy(px, y * stride)
}

let minX = w, minY = h, maxX = -1, maxY = -1
let opaque = 0, black = 0, other = 0
const colors = {}
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = y * stride + x * bpp
    const a = bpp === 4 ? px[i + 3] : 255
    if (a > 16) {
      opaque++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const r = px[i], g = px[i + 1], b = px[i + 2]
      if (r < 32 && g < 32 && b < 32) black++
      else { other++; const key = `${r},${g},${b}`; colors[key] = (colors[key] || 0) + 1 }
    }
  }
}
console.log(`opaque=${opaque} (${(opaque / (w * h) * 100).toFixed(1)}%)  black=${black}  other=${other}`)
console.log(`bbox: x[${minX}..${maxX}] y[${minY}..${maxY}]  w=${maxX - minX + 1} h=${maxY - minY + 1}`)
console.log(`centered: cx=${((minX + maxX) / 2 / w * 100).toFixed(1)}% cy=${((minY + maxY) / 2 / h * 100).toFixed(1)}%`)
const top = Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 5)
console.log('top colors:', top.map(([k, v]) => `${k}×${v}`).join('  '))
