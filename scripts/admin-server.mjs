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
function makeSlug(title, year) {
  const base = String(title ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[\/\\:*?"<>|#%{}$+`=@!&,.]/g, ' ')
    .trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!base) return null
  return year ? `${base}-${year}` : base
}

function saveLocal(b, res) {
  const fail = (code, error) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error }))
  }
  const title = String(b.title ?? '').trim()
  const firstLine = String(b.first_line ?? '').trim()
  const style = String(b.style ?? '').trim()
  const meta = b.meta ?? {}
  if (!title) return fail(400, '제목이 없습니다.')
  if (!firstLine) return fail(400, '첫 대사가 없습니다.')
  if (!style) return fail(400, '화법 분류를 골라야 합니다.')

  const year = meta.year ? String(meta.year).match(/\d{4}/)?.[0] ?? null : null
  const id = makeSlug(title, year)
  if (!id) return fail(400, '제목으로 주소를 만들 수 없습니다.')

  const file = join(root, 'data', 'movies.json')
  const movies = JSON.parse(readFileSync(file, 'utf8'))
  if (movies.some(m => m.id === id)) return fail(409, `이미 있는 기록입니다: ${id}`)

  // 시청 경로. 고르지 않았으면 null. 시청일은 저장 시각(created_at)이 담당한다.
  const wv = b.watched_via ?? null
  const watchedVia = wv && wv.name
    ? { kind: wv.kind ?? null, name: String(wv.name) }
    : null

  const now = new Date().toISOString()
  movies.push({
    id,
    record_kind: 'movie',
    note: null,
    watched_via: watchedVia,
    edition: typeof b.edition === 'string' && b.edition.trim() ? b.edition.trim() : null,
    title,
    title_notion_original: null,     // Notion에서 온 기록이 아니다
    title_original: meta.title_original ?? null,
    title_ko: meta.title_ko ?? null,
    title_local: meta.title_local ?? null,
    first_line: firstLine,
    style,
    style_group: b.style_group ?? null,
    genre: Array.isArray(meta.genre) ? meta.genre : [],
    genre_notion_original: null,
    tags: Array.isArray(b.tags) ? b.tags : [],
    released: year,
    released_notion_original: null,
    release_date: meta.release_date ?? null,
    director: meta.director ?? null,
    director_ko: meta.director_ko ?? null,
    country: meta.country ?? null,
    poster_url: meta.poster_url ?? null,
    tmdb_id: meta.tmdb_id ?? null,
    kmdb_id: meta.kmdb_id ?? null,
    created_at: now,
    updated_at: now,
    source: {
      first_line: 'human',
      style: 'human',
      title: 'human',
      genre: meta.source ?? null,
      released: meta.source ?? null,
      title_ko: meta.title_ko ? (meta.source ?? null) : null,
      director: meta.director ? (meta.source ?? null) : null,
      poster_url: meta.poster_url ? (meta.source ?? null) : null,
    },
  })

  writeFileSync(file, JSON.stringify(movies, null, 2) + '\n', 'utf8')
  execFileSync(process.execPath, [join(root, 'build.mjs')], { stdio: 'inherit' })

  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({
    ok: true, id, total: movies.length,
    note: '저장하고 빌드까지 끝났습니다. git push 하면 사이트에 반영됩니다.',
  }))
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
    if (url.pathname === '/api/save' && req.method === 'POST') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      return saveLocal(JSON.parse(raw || '{}'), res)
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
