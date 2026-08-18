// API 함수들이 함께 쓰는 도구.
// 이 파일은 이름이 밑줄로 시작하므로 Vercel이 함수로 만들지 않는다.

import { timingSafeEqual } from 'node:crypto'

/**
 * 두 값이 같은지 견주되, 걸린 시간으로 값을 좁히지 못하게 한다.
 * 입력 화면이 공개 주소에 있으므로 암호를 한 글자씩 알아내려는 시도를 막아야 한다.
 * 길이가 다르면 그 자리에서 끝낸다. 길이는 어차피 응답 시간으로 가려지지 않는다.
 */
function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8')
  const y = Buffer.from(String(b ?? ''), 'utf8')
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

/** 입력 도구 접근 확인. 암호가 맞지 않으면 응답을 보내고 false를 반환한다. */
export function requireAuth(req, res) {
  const expected = process.env.ADMIN_PASSPHRASE
  if (!expected) {
    res.status(500).json({ error: 'ADMIN_PASSPHRASE가 설정되지 않았습니다.' })
    return false
  }
  if (!safeEqual(req.headers['x-aflm-key'], expected)) {
    res.status(401).json({ error: '암호가 맞지 않습니다.' })
    return false
  }
  return true
}

// ── GitHub Contents API ─────────────────────────────────────────────────────
// 기록은 저장소 파일 하나(data/movies.json)에 있고, 커밋이 그대로 변경 이력이자
// 백업이 된다. 별도 데이터베이스를 두지 않는 이유가 이것이다.

export const MOVIES_FILE = 'data/movies.json'

/** GitHub API 호출. 실패하면 상태와 사유를 그대로 담아 던진다. */
export async function gh(path, init = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${body.message ?? r.statusText}`)
  return body
}

/** 저장소의 movies.json을 읽는다. 겹쳐 쓰기를 가려내려고 sha도 함께 돌려준다. */
export async function readMovies() {
  const repo = process.env.GITHUB_REPO
  const branch = process.env.GITHUB_BRANCH || 'main'
  const current = await gh(
    `/repos/${repo}/contents/${MOVIES_FILE}?ref=${encodeURIComponent(branch)}`)
  const movies = JSON.parse(Buffer.from(current.content, 'base64').toString('utf8'))
  return { movies, sha: current.sha, repo, branch }
}

/** movies.json을 커밋한다. sha가 어긋나면 GitHub가 409로 거절한다. */
export async function writeMovies({ movies, sha, repo, branch, message }) {
  const content = Buffer.from(JSON.stringify(movies, null, 2) + '\n', 'utf8').toString('base64')
  return gh(`/repos/${repo}/contents/${MOVIES_FILE}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content, sha, branch }),
  })
}

/** 필요한 환경변수가 없으면 그 사실을 그대로 알린다. 기본값을 지어내지 않는다. */
export function requireEnv(res, names) {
  const missing = names.filter(n => !process.env[n])
  if (missing.length) {
    res.status(500).json({ error: `환경변수가 없습니다: ${missing.join(', ')}` })
    return false
  }
  return true
}

const TMDB_BASE = 'https://api.themoviedb.org/3'
export const TMDB_IMAGE = 'https://image.tmdb.org/t/p'

/**
 * 일시적인 연결 끊김에 대비해 다시 걸어 본다.
 * 163편을 잇달아 부르다 보면 중간에 한 번씩 끊기는데, 그때마다 '결과 없음'으로
 * 기록되면 멀쩡한 짝을 잃는다. 서버가 4xx로 거절한 것은 다시 걸지 않는다.
 */
async function fetchRetry(url, init, tries = 3) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, init)
      if (r.status >= 500 || r.status === 429) { last = new Error(`${r.status}`); }
      else return r
    } catch (e) { last = e }
    await new Promise(r => setTimeout(r, 400 * (i + 1) ** 2))
  }
  throw last
}

/**
 * TMDB 호출. v4 읽기 토큰(eyJ로 시작)과 v3 키를 모두 받는다.
 */
export async function tmdb(path, params = {}) {
  const key = process.env.TMDB_API_KEY
  const url = new URL(TMDB_BASE + path)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
  }

  const headers = { accept: 'application/json' }
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`
  else url.searchParams.set('api_key', key)

  const r = await fetchRetry(url, { headers })
  if (!r.ok) {
    throw new Error(`TMDB ${r.status} ${r.statusText} (${path})`)
  }
  return r.json()
}

/** KMDb 제목에 섞여 있는 강조 표시와 여분 공백을 걷어낸다. */
export function cleanKmdbText(s) {
  return String(s ?? '').replace(/!HS|!HE/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * KMDb 검색. 한국 영화는 이쪽이 정확하다.
 * 응답 구조가 바뀌었을 수 있으므로 형태가 예상과 다르면 빈 배열을 돌려주고
 * 그 사실을 note에 남긴다. 값을 지어내지 않는다.
 */
export async function kmdbSearch(query, listCount = 5) {
  const key = process.env.API_KMDB
  if (!key) return { results: [], note: 'API_KMDB 환경변수가 없어 KMDb를 건너뛰었습니다.' }

  // HTTPS로 부른다. 키가 쿼리스트링에 실리므로 평문 구간을 만들지 않는다.
  const url = new URL('https://api.koreafilm.or.kr/openapi-data2/wisenut/search_api/search_json2.jsp')
  url.searchParams.set('collection', 'kmdb_new2')
  url.searchParams.set('ServiceKey', key)
  url.searchParams.set('title', query)
  url.searchParams.set('listCount', String(listCount))
  url.searchParams.set('detail', 'Y')

  let data
  try {
    const r = await fetchRetry(url)
    if (!r.ok) return { results: [], note: `KMDb 응답 ${r.status}` }
    data = await r.json()
  } catch (e) {
    return { results: [], note: `KMDb 호출 실패: ${e.message}` }
  }

  // 결과가 0건인 것과 응답 형태가 어긋난 것을 구분한다.
  // 한국 영화가 아니면 0건이 정상이므로 오류로 알리지 않는다.
  const total = Number(data?.TotalCount ?? data?.Data?.[0]?.TotalCount ?? NaN)
  const rows = data?.Data?.[0]?.Result
  if (!Array.isArray(rows)) {
    return total === 0
      ? { results: [], note: null }
      : { results: [], note: 'KMDb 응답 형태가 예상과 다릅니다.' }
  }

  const results = rows.map(row => {
    const posters = String(row.posters ?? '').split('|').map(s => s.trim()).filter(Boolean)
    const directors = (row.directors?.director ?? [])
      .map(d => cleanKmdbText(d.directorNm)).filter(Boolean)
    const year = String(row.prodYear ?? '').match(/\d{4}/)?.[0] ?? null
    return {
      source: 'kmdb',
      id: `${row.movieId ?? ''}-${row.movieSeq ?? ''}`,
      title: cleanKmdbText(row.title),
      title_original: cleanKmdbText(row.titleOrg) || null,
      title_en: cleanKmdbText(row.titleEng) || null,
      year,
      release_date: String(row.repRlsDate ?? '').match(/^(\d{4})(\d{2})(\d{2})$/)
        ? String(row.repRlsDate).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
        : null,
      director: directors[0] ?? null,
      country: cleanKmdbText(row.nation) || null,
      genre: cleanKmdbText(row.genre) ? cleanKmdbText(row.genre).split(',').map(s => s.trim()) : [],
      poster: posters[0] ?? null,
    }
  })

  return { results, note: null }
}

// ── 원어 이름과 오리지널 포스터 ─────────────────────────────────────────────

/** 언어별 문자 판별. 원어 이름을 also_known_as에서 골라낼 때 쓴다. */
const SCRIPTS = {
  ja: /[぀-ヿㇰ-ㇿ一-鿿]/,
  zh: /[一-鿿]/,
  cn: /[一-鿿]/,
  ko: /[가-힣]/,
  ru: /[Ѐ-ӿ]/,
  th: /[฀-๿]/,
  ar: /[؀-ۿ]/,
  hi: /[ऀ-ॿ]/,
}

/**
 * 감독 이름을 원어와 한국어 음차로 가져온다.
 * TMDB의 name은 로마자 표기라, also_known_as에서 제작국 문자로 된 표기와
 * 한글 표기를 찾는다. 못 찾으면 있는 값만 쓴다. 지어내지 않는다.
 */
export async function directorNames(personId, originalLang) {
  const p = await tmdb(`/person/${personId}`)
  const aka = Array.isArray(p.also_known_as) ? p.also_known_as : []
  const script = SCRIPTS[originalLang]
  const native = script ? (aka.find(a => script.test(a)) ?? p.name ?? null) : (p.name ?? null)
  const ko = originalLang === 'ko'
    ? null                                   // 원어가 이미 한국어면 음차가 따로 필요 없다
    : (aka.find(a => /[가-힣]/.test(a)) ?? null)
  return { native, ko }
}

/**
 * 오리지널 포스터 고르기. 우선순위:
 *   1. 제작국 언어 포스터  2. 글자 없는 포스터(null)  3. 기본 poster_path
 * images는 detail 호출에 append_to_response=images 로 함께 받아온다.
 */
export function pickOriginalPoster(m, originalLang) {
  const posters = m.images?.posters ?? []
  const pick = posters.find(p => p.iso_639_1 === originalLang)
    ?? posters.find(p => p.iso_639_1 === null)
  const path = pick?.file_path ?? m.poster_path ?? null
  return path ? `${TMDB_IMAGE}/w500${path}` : null
}

/** TMDB 검색 결과를 KMDb와 같은 형태로 맞춘다. */
export function normalizeTmdb(row) {
  return {
    source: 'tmdb',
    id: String(row.id),
    title: row.title ?? null,
    title_original: row.original_title ?? null,
    title_en: null,
    year: row.release_date ? row.release_date.slice(0, 4) : null,
    release_date: row.release_date || null,
    director: null,          // 상세 조회에서 채운다
    country: null,
    genre: [],
    poster: row.poster_path ? `${TMDB_IMAGE}/w342${row.poster_path}` : null,
  }
}
