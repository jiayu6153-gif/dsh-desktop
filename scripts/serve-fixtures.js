'use strict'

// 本地夹具静态服务：把 fixtures/ 目录挂到 http://127.0.0.1:8090，
// 供开发时在插件市场里联调清单加载与安装链路。
// 用法：node scripts/serve-fixtures.js [port]
const http = require('http')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', 'fixtures')
const port = Number(process.argv[2] || 8090)
const types = { '.json': 'application/json; charset=utf-8', '.zip': 'application/zip', '.yml': 'text/yaml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' }

http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '')
  const file = path.join(root, rel || 'market.json')
  if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' })
    res.end(data)
  })
}).listen(port, '127.0.0.1', () => {
  console.log(`fixtures server: http://127.0.0.1:${port}/market.json`)
})
