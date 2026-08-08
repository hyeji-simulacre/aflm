// 웹폰트를 저장소 안으로 가져온다. 한 번만 돌리면 되고, 빌드에는 끼지 않는다.
//
// 한국어  Pretendard (orioncactus/pretendard, OFL 1.1)
//         동적 subset 92조각. 브라우저가 실제로 쓰는 글자 조각만 내려받는다.
// 영어    Outfit (Google Fonts, OFL 1.1)
//
// 외부 CDN을 페이지에서 부르지 않기 위해 파일을 직접 보관한다. 배포 후에도
// 바깥 서비스가 멈추는 것과 무관하게 글꼴이 유지된다.
//
// 실행: node scripts/fetch-fonts.mjs

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'src', 'fonts')
mkdirSync(OUT, { recursive: true })

const PRETENDARD_VERSION = '1.3.9'
const WEIGHT = 'Medium'   // 굵기는 하나만 쓴다. 크기와 자간으로 위계를 만든다.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function get(url, binary = false) {
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return binary ? Buffer.from(await r.arrayBuffer()) : r.text()
}

// ── Pretendard ──────────────────────────────────────────────────────────────
const base = `https://cdn.jsdelivr.net/npm/pretendard@${PRETENDARD_VERSION}`
const dynCss = await get(`${base}/dist/web/static/pretendard-dynamic-subset.css`)

// 쓰는 굵기의 @font-face만 남기고, 조각 파일 주소를 저장소 안 경로로 바꾼다.
const faces = dynCss.split('@font-face').slice(1)
  .map(s => '@font-face' + s.slice(0, s.indexOf('}') + 1))
  .filter(s => s.includes(`Pretendard-${WEIGHT}.subset.`))

if (faces.length === 0) throw new Error(`${WEIGHT} 굵기의 @font-face를 찾지 못했습니다.`)

let bytes = 0
const rewritten = []
for (const face of faces) {
  const m = face.match(/url\(([^)]+\.woff2)\)/)
  if (!m) continue
  const rel = m[1].replace(/^["']|["']$/g, '')
  const file = rel.split('/').pop()
  const buf = await get(new URL(rel, `${base}/dist/web/static/`).href, true)
  writeFileSync(join(OUT, file), buf)
  bytes += buf.length
  // 원본 CSS는 woff2 뒤에 woff 경로를 덧붙여 두는데, 그 파일은 저장소에
  // 없으므로 통째로 지우고 woff2 하나만 남긴다.
  rewritten.push(
    face.replace(/src:[^;]+;/, `src: url(fonts/${file}) format('woff2');`)
        .replace(/font-family:\s*['"]?Pretendard[^;'"]*['"]?/, "font-family: 'Pretendard'")
        .replace(/\s*\n\s*/g, ' ')
        .trim())
}

console.log(`Pretendard ${WEIGHT}  조각 ${rewritten.length}개, ${(bytes / 1024).toFixed(0)}KB`)

// ── Outfit ──────────────────────────────────────────────────────────────────
const outfitCss = await get(
  'https://fonts.googleapis.com/css2?family=Outfit:wght@500&display=swap')

const outfitFaces = []
for (const face of outfitCss.split('@font-face').slice(1)) {
  const block = '@font-face' + face.slice(0, face.indexOf('}') + 1)
  const m = block.match(/url\((https:\/\/[^)]+\.woff2)\)/)
  if (!m) continue
  const name = `outfit-${outfitFaces.length}.woff2`
  const buf = await get(m[1], true)
  writeFileSync(join(OUT, name), buf)
  bytes += buf.length
  outfitFaces.push(block.replace(/url\([^)]+\)/, `url(fonts/${name})`)
    .replace(/\s*\n\s*/g, ' ').trim())
}

console.log(`Outfit 500        조각 ${outfitFaces.length}개`)

// ── @font-face 모음 파일 ────────────────────────────────────────────────────
const header = `/* 자동 생성 파일. scripts/fetch-fonts.mjs 가 만든다. 손으로 고치지 말 것.
   Pretendard ${PRETENDARD_VERSION} (orioncactus/pretendard, SIL Open Font License 1.1)
   Outfit (Google Fonts, SIL Open Font License 1.1)
   두 글꼴 모두 저장소 안에 두고 외부 CDN을 부르지 않는다. */\n\n`

writeFileSync(join(OUT, 'fonts.css'),
  header + [...outfitFaces, ...rewritten].join('\n') + '\n', 'utf8')

writeFileSync(join(OUT, 'LICENSE.md'), `# 글꼴 라이선스

이 폴더의 글꼴 파일은 각각 아래 라이선스를 따른다. 둘 다 SIL Open Font License 1.1이며 웹 사용과 재배포가 허용된다.

| 글꼴 | 만든 곳 | 라이선스 |
|------|--------|---------|
| Pretendard ${PRETENDARD_VERSION} | orioncactus (길형진) | SIL Open Font License 1.1 |
| Outfit | Smartsheet, Google Fonts | SIL Open Font License 1.1 |

- Pretendard: https://github.com/orioncactus/pretendard
- Outfit: https://fonts.google.com/specimen/Outfit
`, 'utf8')

console.log(`합계 ${(bytes / 1024).toFixed(0)}KB, src/fonts/ 에 보관했습니다.`)
console.log('한 번 방문에 실제로 오가는 양은 쓰는 글자에 해당하는 조각뿐입니다.')
