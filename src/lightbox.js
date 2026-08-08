// 포스터를 원본 크기로 여는 층.
//
// dialog 요소를 쓴다. showModal()이 Escape 닫기와 배경 탭 차단을 맡고,
// 닫힐 때 포커스는 열었던 버튼으로 돌아간다. 이 파일이 없거나 브라우저가
// dialog를 모르면 버튼이 아무 일도 하지 않을 뿐, 상세 페이지는 그대로다.

(function () {
  'use strict'

  var dialog = document.getElementById('poster')
  var opener = document.querySelector('[data-lightbox]')
  if (!dialog || !opener || typeof dialog.showModal !== 'function') return

  opener.addEventListener('click', function () {
    dialog.showModal()
  })

  // 사진 바깥을 누르면 닫는다. 사진 자체를 누른 것과 구분한다.
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) dialog.close()
  })

  dialog.addEventListener('close', function () {
    opener.focus()
  })
})()
