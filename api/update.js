// 기존 기록 한 건을 고친다.
//
// /api/record가 낸 sha를 함께 받아, 그 사이에 다른 곳에서 저장한 일이 있으면
// 덮어쓰지 않고 거절한다. 휴대폰과 노트북에서 같은 기록을 동시에 고칠 때
// 나중 저장이 앞 저장을 조용히 지우는 일을 막는다.
//
// 보낸 값만 덮는다. 보내지 않은 필드는 손대지 않는다.
//
// PUT /api/update
// body: { id, sha, title?, first_line?, style?, style_group?,
//         watched_via?, edition?, note?, tags? }

import { requireAuth, requireEnv, readMovies, writeMovies } from './_lib.mjs'
import { applyEdit } from './_record.mjs'

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    res.status(405).json({ error: 'PUT만 받습니다.' })
    return
  }
  if (!requireAuth(req, res)) return
  if (!requireEnv(res, ['GITHUB_TOKEN', 'GITHUB_REPO'])) return

  const b = req.body ?? {}
  const id = String(b.id ?? '').trim()
  const sentSha = String(b.sha ?? '').trim()
  if (!id) { res.status(400).json({ error: 'id가 없습니다.' }); return }
  if (!sentSha) { res.status(400).json({ error: '판본(sha)이 없습니다.' }); return }

  let current
  try {
    current = await readMovies()
  } catch (e) {
    res.status(502).json({ error: `현재 파일을 읽지 못했습니다: ${e.message}` })
    return
  }

  if (current.sha !== sentSha) {
    res.status(409).json({
      error: '그 사이에 다른 곳에서 저장했습니다. 화면을 새로 고쳐 최신 값을 받은 뒤 다시 고치세요.',
    })
    return
  }

  const at = current.movies.findIndex(m => m.id === id)
  if (at < 0) { res.status(404).json({ error: `없는 기록입니다: ${id}` }); return }

  let next
  try {
    next = applyEdit(current.movies[at], b)
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message })
    return
  }

  // 바뀐 값이 없으면 커밋하지 않는다. 내용 없는 커밋을 이력에 남기지 않는다.
  if (!next) {
    res.status(200).json({ ok: true, id, changed: false, note: '바뀐 값이 없습니다.' })
    return
  }

  current.movies[at] = next

  try {
    await writeMovies({
      ...current,
      message: `기록 수정: ${next.title}${next.released ? ` (${next.released})` : ''}`,
    })
  } catch (e) {
    const conflict = /GitHub 409/.test(e.message)
    res.status(conflict ? 409 : 502).json({
      error: conflict
        ? '그 사이에 다른 곳에서 저장했습니다. 화면을 새로 고친 뒤 다시 고치세요.'
        : `고치지 못했습니다: ${e.message}`,
    })
    return
  }

  res.status(200).json({
    ok: true,
    id,
    changed: true,
    note: '사이트를 다시 만들기까지 1분쯤 걸립니다.',
  })
}
