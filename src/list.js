// 목록 화면이 데이터를 받아 카드를 이어 그린다.
//
// HTML에는 앞의 몇 장만 들어 있고, 나머지는 data/movies.json에서 온다.
// 이 파일이 없거나 JavaScript가 꺼져 있어도 미리 그려 둔 카드는 그대로 보인다.

(function () {
  'use strict'

  var grid = document.getElementById('grid')
  var more = document.getElementById('more')
  var status = document.getElementById('list-status')
  if (!grid) return

  function announce(text) {
    if (status) status.textContent = text
  }

  var seed = Number(grid.dataset.seed || 0)
  var filter = grid.dataset.groupFilter || ''
  // 깊이는 빌드가 적어 준다. 주소로 짐작하면 하위 경로 배포에서 어긋난다.
  var depth = grid.dataset.base || './'

  var STEP = 24
  var items = null
  var shown = seed

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  // build.mjs의 card()와 같은 모양을 만든다. 한쪽만 고치면 어긋난다.
  function card(m) {
    var a = document.createElement('a')
    a.className = 'card'
    a.href = depth + 'movie/' + encodeURIComponent(m.id) + '.html'
    a.setAttribute('data-group', m.group)
    if (m.span) {
      a.style.setProperty('--s4', m.span.s4)
      a.style.setProperty('--s3', m.span.s3)
      a.style.setProperty('--s2', m.span.s2)
    }
    if (m.ar) a.style.setProperty('--ar', m.ar)

    // 저장소 안 포스터는 상대 경로로 들어 있다. 페이지 깊이에 맞춰 앞을 붙인다.
    var poster = m.poster && !/^https?:\/\//.test(m.poster) ? depth + m.poster : m.poster
    var shownLine = m.line || '첫 대사가 기록되지 않았습니다'
    var meta = '<p class="meta"><span class="t">' + esc(m.title) + '</span>' +
      (m.year ? esc(m.year) : '') + (m.edition ? ' ' + esc(m.edition) : '') +
      (m.style ? ' <span class="s">' + esc(m.style) + '</span>'
               : ' <span class="s">분류 없음</span>') + '</p>'

    a.innerHTML = poster
      ? '<span class="tile"><img src="' + esc(poster) + '" alt="" loading="lazy" decoding="async"></span>' +
        '<div class="cap"><p class="line' + (m.line ? '' : ' empty') + '">' + esc(shownLine) + '</p>' + meta + '</div>'
      : '<span class="tile text"><span>' + esc(shownLine) + '</span></span>' +
        '<div class="cap">' + meta + '</div>'
    return a
  }

  function render() {
    var next = items.slice(shown, shown + STEP)
    var frag = document.createDocumentFragment()
    for (var i = 0; i < next.length; i++) frag.appendChild(card(next[i]))
    grid.appendChild(frag)
    shown += next.length

    var left = items.length - shown
    if (left > 0) {
      more.hidden = false
      more.innerHTML = '더 보기<span class="n">' + left + '</span>'
      announce(next.length + '편을 더 불러왔습니다. ' + shown + '편 표시 중, ' + left + '편 남았습니다.')
    } else {
      announce(next.length + '편을 더 불러왔습니다. ' + shown + '편 전부를 표시했습니다.')
      if (more) more.remove()
    }
  }

  fetch(depth + 'data/movies.json')
    .then(function (r) {
      if (!r.ok) throw new Error(r.status)
      return r.json()
    })
    .then(function (d) {
      items = filter ? d.items.filter(function (m) { return m.group === filter }) : d.items
      if (items.length <= shown) { if (more) more.remove(); return }
      if (!more) return
      more.hidden = false
      more.addEventListener('click', render)

      // 버튼 근처까지 내려오면 알아서 이어 붙인다. 버튼도 그대로 남긴다.
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
          if (entries[0].isIntersecting && items.length > shown) render()
        }, { rootMargin: '600px' }).observe(more)
      }
    })
    .catch(function () {
      // 데이터를 못 받으면 미리 그려 둔 카드만 남는다. 화면을 망가뜨리지 않는다.
      announce('목록을 더 불러오지 못했습니다.')
      if (more) {
        more.hidden = false
        more.disabled = true
        more.textContent = '목록을 더 불러오지 못했습니다'
      }
    })
})()
