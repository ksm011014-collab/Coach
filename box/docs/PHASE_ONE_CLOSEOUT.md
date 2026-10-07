# 1차 목표 정리 — 2026-09-25

## 적용 범위

9월 25일 사용자 요청에 따라 모션인식 성능·정확도와 코칭 피드백 개선은 후속 과제로 이관한다. 이미 적용한 변경과 평가 자료는 보존하되 추가 모델 교체나 판정 조정은 진행하지 않는다. 카메라·녹화·운동 기록 저장의 안정성은 유지한다. 실제 AI 챗봇 연결, 모델 선택, 사용량, 대화 화면은 이번 범위에 포함한다.

## 구현 확인

| 항목 | 현재 구현과 확인 근거 |
| --- | --- |
| 화면 정리 | 촬영 안내와 반복 세션 바로가기·일반 새로고침 버튼 제거. 설정 화면에서 카메라 설정 제외. 회원 등록은 필터 도구 모음 오른쪽에 배치. 운동 기록은 history 아이콘 사용. 라이트·다크 표면과 테두리 적용. 카메라 내부 초기화 기능은 보존. |
| 한국어·영어 | 중앙 `web/scripts/i18n.js`, 저장되는 언어 선택, 로그인·설정·주요 관리 화면·공통 오류·라운드 대화 연결. 언어 전환/재접속, 회원 데이터 원문 보존, 영어 모바일 화면 검증. |
| 중앙 서비스 | 기존 Supabase staging 재사용, 20개 마이그레이션 적용 기록과 역할별 로그인·센터 격리 검증. 로컬 SQLite 모드 및 hosted 웹/API·Windows 브리지 구조 유지. 환경 예시, 배포·복구·SQLite 이전 절차 구비. |
| AI 챗봇 | 서버 관리 GPT-4.1 mini/GPT-5 mini 선택, 실제 한국어·영어 응답과 토큰 집계 확인. 서버 키 보관, 저장된 기록 기반 요약, 중복·시간 제한·오류 복구, 미측정 사용량 구분. 실제 제공자 증거는 9월 24일 기록이며 이번 정리에서 유료 호출을 반복하지 않음. |
| 라운드 대화 화면 | 실제 시간·점수·요약 중심의 왼쪽 화면과 대화 영역, 테마·언어·390/1366 화면 검증. 실제 음성 공급자 연결은 이번 요청에 포함되지 않으며 미연결 상태를 명시. |
| 안정성 | 회원 등록/수정과 저장 재조회, 녹화 재생/저장, 저장 실패 재시도, 중복 시작 방지, 권한 거부, PWA 캐시 흐름 검증. |

## 9월 25일 최종 검증

- `python -m unittest discover -s tests`: 117개 통과. 서버·중앙 게이트웨이·권한·런타임·패키징 계약 포함.
- `node tests/test_language_browser.js`: 통과. 새로 생성된 영어 모바일 라이트 설정 화면도 직접 확인.
- `node tests/test_operations_live_browser.js`: 실제 임시 SQLite 회원 등록·수정·상품 저장 통과.
- `node tests/test_coach_api_browser.js`: 모델/언어/사용량/미측정 상태/중복 재시도/저장 경고 통과(모의 API).
- `node tests/test_round_coach_browser.js`: 닫기·다음 라운드·중복·로그아웃 및 반응형 테마 통과. 영어 데스크톱 라이트 팝업도 직접 확인. 테스트의 직접 언어 주입은 배경 내비게이션 재렌더링을 생략하므로 전체 화면 언어 검증은 별도 language 검사에 근거함.
- `node tests/rls/test_policies.mjs`: PostgreSQL 역할·센터·세션·챗봇 권한 허용/차단 통과.
- `node tests/test_coach_edge.mjs`, `node tests/test_coach_conversation.mjs`: 통과(모의 제공자, 추가 유료 요청 없음).
- `BOXING_COACH_TEST_CAMERA_SOURCE=canvas`로 `node tests/test_session_browser.js`: 녹화 저장·재생·재시도·역할·카메라 거부·PWA 통과. 생성 스트림 검사이며 실제 WebView2 장치 인수와는 구분함.
- Windows Desktop `dotnet build --no-restore`: 경고 0, 오류 0. SmokeTests 실행: DPAPI 저장, 로컬 출처, hosted 브리지 정책 통과. SDK의 사용자 홈 쓰기 제한은 작업 폴더의 `DOTNET_CLI_HOME`으로 해결.
- 이미 수정한 인식기/라운드 단위 검사와 평가 도구 문법 검사도 정리 단계에서 통과. 이를 모션인식 정확도 완료로 해석하지 않음.

테스트는 임시 DB와 합성 계정을 사용했다. 기존 SQLite 이전·삭제, 운영 배포, 커밋·푸시는 하지 않았다.

## 배포 준비와 실제 배포 구분

현재 구현과 로컬 검증, staging AI/DB 연결 정리는 완료했다. 실제 운영 서비스가 출시되었다는 의미는 아니다. 운영 HTTPS 호스트·도메인, 서명 인증서·배포 URL, 실제 백업 복원 확인 및 WebView2 설치 장치 인수는 운영 배포 전에 별도로 확정해야 한다. 운영 배포와 기존 데이터 이전은 사용자 승인 후 진행한다.

- 실행·환경·릴리스: `DEPLOYMENT_RUNBOOK.md`, `../.env.example`, `../windows/appsettings.example.json`
- 롤백: `ROLLBACK_RUNBOOK.md`
- 기존 데이터 이전: `SQLITE_MIGRATION.md`
- 실제 챗봇 검증·사용량·운영 설정: `AI_COACH_DEPLOYMENT.md`
- 후속 모션/피드백: `refoundation/14-sample-video-baseline.md`

후속 작업자는 이 문서와 `phase-one-progress.md`의 9월 25일 범위를 우선 확인한다. 이전의 AI 미연결·staging 설정 없음·모션 정확도 인수 대기 기록은 해당 시점의 이력이다.
