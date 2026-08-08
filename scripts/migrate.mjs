// Notion 내보내기 CSV를 movies.json으로 옮긴다.
//
// 원칙
//   1. 원본 값을 지우지 않는다. 정규화한 값은 새 필드에 넣고 원본은 *_notion_original에 남긴다.
//   2. 판별하지 못한 값은 null로 둔다. 코드가 값을 지어내지 않는다.
//   3. 사람 확인이 필요한 건은 report에 모아 출력한다.
//
// 실행: node scripts/migrate.mjs

import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSV = join(root, 'data', 'movies-notion-original.csv')
const GROUPS = join(root, 'data', 'style-groups.json')
const OUT = join(root, 'data', 'movies.json')
const REPORT = join(root, 'data', 'migration-report.json')

// ── CSV 파싱 (따옴표 안의 쉼표와 줄바꿈을 다룬다) ────────────────────────────
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // BOM 제거
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }

  // 헤더만 trim한다. 값은 원본 그대로 둔다. 후행 공백도 기록의 일부이므로
  // 정규화는 호출하는 쪽에서 필요한 필드에만 적용한다.
  const header = rows.shift().map(h => h.trim())
  return rows
    .filter(r => r.some(v => v.trim() !== ''))
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

// ── 한국어 생성일을 KST ISO 문자열로 ─────────────────────────────────────────
// 예: '2021년 7월 31일 오후 8:15' → '2021-07-31T20:15:00+09:00'
function parseKoreanDateTime(raw) {
  const m = raw.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*(오전|오후)\s*(\d{1,2}):(\d{2}))?/)
  if (!m) return null
  const [, y, mo, d, ampm, hRaw, min] = m
  let h = hRaw ? Number(hRaw) : 0
  if (ampm === '오후' && h !== 12) h += 12
  if (ampm === '오전' && h === 12) h = 0
  const p = n => String(n).padStart(2, '0')
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${min ?? '00'}:00+09:00`
}

// ── 개봉연도 정규화. 4자리 연도를 못 찾으면 null ─────────────────────────────
function parseYear(raw) {
  const m = raw.match(/\b(1[89]\d{2}|20\d{2})\b/)
  return m ? m[1] : null
}

// ── slug. 한글과 한자는 그대로 두고 파일명에 못 쓰는 문자만 걷어낸다 ─────────
function makeSlug(title, year) {
  const base = title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, ' ')   // 그림문자는 주소에 넣지 않는다
    .replace(/[\/\\:*?"<>|#%{}$+`=@!&,.]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return year ? `${base}-${year}` : base
}

// ── md 본문 읽기 ────────────────────────────────────────────────────────────
// CSV에는 속성 여섯 개만 있고, 본문에 적어둔 메모와 대사 번역은 md 쪽에만
// 있다. 이 내용을 note로 옮긴다. 표에 없다고 버리면 기록이 사라진다.
function loadNotes(exportDir) {
  const byCreated = new Map()
  const byTitle = new Map()
  if (!existsSync(exportDir)) return { byCreated, byTitle }

  for (const name of readdirSync(exportDir)) {
    if (!name.endsWith('.md')) continue
    const text = readFileSync(join(exportDir, name), 'utf8')
    const lines = text.split('\n')

    // 첫 줄은 '# 제목', 이어서 '키: 값' 속성 목록, 빈 줄 다음이 본문이다.
    let i = 0
    const heading = lines[0]?.startsWith('# ') ? lines[0].slice(2).trim() : null
    i = 1
    while (i < lines.length && lines[i].trim() === '') i++
    let created = null
    while (i < lines.length && /^[^:\n]{1,20}:\s/.test(lines[i])) {
      const m = lines[i].match(/^생성일:\s*(.+)$/)
      if (m) created = m[1].trim()
      i++
    }

    const body = lines.slice(i)
      .filter(l => !/^!\[[^\]]*\]\([^)]*\)\s*$/.test(l))  // 이미지 줄은 뺀다
      .join('\n').trim()

    if (!body) continue
    if (created) byCreated.set(created, body)
    if (heading) byTitle.set(heading, body)
  }
  return { byCreated, byTitle }
}

// ── Notion 내보내기에 딸려 온 포스터 찾기 ───────────────────────────────────
// 내보내기 폴더에 <제목>/ 하위 이미지가 있으면 그 편의 포스터다.
// 없으면 null로 둔다. 다른 곳에서 이미지를 가져다 채우지 않는다.
const EXPORT_DIR = join(root, 'data', 'notion-export-md')
const ASSET_DIR = join(root, 'assets', 'posters')
const IMG = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

function findNotionPoster(title) {
  if (!title || !existsSync(EXPORT_DIR)) return null
  const dir = join(EXPORT_DIR, title)
  if (!existsSync(dir)) return null
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return null }
  const img = entries.find(e => e.isFile() && IMG.has(extname(e.name).toLowerCase()))
  return img ? join(dir, img.name) : null
}

// ── 실행 ────────────────────────────────────────────────────────────────────
const rows = parseCsv(readFileSync(CSV, 'utf8'))
const groupsFile = JSON.parse(readFileSync(GROUPS, 'utf8'))

const styleToGroup = new Map()
for (const g of groupsFile.groups) {
  for (const s of g.styles) styleToGroup.set(s, g.key)
}
const genreToTag = groupsFile.genre_to_tag

const report = {
  generated_at_note: '이 파일은 사람이 확인해야 할 건만 모은 것이다.',
  total: rows.length,
  style_missing: [],
  style_unmapped: [],
  first_line_missing: [],
  released_unparsed: [],
  created_at_unparsed: [],
  title_trimmed: [],
  slug_collision: [],
  empty_slug: [],
  not_a_movie_suspect: [],
  poster_from_notion: [],
  note_carried: [],
  pages: [],
}

const notes = loadNotes(EXPORT_DIR)

const seenSlugs = new Map()
const movies = []

for (const [i, r] of rows.entries()) {
  const titleRaw = r['TITLE'] ?? ''
  const title = titleRaw.trim()
  if (title !== titleRaw) report.title_trimmed.push({ row: i + 2, before: titleRaw, after: title })

  const releasedRaw = (r['Released'] ?? '').trim()
  const year = parseYear(releasedRaw)
  if (releasedRaw === '') {
    report.released_unparsed.push({ row: i + 2, title, value: '(빈값)', reason: '값 없음' })
  } else if (year === null) {
    report.released_unparsed.push({ row: i + 2, title, value: releasedRaw, reason: '4자리 연도를 찾지 못함' })
  } else if (releasedRaw !== year) {
    // 연도만 적힌 형식이 아니다. 추출은 했으나 사람이 원본을 확인해야 한다.
    report.released_unparsed.push({ row: i + 2, title, value: releasedRaw, extracted: year, reason: '연도 외 문자가 섞임' })
  }

  const firstLine = (r['The First line'] ?? '').trim()
  if (firstLine === '') report.first_line_missing.push({ row: i + 2, title })

  const style = (r['Style'] ?? '').trim()
  let styleGroup = null
  if (style === '') {
    report.style_missing.push({ row: i + 2, title, first_line: firstLine })
  } else {
    styleGroup = styleToGroup.get(style) ?? null
    if (styleGroup === null) report.style_unmapped.push({ row: i + 2, title, style })
  }

  const genreRaw = (r['Genre'] ?? '').trim()
  const genreParts = genreRaw.split(',').map(s => s.trim()).filter(Boolean)
  const genre = []
  const tags = []
  for (const p of genreParts) {
    if (Object.prototype.hasOwnProperty.call(genreToTag, p)) tags.push(genreToTag[p])
    else genre.push(p)
  }

  const createdRaw = (r['생성일'] ?? '').trim()
  const createdAt = parseKoreanDateTime(createdRaw)
  if (createdRaw !== '' && createdAt === null) {
    report.created_at_unparsed.push({ row: i + 2, title, value: createdRaw })
  }

  let slug = makeSlug(title, year)
  if (slug === '') {
    // 제목이 비어 있어 주소를 만들 수 없다. 원본 행 번호로 임시 주소를 준다.
    // 사람이 제목을 채우면 주소도 제목을 따르게 다시 만든다.
    slug = `untitled-row-${i + 2}`
    report.empty_slug.push({ row: i + 2, first_line: firstLine, assigned: slug })
  }
  if (seenSlugs.has(slug)) {
    const n = seenSlugs.get(slug) + 1
    seenSlugs.set(slug, n)
    report.slug_collision.push({ row: i + 2, title, slug, resolved: `${slug}-${n}` })
    slug = `${slug}-${n}`
  } else {
    seenSlugs.set(slug, 1)
  }

  // Notion에 함께 저장돼 있던 포스터를 저장소로 옮긴다.
  let posterUrl = null
  let posterSource = null
  const found = findNotionPoster(title)
  if (found) {
    mkdirSync(ASSET_DIR, { recursive: true })
    const name = `${slug}${extname(found).toLowerCase()}`
    copyFileSync(found, join(ASSET_DIR, name))
    posterUrl = `assets/posters/${name}`
    posterSource = 'notion-original'
    report.poster_from_notion.push({ row: i + 2, title, file: name })
  }

  // md 본문에 적어둔 메모와 대사 번역. 생성일이 가장 확실한 짝이고,
  // 없으면 제목으로 찾는다. 못 찾으면 null로 둔다.
  const note = notes.byCreated.get(createdRaw) ?? notes.byTitle.get(title) ?? null
  if (note) report.note_carried.push({ row: i + 2, title, chars: note.length })

  // 영화가 아닌 기록. Notion에서 Genre를 '깊이없는 영화광'으로 표시해 둔
  // 행이 소개글과 첫 대사 원칙 두 건이다. 추측이 아니라 원본의 표시를 따른다.
  const kind = genreParts.includes('깊이없는 영화광') ? 'page' : 'movie'
  if (kind === 'page') report.pages.push({ row: i + 2, title, chars: note?.length ?? 0 })

  movies.push({
    id: slug,
    record_kind: kind,
    note,
    title,
    title_notion_original: titleRaw,
    title_original: null,
    title_ko: null,
    title_local: null,
    first_line: firstLine || null,
    style: style || null,
    style_group: styleGroup,
    genre,
    genre_notion_original: genreRaw,
    tags,
    released: year,
    released_notion_original: releasedRaw,
    release_date: null,
    director: null,
    country: null,
    poster_url: posterUrl,
    tmdb_id: null,
    kmdb_id: null,
    created_at: createdAt,
    updated_at: null,
    source: {
      first_line: 'human',
      style: 'human',
      genre: 'notion-original',
      released: 'notion-original',
      title: 'notion-original',
      note: note ? 'notion-original' : null,
      poster_url: posterSource,
    },
  })
}

writeFileSync(OUT, JSON.stringify(movies, null, 2) + '\n', 'utf8')
writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8')

console.log(`총 ${movies.length}편을 data/movies.json에 기록했다.`)
console.log('')
console.log('사람이 확인해야 할 건')
console.log(`  Style 빈값            ${report.style_missing.length}건`)
console.log(`  Style 6군 미매핑      ${report.style_unmapped.length}건`)
console.log(`  첫 대사 빈값          ${report.first_line_missing.length}건`)
console.log(`  개봉연도 판별 실패    ${report.released_unparsed.length}건`)
console.log(`  생성일 판별 실패      ${report.created_at_unparsed.length}건`)
console.log(`  제목 공백 정리        ${report.title_trimmed.length}건`)
console.log(`  slug 충돌             ${report.slug_collision.length}건`)
console.log(`  제목 빈값(주소 임시) ${report.empty_slug.length}건`)
console.log(`  영화 아닌 기록(문서)  ${report.pages.length}건`)
console.log('')
console.log('원본에서 함께 옮긴 것')
console.log(`  md 본문 메모          ${report.note_carried.length}건`)
console.log(`  Notion 포스터         ${report.poster_from_notion.length}건`)
console.log('')
console.log('자세한 내용은 data/migration-report.json 참고.')
