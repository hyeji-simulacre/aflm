// 새 기록을 data/movies.json에 더한다.
//
// GitHub Contents API로 커밋한다. 커밋이 그대로 변경 이력이자 백업이 되고,
// Vercel이 push를 감지해 사이트를 다시 만든다. 별도 데이터베이스를 두지
// 않는 이유가 이것이다.
//
// 레코드를 만드는 규칙은 _record.mjs에 있다. 로컬 입력 서버도 같은 파일을 쓴다.
//
// POST /api/save
// body: { title, first_line, style, style_group, watched_via, edition, note, tags, meta }

import { requireAuth, requireEnv, readMovies, writeMovies, writeErrorMessage } from './_lib.mjs'
import { buildRecord } from './_record.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 받습니다.' })
    return
  }
  if (!requireAuth(req, res)) return
  if (!requireEnv(res, ['GITHUB_TOKEN', 'GITHUB_REPO'])) return

  let record
  try {
    record = buildRecord(req.body ?? {})
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message })
    return
  }

  let current
  try {
    current = await readMovies()
  } catch (e) {
    res.status(502).json({ error: `현재 파일을 읽지 못했습니다: ${e.message}` })
    return
  }

  if (current.movies.some(m => m.id === record.id)) {
    res.status(409).json({ error: `이미 있는 기록입니다: ${record.id}` })
    return
  }

  current.movies.push(record)

  try {
    await writeMovies({
      ...current,
      message: `기록 추가: ${record.title}${record.released ? ` (${record.released})` : ''}`,
    })
  } catch (e) {
    // sha가 어긋나면 그 사이에 다른 곳에서 저장한 것이다. 덮어쓰지 않는다.
    const conflict = /GitHub 409/.test(e.message)
    res.status(conflict ? 409 : 502).json({ error: writeErrorMessage(e) })
    return
  }

  res.status(200).json({
    ok: true,
    id: record.id,
    total: current.movies.length,
    note: '저장되었습니다.',
  })
}
