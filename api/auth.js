// 암호가 맞는지만 확인한다.
//
// 입력 화면이 암호 칸에서 바로 맞고 틀림을 알려주려면 물어볼 자리가 있어야 한다.
// 이것이 없으면 틀린 암호로도 화면이 넘어가고, 검색이나 저장을 눌러야 그제서야
// 막힌다. 어디가 잘못됐는지 알기 어렵다.
//
// 응답에는 맞다는 사실만 담는다. 암호도, 다른 어떤 값도 돌려주지 않는다.
//
// GET /api/auth

import { requireAuth } from './_lib.mjs'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET만 받습니다.' })
    return
  }
  if (!requireAuth(req, res)) return

  res.setHeader('cache-control', 'no-store')
  res.status(200).json({ ok: true })
}
