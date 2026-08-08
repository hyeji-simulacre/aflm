// 사람이 고른 영화 한 편의 상세 정보를 가져온다.
//
// TMDB는 번역 제목과 국가별 대체 제목을 검색 결과에 다 담지 않으므로
// 여기서 한 번 더 불러 한국어 제목, 원제, 제작국 언어 제목, 감독을 채운다.
// KMDb 결과는 검색 단계에서 이미 상세까지 받으므로 그대로 돌려준다.
//
// GET /api/detail?source=tmdb&id=<tmdb_id>

import { requireAuth, requireEnv, tmdb, directorNames, pickOriginalPoster } from './_lib.mjs'

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return

  const source = String(req.query.source ?? '').trim()
  const id = String(req.query.id ?? '').trim()

  if (source !== 'tmdb') {
    res.status(400).json({
      error: 'source는 tmdb만 상세 조회를 지원합니다. KMDb 결과는 검색 응답을 그대로 쓰세요.',
    })
    return
  }
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ error: 'TMDB id가 올바르지 않습니다.' })
    return
  }
  if (!requireEnv(res, ['TMDB_API_KEY'])) return

  let m
  try {
    m = await tmdb(`/movie/${id}`, {
      language: 'ko-KR',
      append_to_response: 'alternative_titles,translations,credits',
    })
    // 포스터는 별도로 받는다. append로 함께 받으면 language=ko-KR에 걸러져
    // 한국판 포스터만 온다. 원하는 것은 제작국 오리지널 포스터다.
    m.images = await tmdb(`/movie/${id}/images`, {
      include_image_language: `${m.original_language ?? 'en'},null`,
    })
  } catch (e) {
    res.status(502).json({ error: `TMDB 상세 조회 실패: ${e.message}` })
    return
  }

  // 한국어 제목. 번역 목록에 없으면 null로 둔다. 원제를 한국어 제목인 척
  // 넣지 않는다.
  const translations = m.translations?.translations ?? []
  const ko = translations.find(t => t.iso_639_1 === 'ko')
  const titleKo = ko?.data?.title?.trim() || null

  // 제작국 언어 제목. 원어가 영어면 따로 두지 않는다.
  const originalLang = m.original_language ?? null
  const localTr = originalLang && originalLang !== 'en'
    ? translations.find(t => t.iso_639_1 === originalLang)
    : null
  const titleLocal = localTr?.data?.title?.trim() || (originalLang && originalLang !== 'en' ? m.original_title ?? null : null)

  // 감독은 원어 표기 + 한국어 음차. 사람 정보는 호출을 한 번 더 한다.
  const crew = (m.credits?.crew ?? []).filter(c => c.job === 'Director')
  let director = crew[0]?.name ?? null
  let directorKo = null
  if (crew[0]?.id) {
    try {
      const n = await directorNames(crew[0].id, originalLang ?? m.original_language)
      director = n.native ?? director
      directorKo = n.ko
    } catch { /* 사람 조회가 실패해도 로마자 이름은 남긴다 */ }
  }

  const countries = (m.production_countries ?? []).map(c => c.iso_3166_1)
  const origin = m.origin_country ?? []

  res.setHeader('cache-control', 'no-store')
  res.status(200).json({
    source: 'tmdb',
    tmdb_id: m.id,
    title: m.title ?? null,
    title_original: m.original_title ?? null,
    title_ko: titleKo,
    title_local: titleLocal,
    release_date: m.release_date || null,
    year: m.release_date ? m.release_date.slice(0, 4) : null,
    genre: (m.genres ?? []).map(g => g.name),
    director,
    director_ko: directorKo,
    country: (origin[0] ?? countries[0]) ?? null,
    original_language: originalLang,
    poster_url: pickOriginalPoster(m, originalLang ?? m.original_language),
    alternative_titles: (m.alternative_titles?.titles ?? [])
      .map(t => ({ country: t.iso_3166_1, title: t.title })),
  })
}
