// 영화 제목 검색. 한국어, 영어, 해당 국가 언어 모두 받는다.
//
// TMDB와 KMDb를 동시에 부르고 결과를 합친다. 한 쪽이 실패해도 다른 쪽
// 결과는 돌려주고, 실패한 사실은 notes에 담아 그대로 알린다.
//
// GET /api/search?q=<제목>

import { requireAuth, requireEnv, tmdb, kmdbSearch, normalizeTmdb } from './_lib.mjs'

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (!requireEnv(res, ['TMDB_API_KEY'])) return

  const q = String(req.query.q ?? '').trim()
  if (!q) {
    res.status(400).json({ error: '검색어가 없습니다.' })
    return
  }

  const notes = []

  const tmdbTask = (async () => {
    // language는 표시용 제목을 고르는 값이다. 검색 자체는 여러 언어의
    // 번역 제목을 함께 훑는다.
    const data = await tmdb('/search/movie', {
      query: q,
      language: 'ko-KR',
      include_adult: 'false',
    })
    return (data.results ?? []).slice(0, 8).map(normalizeTmdb)
  })().catch(e => {
    notes.push(`TMDB 검색 실패: ${e.message}`)
    return []
  })

  const kmdbTask = kmdbSearch(q, 5).then(r => {
    if (r.note) notes.push(r.note)
    return r.results
  })

  const [tmdbResults, kmdbResults] = await Promise.all([tmdbTask, kmdbTask])

  // 한글이 섞인 질의는 한국 영화일 가능성이 높으므로 KMDb를 앞에 둔다.
  const hangul = /[가-힣]/.test(q)
  const results = hangul
    ? [...kmdbResults, ...tmdbResults]
    : [...tmdbResults, ...kmdbResults]

  res.setHeader('cache-control', 'no-store')
  res.status(200).json({
    query: q,
    count: results.length,
    results: results.slice(0, 10),
    notes,
  })
}
