// data/movies.json에서 정적 HTML을 만든다.
//
// 만드는 것
//   public/index.html            전체 목록 (벽돌형 비대칭)
//   public/group/<key>.html      6군별 목록
//   public/styles.html           분류 색인
//   public/page/<slug>.html      소개, 첫 대사 원칙
//   public/movie/<slug>.html     편별 상세
//   public/style.css             손으로 쓴 CSS + 글꼴 선언
//   public/fonts/                Pretendard, Outfit
//   public/admin.html            입력 도구
//
// 카드가 차지할 격자 행 수는 여기서 계산해 CSS 변수로 넣는다. 브라우저에서
// JavaScript를 돌리지 않는다.
//
// 실행: node build.mjs

import {
  readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync, readdirSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const OUT = join(root, 'public')

const records = JSON.parse(readFileSync(join(root, 'data', 'movies.json'), 'utf8'))
const groupsFile = JSON.parse(readFileSync(join(root, 'data', 'style-groups.json'), 'utf8'))
const pagesFile = JSON.parse(readFileSync(join(root, 'data', 'pages.json'), 'utf8'))
const GROUPS = groupsFile.groups
const UNASSIGNED = groupsFile.unassigned

// 영화 기록과 문서 기록을 나눈다. 소개글과 첫 대사 원칙은 목록에 섞이면 안 된다.
const movies = records.filter(r => r.record_kind !== 'page')
const docs = records
  .filter(r => r.record_kind === 'page')
  .map(r => ({ record: r, meta: pagesFile[r.id] ?? null }))
  .sort((a, b) => (a.meta?.order ?? 99) - (b.meta?.order ?? 99))
const navDocs = docs.filter(d => d.meta)

const SITE = 'Archives of the First Lines in Movies'
const ABBR = 'AFLM'
const MAIL = 'arche.jhj@gmail.com'
const OWNER = 'Hyeji Jung'
const YEAR = 2026

// ── 도구 ────────────────────────────────────────────────────────────────────
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const up = d => '../'.repeat(d) || './'

const groupByKey = new Map(GROUPS.map(g => [g.key, g]))
const groupOf = m => groupByKey.get(m.style_group) ?? UNASSIGNED

/** 한글과 한자는 라틴 문자 두 개 폭으로 센다. */
function visualLength(text) {
  let n = 0
  for (const ch of text) n += /[ᄀ-ᇿ　-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 2 : 1
  return n
}

/** 포스터 주소. 저장소 안 파일이면 페이지 깊이에 맞춰 앞을 붙인다. */
function posterSrc(url, depth) {
  if (!url) return null
  return /^https?:\/\//.test(url) ? url : up(depth) + url
}

// ── Notion·직접 작성 본문의 최소 변환기 ─────────────────────────────────────
// 제목, 문단, 번호 목록, 표, 링크만 알아본다. 원문에 없는 것을 만들지 않는다.
function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      (_, t, href) => `<a href="${href}"${/^https?:/.test(href) ? ' rel="noopener"' : ''}>${t}</a>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function renderNote(text) {
  const out = []
  const lines = text.split('\n')
  let list = null
  const flushList = () => { if (list) { out.push(`<ol>${list.join('')}</ol>`); list = null } }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') { flushList(); continue }

    // 표: | a | b |  다음 줄이 구분선이면 표로 본다
    if (line.startsWith('|') && /^\|[\s:|-]+\|$/.test((lines[i + 1] ?? '').trim())) {
      flushList()
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const head = cells(line)
      const body = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) body.push(cells(lines[i++]))
      i--
      out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
        `<tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flushList()
      out.push(`<h${Math.min(h[1].length + 2, 6)}>${inline(h[2])}</h${Math.min(h[1].length + 2, 6)}>`)
      continue
    }

    const li = line.match(/^\d+\.\s+(.*)$/)
    if (li) { (list ??= []).push(`<li>${inline(li[1])}</li>`); continue }

    flushList()
    out.push(`<p>${inline(line)}</p>`)
  }
  flushList()
  return out.join('\n')
}

// ── 공통 뼈대 ───────────────────────────────────────────────────────────────
function topbar(depth) {
  return `<header class="topbar">
<a class="mark" href="${up(depth)}index.html">${ABBR}&copy;</a>
<span class="tag">First lines of every film I watch</span>
<span class="count">${movies.length}</span>
<a class="mail" href="mailto:${MAIL}">${MAIL}</a>
</header>`
}

function hero(depth, lead) {
  return `<section class="hero">
<h1><a href="${up(depth)}index.html">${ABBR}&copy;</a></h1>
<span class="full">${esc(SITE)}</span>
${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
</section>`
}

function groupbar(depth, current) {
  const counts = new Map()
  for (const m of movies) {
    const k = groupOf(m).key
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const link = (href, label, opts = {}) =>
    `<a href="${up(depth)}${href}"${opts.group ? ` data-group="${opts.group}"` : ''}` +
    `${opts.current ? ' aria-current="page"' : ''}>${esc(label)}` +
    `${opts.n !== undefined ? `<span class="n">${opts.n}</span>` : ''}</a>`

  const items = [link('index.html', '전체', { current: current === 'all', n: movies.length })]
  for (const g of GROUPS) {
    items.push(link(`group/${g.key}.html`, g.name,
      { group: g.key, current: current === g.key, n: counts.get(g.key) ?? 0 }))
  }
  const un = counts.get(UNASSIGNED.key) ?? 0
  if (un > 0) {
    items.push(link(`group/${UNASSIGNED.key}.html`, UNASSIGNED.name,
      { group: UNASSIGNED.key, current: current === UNASSIGNED.key, n: un }))
  }
  items.push(link('styles.html', '분류', { current: current === 'styles' }))
  for (const d of navDocs) {
    items.push(link(`page/${d.meta.slug}.html`, d.meta.label, { current: current === d.meta.slug }))
  }
  return `<nav class="groupbar">${items.join('')}</nav>`
}

function page({ title, desc, body, depth = 0 }) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="color-scheme" content="light">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:site_name" content="${esc(SITE)}">
<link rel="icon" href="${up(depth)}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${up(depth)}style.css">
</head>
<body>
${topbar(depth)}
${body}
<footer class="foot">
<p>영화 정보와 포스터는 <a href="https://www.themoviedb.org/" rel="noopener">TMDB</a>와 <a href="https://www.kmdb.or.kr/" rel="noopener">KMDb</a>에서 가져왔습니다. 이 사이트는 TMDB의 인증을 받거나 승인을 받은 것이 아닙니다. 대사는 각 영화의 저작물이며 작품 확인을 위한 짧은 인용으로 싣습니다. 문의는 <a href="mailto:${MAIL}">${MAIL}</a>.</p>
<p class="copy">&copy; ${YEAR} ${esc(OWNER)}</p>
</footer>
</body>
</html>
`
}

// ── 목록 ────────────────────────────────────────────────────────────────────
function card(m, depth) {
  const g = groupOf(m)
  const line = m.first_line
  const shown = line ?? '첫 대사가 기록되지 않았습니다'
  const src = posterSrc(m.poster_url, depth)

  // 포스터가 있으면 포스터 + 아래 첫 대사, 없으면 첫 대사가 포스터 자리를 채운다
  const tile = src
    ? `<span class="tile"><img src="${esc(src)}" alt="" loading="lazy" decoding="async"></span>`
    : `<span class="tile text"><span>${esc(shown)}</span></span>`
  const cap = [
    src ? `<p class="line${line ? '' : ' empty'}">${esc(shown)}</p>` : '',
    `<p class="meta"><span class="t">${esc(m.title || '제목 없음')}</span>` +
      `${m.released ? esc(m.released) : ''}${m.edition ? ` ${esc(m.edition)}` : ''}` +
      `${m.style ? ` <span class="s">${esc(m.style)}</span>` : ' <span class="s">분류 없음</span>'}</p>`,
  ].join('\n')

  return `<a class="card" href="${up(depth)}movie/${encodeURIComponent(m.id)}.html" data-group="${g.key}">
${tile}
<div class="cap">
${cap}
</div>
</a>`
}

const SEED = 24   // 화면에 미리 그려 두는 카드 수. 나머지는 데이터에서 받아 그린다

/**
 * 목록 화면. 데이터는 HTML에 담지 않는다.
 * 처음 SEED장만 미리 그려 두고(JavaScript가 없거나 아직 안 왔을 때를 위해),
 * 나머지는 data/movies.json을 받아 같은 모양으로 이어 그린다.
 */
function listPage({ items, title, lead, current, depth = 0, desc, group = null }) {
  const seed = items.slice(0, SEED)
  const body = `${hero(depth, lead)}
${groupbar(depth, current)}
<main class="grid" id="grid" data-group-filter="${group ?? ''}" data-seed="${seed.length}" data-total="${items.length}">
${seed.map(m => card(m, depth)).join('\n')}
</main>
${items.length > SEED ? `<nav class="pager">
<button type="button" id="more" hidden>더 보기<span class="n">${items.length - SEED}</span></button>
<noscript><span>여기까지 ${SEED}편입니다. 나머지 ${items.length - SEED}편은 분류별 목록에서 볼 수 있습니다.</span></noscript>
</nav>` : ''}
<script src="${up(depth)}list.js" defer></script>`
  return page({ title, desc, body, depth })
}

// ── 상세 ────────────────────────────────────────────────────────────────────
function fact(term, value) {
  const empty = value === null || value === undefined || value === '' ||
    (Array.isArray(value) && value.length === 0)
  return `<dt>${esc(term)}</dt><dd${empty ? ' class="unknown"' : ''}>` +
    `${empty ? '확인되지 않음' : esc(Array.isArray(value) ? value.join(', ') : value)}</dd>`
}

function detailPage(m, siblings) {
  const g = groupOf(m)
  const alts = [m.title_original, m.title_ko, m.title_local].filter(t => t && t !== m.title)
  const src = posterSrc(m.poster_url, 1)

  const body = `${groupbar(1, g.key)}
<main class="detail" data-group="${g.key}">
<blockquote${m.first_line ? '' : ' class="empty"'}>${esc(m.first_line ?? '첫 대사가 기록되지 않았습니다.')}</blockquote>
<div class="rule"></div>
<div class="film">
${src
    ? `<a href="#poster" aria-label="포스터 크게 보기"><img class="poster" src="${esc(src)}" alt="${esc(m.title)} 포스터" loading="lazy" decoding="async"></a>`
    : '<div class="poster-none">포스터 없음</div>'}
<div>
<h2>${esc(m.title || '제목 없음')}</h2>
${alts.length ? `<p class="alt">${alts.map(esc).join(' &middot; ')}</p>` : ''}
<dl class="facts">
${fact('개봉연도', m.released)}
${fact('감독', m.director_ko && m.director !== m.director_ko ? `${m.director} (${m.director_ko})` : m.director)}
${fact('제작국', m.country)}
${fact('장르', m.genre)}
${m.tags.length ? fact('태그', m.tags) : ''}
${m.edition ? fact('판본', m.edition) : ''}
${m.watched_via?.name ? fact('본 곳', m.watched_via.name) : ''}
<dt>화법 분류</dt><dd>${m.style ? `<span class="chip">${esc(m.style)}</span> ${esc(g.name)}` : '<span class="unknown">지정되지 않음</span>'}</dd>
${fact('기록한 때', m.created_at ? m.created_at.slice(0, 10) : null)}
</dl>
</div>
</div>
${m.note ? `<section class="note"><p class="section-label">기록자 메모</p>${renderNote(m.note)}</section>` : ''}
${siblings.length ? `<section class="related">
<p class="section-label">같은 분류 ${esc(m.style ?? g.name)}</p>
<ol>
${siblings.map(s => `<li><a href="${encodeURIComponent(s.id)}.html">${esc(s.first_line ?? '첫 대사 없음')}<span class="sub">${esc(s.title)}${s.released ? ` &middot; ${esc(s.released)}` : ''}</span></a></li>`).join('\n')}
</ol>
</section>` : ''}
</main>
${src ? `<a class="lightbox" id="poster" href="#_" aria-label="닫기"><img src="${esc(src)}" alt="${esc(m.title)} 포스터 원본"><span class="hint">${esc(m.title)}</span></a>` : ''}`

  return page({
    title: `${m.first_line ?? m.title} — ${ABBR}`,
    desc: `${m.title}${m.released ? ` (${m.released})` : ''}의 첫 대사`,
    body,
    depth: 1,
  })
}

// ── 분류 색인 ───────────────────────────────────────────────────────────────
function stylesPage() {
  const perStyle = new Map()
  for (const m of movies) if (m.style) perStyle.set(m.style, (perStyle.get(m.style) ?? 0) + 1)

  const sections = GROUPS.map(g => {
    const total = g.styles.reduce((n, s) => n + (perStyle.get(s) ?? 0), 0)
    return `<section class="groupsec" data-group="${g.key}">
<h2><span class="swatch"></span>${esc(g.name)}<span class="n">${total}</span></h2>
<p class="def">${esc(g.definition)}</p>
<ul class="styles">
${g.styles.map(s => `<li>${esc(s)}<span class="n">${perStyle.get(s) ?? 0}</span></li>`).join('\n')}
</ul>
<p class="more"><a href="group/${g.key}.html">${esc(g.name)} ${total}편 보기</a></p>
</section>`
  }).join('\n')

  return page({
    title: `분류 — ${ABBR}`,
    desc: '영화 첫 대사의 화법 분류 체계',
    depth: 0,
    body: `${hero(0, `화법 분류 ${perStyle.size}종을 ${GROUPS.length}군으로 묶었습니다.`)}
${groupbar(0, 'styles')}
<main class="groups">
${sections}
</main>`,
  })
}

// ── 문서 (소개, 첫 대사 원칙) ───────────────────────────────────────────────
const colophon = existsSync(join(root, 'src', 'colophon.md'))
  ? readFileSync(join(root, 'src', 'colophon.md'), 'utf8')
  : null

function docPage({ record, meta }) {
  const slug = meta?.slug ?? record.id
  const heading = meta?.heading ?? record.title
  const withColophon = slug === 'about' && colophon

  const body = `${groupbar(1, slug)}
<main class="doc">
<h1>${esc(heading)}</h1>
${record.note ? renderNote(record.note) : '<p>내용이 비어 있습니다.</p>'}
${withColophon ? renderNote(colophon) : ''}
<p class="origin">Notion 원본에 <code>${esc(record.title)}</code>으로 기록돼 있던 글입니다.${record.created_at ? ` ${esc(record.created_at.slice(0, 10))} 작성.` : ''}</p>
</main>`

  return { slug, html: page({ title: `${heading} — ${ABBR}`, desc: heading, body, depth: 1 }) }
}

// ── 실행 ────────────────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true })
for (const d of ['movie', 'group', 'page', 'fonts']) mkdirSync(join(OUT, d), { recursive: true })

// 글꼴 선언을 style.css 앞에 붙인다. 파일이 public 바로 아래 있으므로
// fonts.css 안의 fonts/... 상대 경로가 그대로 맞는다.
const fontDir = join(root, 'src', 'fonts')
let fontCount = 0
if (existsSync(join(fontDir, 'fonts.css'))) {
  for (const f of readdirSync(fontDir)) {
    if (f.endsWith('.woff2')) { copyFileSync(join(fontDir, f), join(OUT, 'fonts', f)); fontCount++ }
  }
}
writeFileSync(join(OUT, 'style.css'),
  (existsSync(join(fontDir, 'fonts.css')) ? readFileSync(join(fontDir, 'fonts.css'), 'utf8') + '\n' : '') +
  readFileSync(join(root, 'src', 'style.css'), 'utf8'), 'utf8')

copyFileSync(join(root, 'src', 'favicon.svg'), join(OUT, 'favicon.svg'))
// GitHub Pages의 Jekyll 처리를 끈다. 밑줄로 시작하는 파일이 사라지지 않게.
writeFileSync(join(OUT, '.nojekyll'), '', 'utf8')
copyFileSync(join(root, 'data', 'style-groups.json'), join(OUT, 'style-groups.json'))
copyFileSync(join(root, 'data', 'venues.json'), join(OUT, 'venues.json'))
copyFileSync(join(root, 'src', 'list.js'), join(OUT, 'list.js'))

// 화면이 받아 쓸 데이터. 보여주는 데 필요한 값만 담는다.
// 원본 보존 필드와 출처 표시는 저장소의 movies.json에만 둔다.
mkdirSync(join(OUT, 'data'), { recursive: true })
writeFileSync(join(OUT, 'data', 'movies.json'), JSON.stringify({
  count: movies.length,
  fields: ['id', 'line', 'title', 'year', 'style', 'group', 'poster', 'edition'],
  items: movies.map(m => ({
    id: m.id,
    line: m.first_line,
    title: m.title || '제목 없음',
    year: m.released,
    style: m.style,
    group: groupOf(m).key,
    poster: m.poster_url,
    edition: m.edition ?? null,
  })),
}), 'utf8')
// admin.html은 배포본에 넣지 않는다. 입력은 로컬 admin-server에서만 한다.

// Notion에 딸려 있던 포스터
const posterDir = join(root, 'assets', 'posters')
let posters = 0
if (existsSync(posterDir)) {
  mkdirSync(join(OUT, 'assets', 'posters'), { recursive: true })
  for (const f of readdirSync(posterDir)) {
    copyFileSync(join(posterDir, f), join(OUT, 'assets', 'posters', f))
    posters++
  }
}

writeFileSync(join(OUT, 'index.html'), listPage({
  items: movies,
  title: `${SITE} (${ABBR})`,
  lead: '영화를 볼 때마다 맨 앞으로 돌려 첫 대사를 적었습니다. 2021년부터 모은 기록입니다.',
  current: 'all',
  desc: '2021년부터 모은 영화 첫 대사 아카이브',
}), 'utf8')

const allGroups = [...GROUPS, UNASSIGNED]
let groupPages = 0
for (const g of allGroups) {
  const items = movies.filter(m => groupOf(m).key === g.key)
  if (items.length === 0) continue
  writeFileSync(join(OUT, 'group', `${g.key}.html`), listPage({
    items,
    title: `${g.name} — ${ABBR}`,
    lead: `${g.definition} ${items.length}편.`,
    current: g.key,
    depth: 1,
    desc: g.definition,
    group: g.key,
  }), 'utf8')
  groupPages++
}

writeFileSync(join(OUT, 'styles.html'), stylesPage(), 'utf8')

for (const d of docs) {
  const { slug, html } = docPage(d)
  writeFileSync(join(OUT, 'page', `${slug}.html`), html, 'utf8')
}

for (const m of movies) {
  const siblings = movies.filter(s => s.id !== m.id && s.style && s.style === m.style).slice(0, 5)
  writeFileSync(join(OUT, 'movie', `${m.id}.html`), detailPage(m, siblings), 'utf8')
}

const withPoster = movies.filter(m => m.poster_url).length
console.log(`목록 1, 분류별 ${groupPages}, 분류 색인 1, 문서 ${docs.length}, 상세 ${movies.length} 생성 완료.`)
console.log(`포스터 ${withPoster}/${movies.length}편, 기록자 메모 ${movies.filter(m => m.note).length}건, 글꼴 조각 ${fontCount}개.`)
