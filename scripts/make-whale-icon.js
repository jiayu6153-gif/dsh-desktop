'use strict'
// 生成黑色鲸鱼图标：从官方 logo.png 裁出鲸鱼本体(x[0..225])，等比缩放进正方形画布
// 输出 assets/icon-512.png / icon-256.png / icon-32.png（RGBA，纯黑 + 双线性抗锯齿）
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

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
  ihdr[9] = 6
  const raw = Buffer.alloc(h * (1 + w * 4))
  let o = 0
  for (let y = 0; y < h; y++) {
    raw[o++] = 0
    rgba.copy(raw, o, y * w * 4, (y + 1) * w * 4)
    o += w * 4
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// ---- 主体 ----
const srcFile = process.argv[2] || path.join(process.env.TEMP || '/tmp', 'ds-logo', 'logo.png')
const outDir = path.join(__dirname, '..', 'assets')
const { w: sw, h: sh, bpp, px } = decodePNG(srcFile)

// 鲸鱼本体区域（依据蓝色密度剖面：x[0..225]，全高）
const WX = 0
const WW = 228
const WY = 0
const WH = sh
const margin = 0.12 // 画布边距比例

function alphaAt(fx, fy) {
  // 双线性采样源图 alpha
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const tx = fx - x0, ty = fy - y0
  const get = (x, y) => {
    if (x < 0 || x >= sw || y < 0 || y >= sh) return 0
    const i = y * sw * bpp + x * bpp
    return bpp === 4 ? px[i + 3] : 255
  }
  const a00 = get(x0, y0), a10 = get(x0 + 1, y0), a01 = get(x0, y0 + 1), a11 = get(x0 + 1, y0 + 1)
  return a00 * (1 - tx) * (1 - ty) + a10 * tx * (1 - ty) + a01 * (1 - tx) * ty + a11 * tx * ty
}

for (const S of [512, 256, 32]) {
  const scale = (S * (1 - margin * 2)) / Math.max(WW, WH)
  const dw = WW * scale
  const dh = WH * scale
  const ox = (S - dw) / 2
  const oy = (S - dh) / 2
  const out = Buffer.alloc(S * S * 4)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = WX + (x - ox) / scale
      const fy = WY + (y - oy) / scale
      const alpha = fx < WX || fx >= WX + WW || fy < WY || fy >= WY + WH ? 0 : alphaAt(fx, fy)
      const i = (y * S + x) * 4
      out[i] = 0
      out[i + 1] = 0
      out[i + 2] = 0
      out[i + 3] = Math.round(Math.max(0, Math.min(255, alpha)))
    }
  }
  const file = path.join(outDir, `icon-${S}.png`)
  fs.writeFileSync(file, encodePNG(S, S, out))
  console.log('wrote', file)
}
