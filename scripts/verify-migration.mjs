// movies.json이 Notion 원본과 어긋나지 않는지 대조한다.
//
// 첫 대사와 화법 분류는 사람이 쓴 값이므로 한 글자도 달라지면 안 된다.
// 제목과 개봉연도는 정규화한 값이라 원본과 다를 수 있고, 그 경우 원본 보존
// 필드에 그대로 남아 있는지를 본다.
//
// 실행: node scripts/verify-migration.mjs
// 종료 코드 0이면 이상 없음, 1이면 불일치 있음.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  const header = rows.shift().map(h => h.trim())
  return rows.filter(r => r.some(v => v.trim() !== ''))
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

const csv = parseCsv(readFileSync(join(root, 'data', 'movies-notion-original.csv'), 'utf8'))
const json = JSON.parse(readFileSync(join(root, 'data', 'movies.json'), 'utf8'))

const problems = []

// Notion에서 옮겨 온 기록과 그 뒤에 새로 넣은 기록을 가른다.
// 이전분에는 title_notion_original이 있고, 새 기록에는 없다(null).
// 이 검증이 보는 것은 '이전분이 원본 그대로인가'이지 '전체 편수가 165인가'가
// 아니다. 새 기록이 늘어난다고 이전이 틀어진 것은 아니다.
const migrated = json.filter(m => m.title_notion_original !== null)
const added = json.filter(m => m.title_notion_original === null)

if (csv.length !== migrated.length) {
  problems.push(`이전분 편수 불일치: 원본 ${csv.length}, 이전분 ${migrated.length}`)
}

const n = Math.min(csv.length, migrated.length)
for (let i = 0; i < n; i++) {
  const a = csv[i], b = migrated[i]
  const row = i + 2
  const where = `${row}행 ${b.title || '(제목 없음)'}`

  const firstLine = (a['The First line'] ?? '').trim()
  const expectFirst = firstLine === '' ? null : firstLine
  if (b.first_line !== expectFirst) {
    problems.push(`${where}: 첫 대사 불일치\n    원본 ${JSON.stringify(expectFirst)}\n    변환 ${JSON.stringify(b.first_line)}`)
  }

  const style = (a['Style'] ?? '').trim()
  const expectStyle = style === '' ? null : style
  if (b.style !== expectStyle) {
    problems.push(`${where}: 화법 분류 불일치\n    원본 ${JSON.stringify(expectStyle)}\n    변환 ${JSON.stringify(b.style)}`)
  }

  if (b.title_notion_original !== (a['TITLE'] ?? '')) {
    problems.push(`${where}: 제목 원본 보존 실패\n    원본 ${JSON.stringify(a['TITLE'])}\n    보존 ${JSON.stringify(b.title_notion_original)}`)
  }

  if (b.released_notion_original !== (a['Released'] ?? '').trim()) {
    problems.push(`${where}: 개봉연도 원본 보존 실패`)
  }

  if (b.genre_notion_original !== (a['Genre'] ?? '').trim()) {
    problems.push(`${where}: 장르 원본 보존 실패`)
  }
}

// 주소가 겹치면 페이지가 덮어써진다.
const ids = new Map()
for (const m of json) {
  if (m.id === '' || m.id === null) problems.push(`${m.title}: 주소(id)가 비어 있음`)
  if (ids.has(m.id)) problems.push(`주소 중복: ${m.id} (${ids.get(m.id)}, ${m.title})`)
  ids.set(m.id, m.title)
}

console.log(`원본 ${csv.length}행, 이전분 ${migrated.length}편 대조. 이전 후 추가 ${added.length}편(대조 대상 아님).`)
if (problems.length === 0) {
  console.log('불일치 0건.')
  process.exit(0)
}
console.log(`\n불일치 ${problems.length}건\n`)
for (const p of problems) console.log('  ' + p)
process.exit(1)
