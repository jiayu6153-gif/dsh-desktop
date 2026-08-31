'use strict'
// 打印 logo 每 10px 列的蓝色像素密度，定位鲸鱼实体范围
const zlib = require('zlib')
const fs = require('fs')

const file = process.argv[2]
const buf = fs.readFileSync(file)
const w = buf.readUInt32BE(16)
const h = buf.readUInt32BE(20)
const colorType = buf[25]
const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
const idat = []
let pos = 8
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos)
  const type = buf.toString('ascii', pos + 4, pos + 8)
  if (type === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + len))
  pos += 12 + len
}
const raw = zlib.inflateSync(Buffer.concat(idat))
const stride = w * bpp
const px = Buffer.alloc(w * h * bpp)
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

const buckets = new Array(Math.ceil(w / 10)).fill(0)
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = y * stride + x * bpp
    const r = px[i], g = px[i + 1], b = px[i + 2]
    const a = bpp === 4 ? px[i + 3] : 255
    if (a > 16 && b - r > 40 && b > 120) buckets[Math.floor(x / 10)]++
  }
}
let line = ''
for (let i = 0; i < buckets.length; i++) {
  const bar = Math.round(buckets[i] / (10 * h) * 100)
  line += `${i * 10}:${String(bar).padStart(2)}%  `
  if ((i + 1) % 8 === 0) { console.log(line); line = '' }
}
if (line) console.log(line)
// 找高密度区间（>=40% 视为实心鲸鱼区）
const solid = []
for (let i = 0; i < buckets.length; i++) {
  const pct = buckets[i] / (10 * h) * 100
  if (pct >= 40) solid.push(i * 10)
}
if (solid.length) console.log(`实心区: x[${solid[0]}..${solid[solid.length - 1] + 10}]`)
