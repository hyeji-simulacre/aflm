# AFLM — Archives of the First Lines in Movies

영화를 볼 때마다 맨 앞으로 돌려 첫 대사를 적은 개인 아카이브. 2021년부터 모았고, 2026년 8월 HTML의 날 서울을 계기로 Notion에서 손으로 쓴 정적 사이트로 옮겼다.

프레임워크를 쓰지 않는다. HTML과 CSS를 직접 쓰고, Node 표준 모듈만으로 정적 파일을 만든다. 목록 데이터는 HTML 안에 넣지 않고 `data/movies.json`으로 따로 두며, 40줄 남짓한 순수 JavaScript가 그것을 받아 카드를 이어 그린다. JS를 꺼도 미리 그려 둔 24편과 분류별 목록은 그대로 읽힌다.

---

## 기록을 넣고 고치는 법

### 사이트에서 (평소 쓰는 길)

`https://aflm.contexta.co.kr/admin.html`을 연다. 암호는 기기마다 한 번만 넣으면 되고, 그 뒤부터는 사이트 어느 페이지에서든 우하단 버튼으로 들어간다. 버튼은 암호를 통과한 기기에만 나타난다.

- **새로 넣기**: 제목으로 찾고, 후보에서 직접 고르고, 첫 대사와 화법 분류를 쓴다. 본 곳·판본·메모는 선택이다
- **고치기**: 검색어를 비워 두고 찾으면 빠진 값이 있는 기록만 모아 보여준다. 제목 일부로 찾을 수도 있다. 보낸 값만 바뀌고 손대지 않은 값은 그대로 둔다

저장하면 GitHub에 커밋되고 Vercel이 사이트를 다시 만든다. 1분쯤 걸린다. 커밋이 그대로 변경 이력이자 백업이므로 별도 데이터베이스를 두지 않는다.

휴대폰은 입력 화면을 홈 화면에 추가해 두면 앱처럼 열린다.

### 노트북에서 (인터넷 없이, 또는 여러 건을 몰아서)

```bash
node scripts/admin-server.mjs
# http://localhost:4400/admin.html 을 연다
```

암호 칸에는 아무 값이나 넣는다. 로컬 접속만 받으므로 형식만 유지한다. 화면과 규칙은 사이트와 같고, 저장 자리만 다르다. 여기서는 `data/movies.json`에 바로 쓰고 빌드까지 돌린다.

```bash
git add -A && git commit -m "기록 추가: 제목" && git push
```

### 접근을 막는 것

입력 화면은 공개 주소에 있고 누구나 열면 암호 칸까지 보인다. 감추는 것에 기대지 않는다. 실제로 막는 것은 다음 세 가지다.

1. 서버 함수 네 개(`search`·`detail`·`save`·`update`)가 모두 `ADMIN_PASSPHRASE`를 먼저 확인한다. 비교는 `crypto.timingSafeEqual`로 한다
2. 암호는 32자 이상 임의 문자열을 쓴다. 기기에 한 번 저장하면 다시 묻지 않으므로 외울 필요가 없다
3. `GITHUB_TOKEN`은 이 저장소 하나, `Contents: Read and write` 하나만 가진 fine-grained PAT를 쓴다

TMDB 키·KMDb 키·GitHub 토큰·암호는 모두 Vercel 환경변수에만 있고 서버 함수 안에서만 쓴다. 브라우저로 내려가는 어떤 파일에도 들어 있지 않다.

기기를 잃으면 Vercel에서 `ADMIN_PASSPHRASE`를 바꾼다. 모든 기기가 함께 끊긴다.

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
| `data/match-overrides.json` | 자동 매칭이 못 찾거나 잘못 붙인 건을 사람이 직접 지정 |

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
api/
  _lib.mjs                     암호 확인, TMDB·KMDb 호출, GitHub Contents API
  _record.mjs                  기록을 만들고 고치는 규칙 (단일 출처)
  search.js                    TMDB + KMDb 동시 검색
  detail.js                    고른 후보의 상세 조회
  save.js                      새 기록을 커밋
  record.js                    기존 기록 한 건 + 파일 판본(sha)
  update.js                    기존 기록 수정 커밋 (sha 대조)
scripts/
  migrate.mjs                  CSV + md → movies.json
  verify-migration.mjs         원본 대조 검증
  enrich.mjs                   TMDB·KMDb로 메타데이터 일괄 보강
  audit-matches.mjs            자동 확정된 짝 가운데 의심스러운 건 찾기
  fetch-fonts.mjs              글꼴 내려받기 (한 번만)
  admin-server.mjs             입력 도구 서버 (로컬 전용, api/ 핸들러 재사용)
  serve.mjs                    열람 확인용 서버
build.mjs                      movies.json → 정적 HTML + public/data/movies.json
admin.html                     입력 화면
vercel.json                    빌드 설정, 입력 화면·API 머리글
```

밑줄로 시작하는 `api/_lib.mjs`와 `api/_record.mjs`는 Vercel이 함수로 만들지 않는다. 나머지 다섯 파일만 주소를 갖는다.

`api/_record.mjs`가 기록의 모양을 정하는 유일한 자리다. 로컬 입력 서버와 배포 함수가 이 파일 하나를 함께 쓰므로, 노트북으로 넣은 기록과 휴대폰으로 넣은 기록의 모양이 같다.

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

자동 매칭이 엉뚱한 영화를 붙일 수 있다. `node scripts/audit-matches.mjs`가 포스터 없음, 개봉연도 차이, TMDB 평가 수 부족 같은 약한 신호를 모아 `data/match-audit.json`에 적는다. 잘못 붙은 건은 `data/match-overrides.json`에 TMDB id를 직접 적으면 다음 실행부터 검색을 건너뛰고 그것을 쓴다.

키는 볼트 `.env`(`00-system/03-config/.env`)의 `TMDB_API_KEY`와 `API_KMDB`를 읽는다. 저장소 `.env`가 있으면 그쪽이 우선한다. 어느 파일도 저장소에 올라가지 않는다.

---

## 배포

Vercel이 만든다. `main`에 push하면 `vercel.json`의 `buildCommand`가 원본 대조 검증을 먼저 돌리고 `build.mjs`로 `public/`을 만든다. 검증이 깨지면 배포도 멈춘다.

GitHub Actions는 검증만 한다(`.github/workflows/verify.yml`). 배포하지 않는다. 배포 경로를 둘로 두면 어느 쪽이 지금 화면인지 알 수 없게 된다.

Vercel 환경변수 다섯을 넣어야 한다.

| 이름 | 값 |
|------|---|
| `TMDB_API_KEY` | TMDB v4 읽기 토큰 또는 v3 키 |
| `API_KMDB` | KMDb 인증키 |
| `ADMIN_PASSPHRASE` | 입력 화면 접근 암호. 32자 이상 임의 문자열 |
| `GITHUB_TOKEN` | 이 저장소 `Contents: Read and write` 하나만 가진 fine-grained PAT |
| `GITHUB_REPO` | `hyeji-simulacre/aflm` |

`GITHUB_BRANCH`는 넣지 않으면 `main`이다.

2026-08-08에는 GitHub Pages로 배포했고 2026-08-09에 Vercel로 옮겼다. 사이트에서 바로 기록을 넣으려면 서버 함수가 필요한데 Pages는 정적 파일만 내보내기 때문이다. `build.mjs`는 여전히 `CNAME`과 `.nojekyll`을 만든다. 가비아에서 `aflm` CNAME을 `hyeji-simulacre.github.io`로 되돌리는 것만으로 예전 배포가 다시 산다.

---

## 라이선스

코드는 개인 프로젝트다. 글꼴은 `src/fonts/LICENSE.md` 참고.

영화 정보와 포스터는 [TMDB](https://www.themoviedb.org/)와 [KMDb](https://www.kmdb.or.kr/)에서 가져왔다. 이 사이트는 TMDB의 인증이나 승인을 받은 것이 아니다. 대사는 각 영화의 저작물이며 작품 확인을 위한 짧은 인용으로 싣는다.

문의: arche.jhj@gmail.com
