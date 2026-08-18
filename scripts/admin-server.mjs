// 입력 도구용 로컬 서버. 노트북에서만 돈다.
//
// GitHub Pages는 정적 파일만 호스팅하므로 api/ 함수가 서버에서 돌지 않는다.
// 대신 이 서버가 같은 /api 경로를 로컬에서 제공한다.
//   /api/search, /api/detail  → api/ 폴더의 핸들러를 그대로 재사용
//   /api/save                 → data/movies.json에 직접 쓰고 빌드까지 실행
//
// 저장 후 git push 하면 GitHub Actions가 사이트를 다시 만든다.
//
// 실행: node scripts/admin-server.mjs [포트]
//       http://localhost:4400/admin.html

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize, extname } from 'node:path'
import { homedir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(root, 'public')
const port = Number(process.argv[2] ?? 4400)

// ── 키 읽기. 볼트 .env가 단일 출처, 저장소 .env가 있으면 덮는다 ─────────────
function loadEnv(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m && m[2].trim() !== '') out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}
const vaultEnv = join(
  process.env.VAULT_ROOT || join(homedir(), 'Documents', '정혜지-PAAM-2026-v3'),
  '00-system', '03-config', '.env')
Object.assign(process.env, loadEnv(vaultEnv), loadEnv(join(root, '.env')))

// 로컬 전용이므로 접근 암호는 형식만 유지한다. 어떤 값을 넣어도 통과한다.
const LOCAL_KEY = 'local'
process.env.ADMIN_PASSPHRASE = LOCAL_KEY

const { default: searchHandler } = await import('../api/search.js')
const { default: detailHandler } = await import('../api/detail.js')
const { buildRecord, applyEdit } = await import('../api/_record.mjs')

// ── Vercel 핸들러를 node http에 맞추는 어댑터 ───────────────────────────────
function adapt(handler, url, method, body, res) {
  const fakeReq = {
    method,
    query: Object.fromEntries(url.searchParams),
    headers: { 'x-aflm-key': LOCAL_KEY },   // 로컬이므로 항상 통과
    body,
  }
  const fakeRes = {
    _status: 200,
    setHeader() {},
    status(c) { this._status = c; return this },
    json(o) {
      res.writeHead(this._status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(o))
    },
  }
  return handler(fakeReq, fakeRes)
}

// ── 로컬 저장. GitHub API 대신 파일에 직접 쓴다 ─────────────────────────────
// 레코드를 만들고 고치는 규칙은 api/_record.mjs 하나에 있다. 배포 함수도 같은
// 파일을 쓰므로 로컬로 넣은 기록과 사이트로 넣은 기록의 모양이 같다.
const FILE = join(root, 'data', 'movies.json')

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 파일에 쓰고 정적 파일을 다시 만든다. */
function writeAndBuild(movies) {
  writeFileSync(FILE, JSON.stringify(movies, null, 2) + '\n', 'utf8')
  execFileSync(process.execPath, [join(root, 'build.mjs')], { stdio: 'inherit' })
}

function saveLocal(b, res) {
  let record
  try {
    record = buildRecord(b)
  } catch (e) {
    return send(res, e.status ?? 500, { error: e.message })
  }

  const movies = JSON.parse(readFileSync(FILE, 'utf8'))
  if (movies.some(m => m.id === record.id)) {
    return send(res, 409, { error: `이미 있는 기록입니다: ${record.id}` })
  }

  movies.push(record)
  writeAndBuild(movies)

  send(res, 200, {
    ok: true, id: record.id, total: movies.length,
    note: '저장하고 빌드까지 끝났습니다. git push 하면 사이트에 반영됩니다.',
  })
}

/** 기존 기록 한 건을 통째로 낸다. 고치기 화면이 폼을 채울 때 쓴다. */
function recordLocal(id, res) {
  if (!id) return send(res, 400, { error: 'id가 없습니다.' })
  const movies = JSON.parse(readFileSync(FILE, 'utf8'))
  const record = movies.find(m => m.id === id)
  if (!record) return send(res, 404, { error: `없는 기록입니다: ${id}` })
  // 로컬은 파일을 바로 읽으므로 겹쳐 쓰기를 가려낼 sha가 없다. 배포본에서만 쓴다.
  send(res, 200, { record, sha: null })
}

function updateLocal(b, res) {
  const id = String(b.id ?? '').trim()
  if (!id) return send(res, 400, { error: 'id가 없습니다.' })

  const movies = JSON.parse(readFileSync(FILE, 'utf8'))
  const at = movies.findIndex(m => m.id === id)
  if (at < 0) return send(res, 404, { error: `없는 기록입니다: ${id}` })

  let next
  try {
    next = applyEdit(movies[at], b)
  } catch (e) {
    return send(res, e.status ?? 500, { error: e.message })
  }
  if (!next) return send(res, 200, { ok: true, id, changed: false, note: '바뀐 값이 없습니다.' })

  movies[at] = next
  writeAndBuild(movies)

  send(res, 200, {
    ok: true, id, changed: true,
    note: '고치고 빌드까지 끝났습니다. git push 하면 사이트에 반영됩니다.',
  })
}

// ── 서버 ────────────────────────────────────────────────────────────────────
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  try {
    if (url.pathname === '/api/search') return await adapt(searchHandler, url, req.method, undefined, res)
    if (url.pathname === '/api/detail') return await adapt(detailHandler, url, req.method, undefined, res)
    if (url.pathname === '/api/record' && req.method === 'GET') {
      return recordLocal(url.searchParams.get('id'), res)
    }
    if (url.pathname === '/api/save' && req.method === 'POST') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      return saveLocal(JSON.parse(raw || '{}'), res)
    }
    if (url.pathname === '/api/update' && req.method === 'PUT') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      return updateLocal(JSON.parse(raw || '{}'), res)
    }

    // 입력 화면은 배포본에 없으므로 저장소 루트에서 직접 낸다
    if (url.pathname === '/admin.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(await readFile(join(root, 'admin.html')))
    }

    let p = decodeURIComponent(url.pathname)
    if (p.endsWith('/')) p += 'index.html'
    const file = join(PUB, normalize(p).replace(/^(\.\.[/\\])+/, ''))
    const s = await stat(file)
    if (!s.isFile()) throw new Error('not a file')
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(await readFile(file))
  } catch (e) {
    if (e?.code === 'ENOENT') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('없는 주소입니다.')
    } else {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: String(e.message ?? e) }))
    }
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`입력 도구: http://localhost:${port}/admin.html`)
  console.log('암호 칸에는 아무 값이나 넣으면 됩니다. 로컬에서만 접근됩니다.')
  console.log('저장하면 data/movies.json에 쓰고 빌드까지 합니다. 반영은 git push.')
})
