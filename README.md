# AFLM — Archives of the First Lines in Movies

영화를 볼 때마다 맨 앞으로 돌려 첫 대사를 적은 개인 아카이브. 2021년부터 모았고, 2026년 8월 HTML의 날 서울을 계기로 Notion에서 손으로 쓴 정적 사이트로 옮겼다.

프레임워크를 쓰지 않는다. HTML과 CSS를 직접 쓰고, Node 표준 모듈만으로 정적 파일을 만든다. 브라우저에서 도는 JavaScript는 없다. JS를 꺼도 전체 목록이 그대로 읽힌다.

---

## 새 기록을 넣는 법

```bash
node scripts/admin-server.mjs
# http://localhost:4400/admin.html 을 연다
```

1. 암호 칸에 아무 값이나 넣는다 (로컬 접속만 받으므로 형식만 유지한다)
2. 영화 제목을 넣고 찾는다. 한국어, 영어, 제작국 언어 모두 된다
3. 후보 목록에서 직접 고른다. 자동으로 확정하지 않는다
4. 첫 대사와 화법 분류를 쓴다. 본 곳과 판본은 선택이다
5. 저장하면 `data/movies.json`에 쓰고 빌드까지 돌린다

```bash
git add -A && git commit -m "기록 추가: 제목" && git push
```

push하면 GitHub Actions가 검증하고 다시 만들어 Pages에 올린다.

입력 화면은 배포본에 넣지 않는다. 공개 사이트에는 열람 페이지만 있다.

---

## 데이터를 직접 고치는 법

`data/movies.json`이 단일 원본이다. 편집기로 열어 고친 뒤 다음을 돌린다.

```bash
node scripts/verify-migration.mjs   # 원본 대조. 불일치 0건이어야 한다
node build.mjs                      # 정적 파일 생성
node scripts/serve.mjs              # http://localhost:4321 에서 확인
```

새 필드를 넣고 싶으면 `data/movies.json`에 키를 더하고, 보여줄 자리를 `build.mjs`의 `detailPage`나 `card`에 적으면 된다.

선택지를 늘리려면 데이터 파일만 고친다.

| 파일 | 다루는 것 |
|------|----------|
| `data/style-groups.json` | 화법 분류 20종, 6군 묶음, 군별 색 |
| `data/venues.json` | 본 곳 선택지 (영화관, OTT 등) |
| `data/pages.json` | 소개·원칙 문서의 주소와 이동줄 이름 |

---

## 구성

```
data/
  movies-notion-original.csv   Notion 원본. 수정하지 않는다
  notion-export-md/            Notion 개별 문서 원본
  movies.json                  단일 원본(SSOT)
  style-groups.json            분류 20종 → 6군, 색
  venues.json                  본 곳 선택지
  pages.json                   문서 기록의 주소
  migration-report.json        이전 시 사람 확인이 필요한 건
  enrich-review.json           API 매칭에서 사람이 골라야 하는 건
assets/posters/                Notion에 함께 있던 포스터
src/
  style.css                    손으로 쓴 CSS
  list.js                      목록이 데이터를 받아 카드를 이어 그림
  colophon.md                  소개 페이지에 붙는 제작 기록
  fonts/                       Pretendard, Outfit (자체 보관)
  favicon.svg
api/                           검색·상세 조회 핸들러 (로컬 서버가 재사용)
scripts/
  migrate.mjs                  CSV + md → movies.json
  verify-migration.mjs         원본 대조 검증
  enrich.mjs                   TMDB·KMDb로 메타데이터 일괄 보강
  fetch-fonts.mjs              글꼴 내려받기 (한 번만)
  admin-server.mjs             입력 도구 서버 (로컬 전용)
  serve.mjs                    열람 확인용 서버
build.mjs                      movies.json → 정적 HTML + public/data/movies.json
admin.html                     입력 화면 (배포 제외)
```

---

## 데이터 규칙

1. **원본을 지우지 않는다.** 정규화한 값은 새 필드에 넣고 원본은 `*_notion_original`에 남긴다
2. **판별하지 못한 값은 `null`로 둔다.** 코드가 그럴듯한 값을 지어내지 않는다
3. **`source`에 출처를 적는다.** 사람이 쓴 값(`human`), Notion 원본(`notion-original`), API가 채운 값(`tmdb`, `kmdb`)을 구분한다
4. **자동 확정하지 않는다.** 제목이 정확히 같고 개봉연도 차이가 1년 이내일 때만 자동으로 채우고, 나머지는 `enrich-review.json`에 후보와 함께 남겨 사람이 고르게 한다

---

## 메타데이터 일괄 보강

```bash
node scripts/enrich.mjs           # 확인만 한다
node scripts/enrich.mjs --write   # movies.json에 반영한다
```

포스터는 제작국 언어판을 먼저 고르고, 없으면 글자 없는 판을 쓴다. 감독 이름은 원어 표기와 한국어 음차를 함께 가져온다.

키는 볼트 `.env`(`00-system/03-config/.env`)의 `TMDB_API_KEY`와 `API_KMDB`를 읽는다. 저장소 `.env`가 있으면 그쪽이 우선한다. 어느 파일도 저장소에 올라가지 않는다.

---

## 라이선스

코드는 개인 프로젝트다. 글꼴은 `src/fonts/LICENSE.md` 참고.

영화 정보와 포스터는 [TMDB](https://www.themoviedb.org/)와 [KMDb](https://www.kmdb.or.kr/)에서 가져왔다. 이 사이트는 TMDB의 인증이나 승인을 받은 것이 아니다. 대사는 각 영화의 저작물이며 작품 확인을 위한 짧은 인용으로 싣는다.

문의: arche.jhj@gmail.com
