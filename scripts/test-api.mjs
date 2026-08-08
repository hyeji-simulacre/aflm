// TMDB와 KMDb를 실제로 불러 확인한다. 배포 전에 여기서 먼저 돌린다.
//
// 키는 .env에서 읽는다. 값을 화면에 찍지 않는다.
// KMDb 키가 .env에 없으면 볼트 .env의 API_KMDB를 찾아 쓴다.
//
// 실행: node scripts/test-api.mjs

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...loadEnv(join(root, '.env')) }

// 볼트 .env가 키의 단일 출처다. 이 저장소 .env에 없는 키는 거기서 읽는다.
// 배포할 때는 Vercel 대시보드에 같은 값을 등록해야 한다.
const vaultEnv = join(
  process.env.VAULT_ROOT || join(homedir(), 'Documents', '정혜지-PAAM-2026-v3'),
  '00-system', '03-config', '.env')

if (existsSync(vaultEnv)) {
  const v = loadEnv(vaultEnv)
  for (const k of ['TMDB_API_KEY', 'API_KMDB']) {
    if (!env[k] && v[k]) {
      env[k] = v[k]
      console.log(`${k}는 볼트 .env에서 읽었습니다.`)
    }
  }
} else {
  console.log('볼트 .env를 찾지 못했습니다. 이 저장소 .env만 씁니다.')
}

Object.assign(process.env, env)

const mask = v => (v ? `있음 (${v.length}자, ${v.startsWith('eyJ') ? 'v4 읽기 토큰' : 'v3 키'})` : '없음')
console.log(`TMDB_API_KEY  ${mask(process.env.TMDB_API_KEY)}`)
console.log(`API_KMDB      ${process.env.API_KMDB ? `있음 (${process.env.API_KMDB.length}자)` : '없음'}`)
console.log('')

if (!process.env.TMDB_API_KEY) {
  console.log('.env에 TMDB_API_KEY를 넣고 다시 실행하세요.')
  process.exit(1)
}

const { tmdb, kmdbSearch, normalizeTmdb } = await import('../api/_lib.mjs')

// 기존 데이터에서 고른 확인 표본. 언어와 출처를 고루 담았다.
const CASES = [
  { q: 'SUNSHINE', why: '영어 제목' },
  { q: '甛蜜蜜', why: '중국어(번체) 제목' },
  { q: '冷静と情熱のあいだ', why: '일본어 제목' },
  { q: 'PORTRAIT DE LA JEUNE FILLE EN FEU', why: '프랑스어 제목' },
  { q: '곤지암', why: '한국 영화, 한글 질의' },
  { q: '명량', why: '한국 영화, 한글 질의' },
  { q: '설국열차', why: '한국 영화, 한글 질의' },
  { q: 'THE TIME TRAVELER’S WHIFE', why: '오타가 있는 제목 (WIFE)' },
  { q: 'PREDETOR', why: '오타가 있는 제목 (PREDATOR)' },
]

let ok = 0
for (const c of CASES) {
  process.stdout.write(`${c.q}  (${c.why})\n`)

  let tRes = []
  try {
    const d = await tmdb('/search/movie', { query: c.q, language: 'ko-KR', include_adult: 'false' })
    tRes = (d.results ?? []).slice(0, 3).map(normalizeTmdb)
  } catch (e) {
    console.log(`   TMDB 실패: ${e.message}`)
  }

  const k = await kmdbSearch(c.q, 3)
  if (k.note) console.log(`   KMDb: ${k.note}`)

  const all = [...tRes, ...k.results]
  if (all.length === 0) {
    console.log('   결과 없음')
  } else {
    ok++
    for (const r of all.slice(0, 3)) {
      console.log(`   [${r.source}] ${r.title ?? '(제목 없음)'} ${r.year ?? '연도 없음'}` +
        `${r.title_original && r.title_original !== r.title ? ` / ${r.title_original}` : ''}` +
        `${r.poster ? ' / 포스터 있음' : ' / 포스터 없음'}`)
    }
  }
  console.log('')
}

console.log(`표본 ${CASES.length}건 중 ${ok}건에서 결과를 받았습니다.`)
