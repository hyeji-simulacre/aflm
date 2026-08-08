// 부드러운 스크롤. NGAC 시즌3에서 쓰던 설정을 그대로 가져왔다.
//
// Lenis는 저장소 안(vendor/)에 두고 쓴다. 바깥 서비스를 부르지 않는다.
// duration 1.2 + easeOutExpo가 차분한 속도를 만든다. 휠 배수나 관성은
// 건드리지 않는다. 손대면 읽는 사람이 화면과 씨름하게 된다.
//
// 움직임을 줄이도록 설정한 기기에서는 아예 켜지 않는다.
// Lenis가 실제 scrollTop을 움직이므로 목록의 무한 이어붙이기와
// CSS 스크롤 연출은 그대로 작동한다.

(function () {
  'use strict'

  if (typeof Lenis !== 'function') return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  var lenis = new Lenis({
    duration: 1.2,
    easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)) },
  })

  function raf(time) {
    lenis.raf(time)
    requestAnimationFrame(raf)
  }
  requestAnimationFrame(raf)

  // 포스터 층이 열려 있는 동안에는 뒤 화면이 움직이지 않게 멈춘다.
  var dialog = document.getElementById('poster')
  if (dialog) {
    dialog.addEventListener('close', function () { lenis.start() })
    var opener = document.querySelector('[data-lightbox]')
    if (opener) opener.addEventListener('click', function () { lenis.stop() })
  }
})()
