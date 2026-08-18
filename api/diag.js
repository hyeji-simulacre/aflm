// 임시 진단용. 저장이 404로 막히는 원인을 배포 환경에서 직접 확인한다.
//
// 원인을 찾으면 이 파일을 지운다. 남겨 둘 것이 아니다.
//
// 값은 내보내지 않는다. 길이와 형식, GitHub의 판정만 돌려준다.
// 쓰기 확인은 일부러 틀린 sha로 요청해서 한다. 권한이 있으면 409(충돌),
// 없으면 404가 온다. 어느 쪽이든 파일은 바뀌지 않는다.
//
// GET /api/diag

import { requireAuth, MOVIES_FILE } from './_lib.mjs'

const FAKE_SHA = '0'.repeat(40)

async function ghRaw(path, init = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  })
  const body = await r.json().catch(() => ({}))
  return { status: r.status, body }
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return

  const token = process.env.GITHUB_TOKEN ?? ''
  const repo = process.env.GITHUB_REPO ?? ''
  const branch = process.env.GITHUB_BRANCH || 'main'

  const out = {
    token: {
      길이: token.length,
      형식: token.startsWith('github_pat_') ? 'fine-grained'
        : token.startsWith('ghp_') ? 'classic'
        : '알 수 없음',
      앞뒤공백: token !== token.trim(),
      줄바꿈포함: /[\r\n]/.test(token),
    },
    repo: { 값: repo, 앞뒤공백: repo !== repo.trim() },
    branch,
  }

  const r1 = await ghRaw(`/repos/${repo}`)
  out.저장소조회 = r1.status === 200
    ? { status: 200, full_name: r1.body.full_name, 기본브랜치: r1.body.default_branch, 권한: r1.body.permissions }
    : { status: r1.status, message: r1.body.message }

  const r2 = await ghRaw(`/repos/${repo}/contents/${MOVIES_FILE}?ref=${encodeURIComponent(branch)}`)
  out.파일읽기 = { status: r2.status, message: r2.body.message ?? null }

  const r3 = await ghRaw(`/repos/${repo}/contents/${MOVIES_FILE}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: '권한 확인용. 저장되지 않습니다.',
      content: Buffer.from('probe', 'utf8').toString('base64'),
      sha: FAKE_SHA,
      branch,
    }),
  })
  out.쓰기확인 = {
    status: r3.status,
    message: r3.body.message ?? null,
    판정: r3.status === 409 ? '쓰기 권한 있음 (sha가 달라 거절된 것이라 파일은 그대로)'
      : r3.status === 404 ? '쓰기 권한 없음'
      : r3.status === 401 ? '토큰을 받지 않음'
      : '예상 밖',
  }

  res.setHeader('cache-control', 'no-store')
  res.status(200).json(out)
}
