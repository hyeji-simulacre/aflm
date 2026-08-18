// 기존 기록 한 건을 통째로 낸다. 고치기 화면이 폼을 채울 때 쓴다.
//
// 공개 data/movies.json은 목록에 필요한 값만 담은 요약본이라 고치기에 쓸 수 없다.
// 여기서는 저장소 원본을 읽어 그대로 돌려준다.
//
// 함께 내는 sha는 그 시점의 파일 판본이다. 저장할 때 이 값을 되돌려 받아
// 그 사이에 다른 곳에서 저장한 일이 있었는지 가려낸다.
//
// GET /api/record?id=<기록 주소>

import { requireAuth, requireEnv, readMovies } from './_lib.mjs'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET만 받습니다.' })
    return
  }
  if (!requireAuth(req, res)) return
  if (!requireEnv(res, ['GITHUB_TOKEN', 'GITHUB_REPO'])) return

  const id = String(req.query?.id ?? '').trim()
  if (!id) {
    res.status(400).json({ error: 'id가 없습니다.' })
    return
  }

  let current
  try {
    current = await readMovies()
  } catch (e) {
    res.status(502).json({ error: `현재 파일을 읽지 못했습니다: ${e.message}` })
    return
  }

  const record = current.movies.find(m => m.id === id)
  if (!record) {
    res.status(404).json({ error: `없는 기록입니다: ${id}` })
    return
  }

  res.setHeader('cache-control', 'no-store')
  res.status(200).json({ record, sha: current.sha })
}
