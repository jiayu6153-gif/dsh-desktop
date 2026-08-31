'use strict'
// 在原 logo 上按颜色找鲸鱼边界：蓝色像素（b 显著大于 r）的 bbox
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

console.log(`原图 ${w}x${h} colorType=${colorType}`)
for (const [label, pred] of [
  ['蓝色鲸鱼(b-r>40 且 b>120)', (r, g, b) => b - r > 40 && b > 120],
  ['深色文字(max<120)', (r, g, b) => Math.max(r, g, b) < 120],
  ['非透明', () => true]
]) {
  let minX = w, minY = h, maxX = -1, maxY = -1, n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * stride + x * bpp
      const r = px[i], g = px[i + 1], b = px[i + 2]
      const a = bpp === 4 ? px[i + 3] : 255
      if (a > 16 && pred(r, g, b, a)) {
        n++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  console.log(`${label}: n=${n} bbox x[${minX}..${maxX}] y[${minY}..${maxY}] 尺寸 ${maxX - minX + 1}x${maxY - minY + 1}`)
}
