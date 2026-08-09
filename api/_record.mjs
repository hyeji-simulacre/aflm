// 기록 한 건을 만들고 고치는 규칙. 이 파일이 단일 출처다.
//
// 로컬 입력 서버(scripts/admin-server.mjs)와 배포 함수(api/save.js, api/update.js)가
// 이 파일을 함께 쓴다. 같은 규칙이 여러 벌로 갈라지면 어느 쪽으로 넣었느냐에 따라
// 다른 모양의 기록이 쌓인다. 그것을 막으려고 한 곳에 모았다.
//
// 이름이 밑줄로 시작하므로 Vercel이 이 파일을 함수로 만들지 않는다.

/** 입력이 잘못됐을 때 던진다. 부르는 쪽이 status를 그대로 응답 코드로 쓴다. */
export class InputError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * 제목과 개봉연도로 주소를 만든다.
 * 그림문자와 문장부호를 걷어내고 남은 글자를 하이픈으로 잇는다.
 */
export function makeSlug(title, year) {
  const base = String(title ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[\/\\:*?"<>|#%{}$+`=@!&,.]/g, ' ')
    .trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!base) return null
  return year ? `${base}-${year}` : base
}

/** 개봉연도에서 네 자리 숫자만 꺼낸다. 없으면 null. */
export function yearOf(value) {
  return value ? String(value).match(/\d{4}/)?.[0] ?? null : null
}

/**
 * 본 곳. 이름이 없으면 통째로 null이다.
 * 고른 적이 없는 것과 '고르지 않음'을 구분하지 않는다. 둘 다 기록이 없는 상태다.
 */
export function normalizeWatchedVia(wv) {
  if (!wv || !wv.name) return null
  const name = String(wv.name).trim()
  if (!name) return null
  return { kind: wv.kind ?? null, name }
}

/** 빈 문자열은 null로 본다. 공백만 남은 값을 기록으로 남기지 않으려는 것이다. */
function textOrNull(value) {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t || null
}

/**
 * 수정 화면이 다룰 수 있는 값.
 * id와 개봉연도는 여기 없다. 주소가 바뀌면 이미 나간 링크가 끊기기 때문이다.
 */
export const EDITABLE = [
  'title', 'first_line', 'style', 'style_group',
  'watched_via', 'edition', 'note', 'tags',
]

/**
 * 새 기록을 만든다.
 * 값을 구하지 못한 항목은 null로 둔다. 그럴듯한 기본값을 지어내지 않는다.
 * source에 어느 값이 사람 손이고 어느 값이 API에서 왔는지 남긴다.
 */
export function buildRecord(b, now = new Date().toISOString()) {
  const title = String(b.title ?? '').trim()
  const firstLine = String(b.first_line ?? '').trim()
  const style = String(b.style ?? '').trim()
  const meta = b.meta ?? {}

  if (!title) throw new InputError(400, '제목이 없습니다.')
  if (!firstLine) throw new InputError(400, '첫 대사가 없습니다.')
  if (!style) throw new InputError(400, '화법 분류를 골라야 합니다.')

  const year = yearOf(meta.year)
  const id = makeSlug(title, year)
  if (!id) throw new InputError(400, '제목으로 주소를 만들 수 없습니다.')

  return {
    id,
    record_kind: 'movie',
    note: textOrNull(b.note),
    watched_via: normalizeWatchedVia(b.watched_via),
    edition: textOrNull(b.edition),
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
  }
}

/**
 * 기존 기록을 고친다. 보낸 값만 덮는다.
 * 고친 값은 사람이 쓴 것이므로 source에 human으로 표시한다. API가 채운 값을
 * 사람이 손보면 그 사실이 남아야 나중에 일괄 보강이 다시 덮어쓰지 않는다.
 *
 * 하나도 바뀌지 않았으면 null을 돌려준다. 부르는 쪽이 헛커밋을 만들지 않게 한다.
 */
export function applyEdit(record, b, now = new Date().toISOString()) {
  const next = { ...record, source: { ...(record.source ?? {}) } }
  let changed = false

  for (const field of EDITABLE) {
    if (!(field in b)) continue

    let value
    if (field === 'watched_via') value = normalizeWatchedVia(b[field])
    else if (field === 'tags') value = Array.isArray(b[field]) ? b[field] : []
    else if (field === 'title' || field === 'first_line' || field === 'style') {
      value = String(b[field] ?? '').trim()
      if (!value) throw new InputError(400, `${field} 값이 비어 있습니다.`)
    } else value = textOrNull(b[field])

    if (JSON.stringify(next[field] ?? null) === JSON.stringify(value ?? null)) continue

    next[field] = value
    // style_group은 style에서 따라 나오는 값이라 출처를 따로 적지 않는다.
    if (field !== 'style_group') next.source[field] = 'human'
    changed = true
  }

  if (!changed) return null

  next.updated_at = now
  return next
}
