// 자동 확정된 매칭 가운데 의심스러운 건을 찾는다.
//
// enrich.mjs는 제목이 같고 개봉연도가 1년 이내면 자동으로 채운다.
// 그 규칙이 엉뚱한 영화를 붙일 수 있다. DEJAVU가 스페인 영화 Dejavú(2005)에
// 붙은 것이 그런 경우다. 확정된 값을 되짚어 신호가 약한 건을 모은다.
//
// 판정하지 않는다. 사람이 볼 목록을 만들 뿐이다.
//
// 실행: node scripts/audit-matches.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv(p) {
  if (!existsSync(p)) return {}
  const o = {}
  for (const l of readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m && m[2].trim()) o[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return o
}
Object.assign(process.env, loadEnv(join(
  process.env.VAULT_ROOT || join(homedir(), 'Documents', '정혜지-PAAM-2026-v3'),
  '00-system', '03-config', '.env')), loadEnv(join(root, '.env')))

const { tmdb } = await import('../api/_lib.mjs')

const records = JSON.parse(readFileSync(join(root, 'data', 'movies.json'), 'utf8'))
const films = records.filter(r => r.record_kind !== 'page' && r.tmdb_id)

const suspects = []
const sleep = ms => new Promise(r => setTimeout(r, ms))

for (const m of films) {
  const why = []

  // 포스터가 하나도 없는 작품은 거의 없다. 없다면 잘 알려지지 않은 동명 작품일 수 있다.
  if (!m.poster_url) why.push('포스터 없음')

  // 개봉연도가 원본과 어긋나면 다른 판이거나 다른 작품이다.
  if (m.released && m.release_date) {
    const gap = Math.abs(Number(m.released) - Number(m.release_date.slice(0, 4)))
    if (gap >= 1) why.push(`개봉연도 ${gap}년 차이 (원본 ${m.released}, TMDB ${m.release_date.slice(0, 4)})`)
  }

  if (why.length === 0) continue

  // 의심되는 건만 TMDB를 다시 불러 실제 값을 붙인다
  let info = null
  try {
    const d = await tmdb(`/movie/${m.tmdb_id}`)
    info = {
      title: d.title, original_title: d.original_title,
      year: d.release_date?.slice(0, 4) ?? null,
      language: d.original_language,
      popularity: Math.round((d.popularity ?? 0) * 10) / 10,
      vote_count: d.vote_count ?? 0,
    }
    // 평가 수가 아주 적으면 동명의 다른 작품일 가능성이 높다
    if ((d.vote_count ?? 0) < 30) why.push(`TMDB 평가 ${d.vote_count}건뿐`)
  } catch (e) {
    why.push(`TMDB 조회 실패: ${e.message}`)
  }
  await sleep(60)

  suspects.push({ id: m.id, title: m.title, released: m.released, tmdb_id: m.tmdb_id, why, tmdb: info })
}

suspects.sort((a, b) => b.why.length - a.why.length)

writeFileSync(join(root, 'data', 'match-audit.json'),
  JSON.stringify({
    note: '자동 확정된 매칭 가운데 신호가 약한 건. 판정은 사람이 한다.',
    checked: films.length,
    suspect_count: suspects.length,
    suspects,
  }, null, 2) + '\n', 'utf8')

console.log(`TMDB에 붙은 ${films.length}편을 점검했습니다.`)
console.log(`의심스러운 건 ${suspects.length}편\n`)
for (const s of suspects) {
  console.log(`  ${s.title} (${s.released ?? '연도없음'})`)
  console.log(`     붙은 것: ${s.tmdb?.title ?? '?'} / ${s.tmdb?.original_title ?? '?'} ${s.tmdb?.year ?? ''} [${s.tmdb?.language ?? ''}] 평가 ${s.tmdb?.vote_count ?? '?'}건`)
  console.log(`     이유: ${s.why.join(', ')}`)
}
console.log('\n자세한 내용은 data/match-audit.json 참고.')
