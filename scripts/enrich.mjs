// 163편의 메타데이터를 TMDB와 KMDb에서 채운다.
//
// 원칙
//   1. 확신이 서는 짝만 자동으로 채운다. 나머지는 후보만 적어두고 사람에게 넘긴다.
//   2. Notion 원본 값(제목, 개봉연도, 장르, 첫 대사, 화법 분류)은 건드리지 않는다.
//   3. 이미 사람이 손질한 값은 덮어쓰지 않는다.
//   4. 못 채운 값은 null로 둔다. 그럴듯한 값을 지어내지 않는다.
//
// 자동 확정 기준: 제목이 정규화 후 정확히 같고, 개봉연도 차이가 1년 이내.
// 둘 중 하나라도 어긋나면 candidates에 담고 needs_review로 표시한다.
//
// 실행: node scripts/enrich.mjs            확인만 하고 파일은 그대로 둔다
//       node scripts/enrich.mjs --write    movies.json에 반영한다

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const WRITE = process.argv.includes('--write')

// ── 키 읽기 ─────────────────────────────────────────────────────────────────
function loadEnv(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const vaultEnv = join(
  process.env.VAULT_ROOT || join(homedir(), 'Documents', '정혜지-PAAM-2026-v3'),
  '00-system', '03-config', '.env')

// 볼트 .env가 키의 단일 출처이고, 이 저장소 .env는 덮어쓸 값이 있을 때만 쓴다.
// 빈 값은 무시한다. 빈 칸이 볼트 값을 지우면 안 된다.
for (const src of [loadEnv(vaultEnv), loadEnv(join(root, '.env'))]) {
  for (const [k, v] of Object.entries(src)) {
    if (v !== '') process.env[k] = v
  }
}

if (!process.env.TMDB_API_KEY) {
  console.log('TMDB_API_KEY가 없습니다.')
  process.exit(1)
}

const { tmdb, kmdbSearch, TMDB_IMAGE, directorNames, pickOriginalPoster } = await import('../api/_lib.mjs')

// ── 제목 비교 ───────────────────────────────────────────────────────────────
/**
 * 대소문자, 악센트, 문장부호, 관사 차이를 없앤다.
 * 악센트 제거는 Amélie / Amelie 처럼 표기만 다른 같은 제목을 위한 것이고,
 * 철자가 실제로 다른 경우(Inglourious / Inglorious)는 걸러지지 않는다.
 */
function normTitle(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/\p{Mark}/gu, '')   // é → e
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/^(the|a|an) /, '')
    .trim()
}

/** 띄어쓰기와 하이픈만 다른 경우까지 본다. Spider-Man / SPIDERMAN, 寄生獣 Part 1 / Part1 */
const tight = s => normTitle(s).replace(/ /g, '')

function titlesOf(r) {
  return [r.title, r.title_original, r.title_en, r.title_ko, r.title_local].filter(Boolean)
}

/** 자동으로 확정해도 되는 짝인지 본다. */
function isConfident(record, candidate) {
  const want = normTitle(record.title)
  if (!want) return false

  const cands = titlesOf(candidate)
  const matched = cands.some(t => normTitle(t) === want) ||
                  cands.some(t => tight(t) === tight(record.title))
  if (!matched) return false

  if (record.released && candidate.year) {
    return Math.abs(Number(record.released) - Number(candidate.year)) <= 1
  }
  return true    // 원본에 연도가 없으면 제목 일치만으로 본다
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── 한 편 조회 ──────────────────────────────────────────────────────────────
async function lookup(record) {
  const q = record.title
  const notes = []
  let results = []

  try {
    const d = await tmdb('/search/movie', { query: q, language: 'ko-KR', include_adult: 'false' })
    results.push(...(d.results ?? []).slice(0, 5).map(m => ({
      source: 'tmdb',
      id: String(m.id),
      title: m.title ?? null,
      title_original: m.original_title ?? null,
      title_en: null, title_ko: m.title ?? null, title_local: null,
      year: m.release_date ? m.release_date.slice(0, 4) : null,
      release_date: m.release_date || null,
      poster: m.poster_path ? `${TMDB_IMAGE}/w342${m.poster_path}` : null,
    })))
  } catch (e) {
    notes.push(`TMDB 실패: ${e.message}`)
  }

  const k = await kmdbSearch(q, 5)
  if (k.note) notes.push(k.note)
  results.push(...k.results)

  return { results, notes }
}

/** 확정한 TMDB 항목의 상세를 받아 감독·제작국·번역 제목·오리지널 포스터를 채운다. */
async function tmdbDetail(id) {
  const m = await tmdb(`/movie/${id}`, {
    language: 'ko-KR',
    append_to_response: 'translations,credits',
  })
  const tr = m.translations?.translations ?? []
  const ko = tr.find(t => t.iso_639_1 === 'ko')?.data?.title?.trim() || null
  const lang = m.original_language ?? null
  const local = lang && lang !== 'en'
    ? (tr.find(t => t.iso_639_1 === lang)?.data?.title?.trim() || m.original_title || null)
    : null

  // 포스터는 별도 호출. append로 받으면 language=ko-KR에 걸러져 한국판이 온다.
  // 원하는 것은 제작국 오리지널 포스터다.
  try {
    m.images = await tmdb(`/movie/${id}/images`, {
      include_image_language: `${lang ?? 'en'},null`,
    })
  } catch { m.images = null }

  // 감독은 원어 표기 + 한국어 음차
  const crew = (m.credits?.crew ?? []).filter(c => c.job === 'Director')
  let director = crew[0]?.name ?? null
  let directorKo = null
  if (crew[0]?.id) {
    try {
      const n = await directorNames(crew[0].id, lang)
      director = n.native ?? director
      directorKo = n.ko
    } catch { /* 사람 조회가 실패해도 로마자 이름은 남긴다 */ }
  }

  return {
    tmdb_id: m.id,
    title_original: m.original_title ?? null,
    title_ko: ko,
    title_local: local,
    release_date: m.release_date || null,
    director,
    director_ko: directorKo,
    country: (m.origin_country ?? [])[0] ?? (m.production_countries ?? [])[0]?.iso_3166_1 ?? null,
    poster_url: pickOriginalPoster(m, lang),
    tmdb_genres: (m.genres ?? []).map(g => g.name),
  }
}

// ── 실행 ────────────────────────────────────────────────────────────────────
const records = JSON.parse(readFileSync(join(root, 'data', 'movies.json'), 'utf8'))
const films = records.filter(r => r.record_kind !== 'page' && r.title)

console.log(`영화 ${films.length}편을 조회합니다. 문서 기록과 제목 없는 기록은 건너뜁니다.\n`)

const review = []
let filled = 0, needsReview = 0, noResult = 0

for (const [i, rec] of films.entries()) {
  const { results, notes } = await lookup(rec)
  const progress = `[${String(i + 1).padStart(3)}/${films.length}]`

  if (results.length === 0) {
    noResult++
    review.push({ id: rec.id, title: rec.title, released: rec.released, status: 'no_result', notes, candidates: [] })
    console.log(`${progress} 결과 없음   ${rec.title}`)
    await sleep(60)
    continue
  }

  const hit = results.find(r => isConfident(rec, r))

  if (!hit) {
    needsReview++
    review.push({
      id: rec.id, title: rec.title, released: rec.released, status: 'needs_review', notes,
      candidates: results.slice(0, 5).map(r => ({ source: r.source, id: r.id, title: r.title, title_original: r.title_original, year: r.year })),
    })
    console.log(`${progress} 확인 필요   ${rec.title} (${rec.released ?? '연도 없음'}) → 후보 ${results.length}건`)
    await sleep(60)
    continue
  }

  // 확정. 사람이 쓴 값과 Notion 원본은 건드리지 않는다.
  let meta
  if (hit.source === 'tmdb') {
    try {
      meta = await tmdbDetail(hit.id)
    } catch (e) {
      review.push({ id: rec.id, title: rec.title, status: 'detail_failed', notes: [e.message], candidates: [] })
      console.log(`${progress} 상세 실패   ${rec.title}: ${e.message}`)
      await sleep(60)
      continue
    }
    // API가 채우는 필드는 다시 돌릴 때 새 값으로 갱신한다. 사람이 쓴 값
    // (첫 대사, 분류, 제목)과 Notion 원본 포스터는 건드리지 않는다.
    rec.tmdb_id = meta.tmdb_id
    rec.title_original = meta.title_original ?? rec.title_original
    rec.title_ko = meta.title_ko ?? rec.title_ko
    rec.title_local = meta.title_local ?? rec.title_local
    rec.release_date = meta.release_date ?? rec.release_date
    rec.director = meta.director ?? rec.director
    rec.director_ko = meta.director_ko ?? rec.director_ko ?? null
    rec.country = meta.country ?? rec.country
    if (rec.source.poster_url !== 'notion-original') {
      rec.poster_url = meta.poster_url ?? rec.poster_url
      rec.source.poster_url = rec.poster_url ? 'tmdb' : null
    }
    rec.source.title_ko = rec.title_ko ? 'tmdb' : null
    rec.source.director = rec.director ? 'tmdb' : null
  } else {
    rec.kmdb_id = hit.id
    rec.title_original = hit.title_original ?? rec.title_original
    rec.title_ko = hit.title ?? rec.title_ko
    rec.release_date = hit.release_date ?? rec.release_date
    // KMDb 이름은 한국어 표기다. 한국 영화는 그것이 곧 원어 표기이므로
    // 별도 음차가 필요 없다.
    rec.director = hit.director ?? rec.director
    rec.director_ko = rec.director_ko ?? null
    rec.country = hit.country ?? rec.country
    if (rec.source.poster_url !== 'notion-original') {
      rec.poster_url = hit.poster ?? rec.poster_url
      rec.source.poster_url = rec.poster_url ? 'kmdb' : null
    }
    rec.source.title_ko = rec.title_ko ? 'kmdb' : null
    rec.source.director = rec.director ? 'kmdb' : null
  }

  rec.updated_at = new Date().toISOString()
  filled++
  console.log(`${progress} 확정 ${hit.source.padEnd(4)}  ${rec.title}`)
  await sleep(60)
}

const summary = {
  ran_at_note: '이 파일은 사람이 후보를 골라야 하는 건과 결과가 없는 건을 모은 것이다.',
  total: films.length,
  filled, needs_review: needsReview, no_result: noResult,
  items: review,
}

writeFileSync(join(root, 'data', 'enrich-review.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8')

console.log('')
console.log(`자동 확정   ${filled}편`)
console.log(`확인 필요   ${needsReview}편`)
console.log(`결과 없음   ${noResult}편`)
console.log('')
console.log('확인이 필요한 건은 data/enrich-review.json에 후보와 함께 있습니다.')

if (WRITE) {
  writeFileSync(join(root, 'data', 'movies.json'), JSON.stringify(records, null, 2) + '\n', 'utf8')
  console.log('data/movies.json에 반영했습니다.')
} else {
  console.log('파일은 그대로 뒀습니다. 반영하려면 --write 를 붙여 다시 실행하세요.')
}
