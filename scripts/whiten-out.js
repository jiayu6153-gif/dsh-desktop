'use strict'
// 白底转透明 + 像素统一为纯黑（按亮度做抗锯齿 alpha）
// 用法: node scripts/whiten-out.js <input.png> <output.png>
const zlib = require('zlib')
const fs = require('fs')

function decodePNG(file) {
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
  return { w, h, bpp, px }
}

// ---- PNG 编码（复用 make-icon.js 的写法）----
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(b) {
  let crc = -1
  for (let i = 0; i < b.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b[i]) & 0xff]
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
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(h * (1 + w * 4))
  let o = 0
  for (let y = 0; y < h; y++) {
    raw[o++] = 0
    rgba.copy(raw, o, y * w * 4, (y + 1) * w * 4)
    o += w * 4
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const [inFile, outFile] = process.argv.slice(2)
const { w, h, bpp, px } = decodePNG(inFile)
const out = Buffer.alloc(w * h * 4)
for (let i = 0; i < w * h; i++) {
  const r = px[i * bpp]
  const g = px[i * bpp + 1]
  const b = px[i * bpp + 2]
  const lum = Math.max(r, g, b)
  // 白(>=240)全透明；黑(<=200)全不透明；中间按线性过渡做抗锯齿
  const alpha = Math.max(0, Math.min(255, Math.round((240 - lum) * (255 / 40))))
  out[i * 4] = 0
  out[i * 4 + 1] = 0
  out[i * 4 + 2] = 0
  out[i * 4 + 3] = alpha
}
fs.writeFileSync(outFile, encodePNG(w, h, out))
console.log(`wrote ${outFile} (${w}x${h}, RGBA, black + AA alpha)`)
