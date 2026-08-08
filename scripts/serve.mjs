// public/을 로컬에서 열어보기 위한 최소 서버. Node 표준 모듈만 쓴다.
// API 함수는 여기서 돌지 않는다. 그쪽은 `vercel dev`로 확인한다.
//
// 실행: node scripts/serve.mjs [포트]

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize, extname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const port = Number(process.argv[2] ?? 4321)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (p.endsWith('/')) p += 'index.html'
    const file = join(root, normalize(p).replace(/^(\.\.[/\\])+/, ''))
    const s = await stat(file)
    if (!s.isFile()) throw new Error('not a file')
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(await readFile(file))
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('없는 주소입니다.')
  }
}).listen(port, () => {
  console.log(`http://localhost:${port} 에서 확인하세요. 멈추려면 Ctrl+C.`)
})
