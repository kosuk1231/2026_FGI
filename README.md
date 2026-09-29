# FGI 모집·승낙 현황 시스템 (Vercel + 서비스 계정)

Apps Script 없이 Vercel 서버 함수가 구글 스프레드시트에 직접 읽고 씁니다.

## 파일 구조 (저장소 최상위에 그대로)
```
index.html        ← 현황판 + 참여자 화면
api/index.js      ← 서버 함수 (/api)
package.json      ← google-auth-library 의존성
```

## 1. 구글 쪽 준비
1. Google Cloud Console → 프로젝트 `clim-503123` → API 및 서비스 → **Google Sheets API 사용 설정**
2. IAM 및 관리자 → 서비스 계정 → `kosuk1231@clim-503123.iam.gserviceaccount.com` → 키 → **키 추가 → JSON** (파일 다운로드)
3. 스프레드시트 `1FEsoCfklBheT7CakQOAUvP25b3RN59O1EboC-efn3Io` → 공유 → 위 서비스 계정 이메일을 **편집자**로 추가

## 2. Vercel 환경변수 (Settings → Environment Variables)
| 이름 | 값 |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | 다운로드한 JSON 파일 내용 **전체** 붙여넣기 |
| `ADMIN_PW` | 연구진용 관리자 비밀번호 |
| `SHEET_ID` | (선택) 다른 시트를 쓸 때만 |

환경변수를 넣은 뒤 **Redeploy** 해야 반영됩니다.

## 3. 확인
- `https://배포주소/api?action=ping` → `{"ok":true,...}`
- 현황판 첫 로그인 시 시트에 '참여자·일정·로그' 탭이 없으면 자동 생성됩니다
  (Apps Script setup으로 이미 만든 탭이 있으면 그대로 사용)

## 주소 체계
| 주소 | 용도 |
|---|---|
| `/` | 관리자 현황판 |
| `/?t=토큰` | 개별 초대 응답 |
| `/?apply=실무자` 등 | 그룹별 공개 신청 |
