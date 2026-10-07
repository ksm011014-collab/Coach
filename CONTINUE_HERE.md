# BoxingCoach 인수인계 — 2026-09-25

## 최신 작업 상태

최신 요청 배포본은 `box/release/BoxingCoach-0.4.5.0-stable/BoxingCoach.Desktop.exe`와 동일 버전 ZIP이다. 텍스트 보고서의 JSON 제거, 탭 바깥 패널 제거, AI 구체 앞뒤 궤도·위성 공전·구체만 음성 반응을 반영했다. 바로가기 갱신 및 포함 소스 일치/ZIP 무결성 검사 완료. 실행 중이던 0.4.4는 종료하지 않았다.

최신 명시적 생성 요청으로 `box/release/BoxingCoach-0.4.4.0-stable/BoxingCoach.Desktop.exe`와 ZIP을 생성했다. 로그인 배경 무한 재생·로그인 성공 후 3초 확대 전환을 포함하며 바로가기도 갱신했다. 기존 서버 연결 방식 유지, HTTPS UI 전환은 수행하지 않았다. 포함 소스 일치와 ZIP 무결성 및 로그인 검사 통과.

사용자의 명시적 생성 요청에 따라 최신 UI·음성·직원 비고 변경을 포함한 `box/release/BoxingCoach-0.4.3.0-stable/BoxingCoach.Desktop.exe`와 ZIP을 생성하고 바로가기를 갱신했다. 기존 staging 직원 비고 마이그레이션·직원 등록 함수·챗봇 지침 배포와 권한 확인을 완료했다. 실제 하드웨어 인수는 별도이며, 이후 실행파일 생성은 다시 명시적으로 요청받을 때만 수행한다.

JDC 목표는 진행 중이다. 최신 생성 배포본은 `box/release/BoxingCoach-0.4.2.0-stable/BoxingCoach.Desktop.exe`이며 바로가기도 export 스크립트로 갱신했다. 구현·실제 연결 검증·미완료 하드웨어 인수·승인 검토 제한은 `box/docs/JDC_PROGRESS.md`를 먼저 읽는다. 아래 0.3.x 및 이전 완료 기록은 과거 이력이다.

9월 25일 직원관리/로그인 유지 수정: 최신 연결 배포본은 `box/release/BoxingCoach-0.3.3.0-stable/BoxingCoach.Desktop.exe`다. `box/release/BoxingCoach.lnk`도 이 버전을 가리킨다. 직원 메뉴의 준비 중 화면을 실제 센터 코치 계정 목록·등록 폼·상태 변경 UI로 연결했다. 기존 계정 관리 API/RLS를 사용하며 새로운 권한이나 DB 변경은 없다. 앱 시작의 일시적인 조회 실패는 저장된 세션을 지우지 않고 재연결 버튼을 제공한다. PWA 첫 설치의 controllerchange로 로그인 입력이 지워지던 자동 새로고침을 제거했다. 연결 배포 워커에서 실제 센터장 로그인, 직원 화면과 COACH 전용 등록 폼, 재로딩 로그인 복원, 503 모의 응답 시 로그인 보존 및 실제 서버 재연결을 확인했다. 검사 계정/직원 생성이나 데이터 수정은 하지 않았다. Windows DPAPI 저장 코드는 기존 구현을 유지하며 이번 자동 검증은 Chrome으로 배포 UI를 사용했다. Supabase 관리 사이트 로그인은 앱 사용의 전제 조건이 아니다.

9월 25일 실행 경로 확인: 사용자가 센터장 가입이 없다고 보고했을 때 열려 있던 탐색기는 `BoxingCoach-0.3.0.0-stable` 폴더였다. `0.3.1.0`의 실제 Windows WPF/WebView2 창을 직접 실행하고 센터/회원 가입 화면에서 `센터장: 새 센터 개설`과 센터명 입력을 확인했다. `box/release/BoxingCoach.lnk`는 최신 연결 배포본을 가리키며 이후 `export-connected-release.ps1` 실행 시 함께 갱신된다. 구버전 폴더와 DB는 보존했다.

9월 25일 센터장 가입 후속 완료: 최신 연결 배포본은 `box/release/BoxingCoach-0.3.1.0-stable/BoxingCoach.Desktop.exe`와 동일 이름 ZIP이다. 센터장 가입 시 신규 센터·기본 체험 구독·감사 기록을 생성하며 중앙 관리자 공개 가입은 차단한다. 기존 Supabase에 마이그레이션 21·22를 적용했다. 기본 중앙 관리자 `admin`은 기존 권한 검사 API로 생성했고 비밀번호는 배포물에 포함하지 않은 Git 제외 로컬 파일 `box/artifacts/admin-initial-credentials.json`에만 보관한다. 연결 배포본의 가입 UI·admin 중앙 관제 로그인·센터/계정 조회·기존 회원 DB 조회·챗봇 모델/사용량 조회가 통과했다. 실제 DB 트랜잭션 롤백으로 센터 생성·구독·감사·공개 권한 상승 차단·타 센터 격리를 검증했다. 가입 검사용 계정/센터는 남기지 않았다. 이번 검증에서 유료 챗봇 호출은 하지 않았다. Windows 네이티브 창 조작 대신 동일 배포 워커가 제공하는 UI를 Chrome에서 검증했다.

9월 25일 추가 요청: 이후 작업은 DB·챗봇이 연결된 배포 버전을 수정·검증하는 방식으로 진행한다. 별도 SQLite 모드, 미리보기 앱, 테스트 실행파일이나 새 테스트 파일을 만들지 않는다. 현재 연결 배포본은 `box/release/BoxingCoach-0.3.0.0-stable/BoxingCoach.Desktop.exe`이며 같은 이름의 ZIP을 제공한다. 배포본 워커로 중앙 로그인·DB 조회·두 모델 조회·실제 GPT-4.1 mini 응답·사용량 조회를 확인했다. 기존 Supabase 프로젝트를 그대로 사용하며 외부 웹 호스팅/서명 설치 패키지와는 구분한다. 기존 `box/release/BoxingCoach.exe`는 과거 파일이므로 새 배포본 검증에 사용하지 않는다.

현재 인수 기준은 `box/docs/PHASE_ONE_CLOSEOUT.md`다. UI·언어·중앙 DB·실제 챗봇·대화 화면 구현을 확인했고, 9월 25일 Python 117개, 관리/언어/챗봇/녹화 브라우저, PostgreSQL 권한, Windows 빌드·보안 smoke 검사가 통과했다. 기존 Supabase staging과 실제 OpenAI 연결은 완료된 상태이므로 새 프로젝트나 키를 다시 만들지 않는다. 운영 배포는 하지 않았다.

사용자가 모션인식·피드백 개선을 이번 목표에서 제외했다. 해당 작업은 `box/docs/refoundation/14-sample-video-baseline.md`에 인계했으며 추가 분석·촬영·튜닝을 재개하지 않는다. CPU/Lite 기본값을 유지한다. 원본 영상과 기존 DB는 보존한다. 운영 HTTPS 호스트·서명·백업 복원·설치 장치 인수 등 출시 조건은 최종 정리 문서를 따른다.

## 이전 작업 이력 — 아래 완료 범위와 미연결 상태는 당시 기준

최종 완료: 사용자가 진단용 PID1336 프로세스 트리를 종료했다. PID1336/8272 부재와 exec87379 종료를 확인해 정리까지 완료했다. 실제 카메라·녹화본 검증을 제외하고, AI/음성은 미연결 UI·서비스 인터페이스까지라는 사용자 확정 범위로 목표를 완료한다. 요구사항별 증거 및 한계는 box/docs/refoundation/13-final-audit.md, 성능은 12-live-performance.md를 따른다. 아래의 정리 대기/진행 중 기록은 이전 시점의 이력이다.

2026-09-22 최종 범위/인수: 사용자가 실제 카메라도 제외하도록 명시했다. 녹화본·실제 카메라 검증을 제외한 구현/검증은 완료하고 13-final-audit.md에 요구사항별 증거를 정리했다. MediaPipe Lite CPU Worker 기본 선정, 관리 UI/권한/Edge 회귀 및 최신 PWA 모션·코치 캐시/오프라인 미리보기 통과. 자원 표본은 12 문서에 추가했다. 단, 진단용 Node PID1336(exec87379)이 legacy-capture 열기 대기 중이며, 해당 프로세스 트리 종료가 자동 승인 검토 사용량 한도로 실행되지 않았다. 다른 경로로 우회하지 않는다. 사용자 직접 종료 또는 검토 복구 후 해당 명령줄의 PID만 확인/정리해야 한다. 이 정리 전 목표 완료 상태 전환은 보류한다. 추가 카메라 검사는 사용자 지시로 하지 않는다.

2026-09-22 5분 실시간 검사 완료: exec 8126은 exit0으로 종료했다. 실제 앱에 실시간 생성 캔버스 입력을 사용해 300.390초 표시9011회(30.0FPS), 분석5974회(19.9FPS), 추론 p95 46.1ms를 측정했다. 모든 표본에서 녹화 활성, Worker 오류0, 종료 보고서 저장/팝업 통과. artifacts/session-performance-1790037147132.json 및 docs/refoundation/12-live-performance.md 참고. 실제 물리 카메라·사람 인식·전체 CPU/GPU 자원·수시간 안정성과 구분한다. Python115개와 모션/세션종료/음성/Android/desktop 계약 검사도 통과했다. 남은 것은 전체 인수 감사, 자원 측정의 제한/지원 설정 정리, 최신 변경 기준 UI/권한 회귀와 문서 정합성이다. 녹화본 활용은 제외 범위를 유지한다.

2026-09-22 실시간 검증: 앱/모델 없는 빈 페이지에서도 Chrome 153.0.8010.50의 fake camera track이 getUserMedia 후 1초 내 ended가 됨을 분리 재현했다. 모델을 끈 앱에서도 동일하다. 앱 카메라 버그로 단정하지 않는다. 성능 모드에 실시간 canvas 생성 스트림을 명시적으로 사용해 60초 표시 1802프레임(약30FPS), 분석1185회(약19.7FPS), 녹화 활성 유지·보고서 저장·팝업을 검증했다. 녹화본 재생은 사용자 요청으로 건너뛴다. artifacts/session-performance-1790037059710.json 참고. Python 전체115개 통과. 5분 실행을 이어서 시작했으며 완료 전 측정 성공으로 간주하지 않는다.

2026-09-22 서버: 8000 포트 미실행 확인 후 기존 development-db.txt 지정 DB 그대로 최신 코드 서버를 숨김 실행했다. 로그는 artifacts/motion-server-current.*.log다. 가드/추적 JSON 저장 코드를 포함하며 DB 스키마와 관리자 계정은 변경하지 않았다.

2026-09-22 사용자 추가 범위 변경: 녹화본을 활용하는 부분은 전체 완료 조건에서 제외하고 완료하도록 요청했다. 녹화본 입력 정확도/각도 비교/영상 재생 검증을 제외하며 기존 녹화 기능은 보존한다. Windows smoke 프로젝트 실제 build 및 run을 수행해 빌드 경고/오류 0, DPAPI·로컬 origin·hosted bridge 검사 통과. dotnet test는 이 프로젝트가 실행형 smoke이므로 검사를 실행하지 않으며 run 결과를 기준으로 한다. 실시간 성능 측정 도구 session_performance.cjs를 추가했으나 기존 Chrome 합성 카메라가 미리보기→세션 시작에서 Requested device not found로 3회 실패하여 측정값은 아직 없다. 동일 오류 반복 무작정 재시도하지 말고 track 종료/재사용 조건을 계측해 원인을 확인해야 한다. 녹화본은 이 원인 조사에 필요하지 않다.

2026-09-22 추적 구간 저장: MotionRound가 분석 시작 전/250ms 넘는 결과 공백(no_result)과 유효하지 않은 관측 이후 구간(unreliable)을 기록한다. 구간 최대 200개와 전체 공백 ms/생략 여부만 보관한다. 종료 요약에 총시간·앞 5구간을 표시하고 AI 인터페이스에는 총시간만 제공한다. Python 7개, 라운드/코치 단위, 팝업 브라우저, PostgreSQL 검사 통과. staging 19번째 202609220002_motion_tracking_evidence.sql 적용 및 합성 Auth/RPC 저장·재조회·재시도·권한 검증 통과. 실제 자세 정확도가 아닌 분석 가능 구간의 근사치다. 개발 서버는 가드/추적 백엔드 변경 후 재시작이 아직 필요하다. 다음 작업은 장시간 녹화/성능·간헐 실패 원인 조사, 패키지 호환성, 최종 회귀다.

2026-09-22 가드 근거 저장: 이벤트의 선택 필드 guard_ratio(0~1)를 SQLite/중앙 JSON에 보존한다. 기존 v1 보고서는 그대로 호환되고 원본 좌표는 저장하지 않는다. 저장된 관측만으로 잘된 점·반복 관측·다음 과제를 팝업에 표시하며 AI에는 집계값만 전달한다. Python 6개, 모션 라운드/대화/팝업 브라우저/PostgreSQL 검사를 통과했다. 18번째 202609220001_motion_guard_evidence.sql을 staging에 적용하고 새 합성 라운드의 저장·재조회·재시도·센터 격리를 확인했다. 기존 개발 서버는 이번 Python 변경으로 재시작하지 않았으므로 재시작 전에는 가드 근거가 저장되지 않는다. 추적 불안정 구간 저장과 장시간 녹화/성능 검증은 아직 남았다.

2026-09-22 회귀 점검: 현재 코드에서 Python 113개와 dev.ps1의 JS/모션/텍스트·음성 인터페이스/관리 UI/카메라 녹화·재시도/PWA/PostgreSQL/Edge 검사를 모두 확인했다. 최초 전체 실행에서 오래된 녹화 실패 기대값과 auth 단위 테스트의 window 모의 누락을 수정한 뒤 해당 검사부터 나머지 전체를 이어서 통과했다. 과거 간헐 카메라 실패의 원인이 해결됐다는 의미는 아니다. 요구사항별 현재 증거와 남은 구현은 [10](box/docs/refoundation/10-motion-acceptance.md)에 정리했다.

2026-09-22 실행/설치 연결: 기존 서버가 종료되어 있음을 확인하고 기존 schema 3 개발 DB 그대로 새 서버를 127.0.0.1:8000에 시작했다(실제 worker PID 29712, 시작 시점). health에서 motion_reports 버전 1 지원을 확인했다. 시작 로그는 artifacts/motion-server-20260922.*.log다. 오래된 서버는 새 보고서를 조용히 무시하지 않도록 UI에서 저장 미지원 안내한다. 모델 준비 도구에 공식 라이선스·고정 버전/해시·파일 목록을 포함했으며 재현 명령은 [07](box/docs/refoundation/07-motion-coaching.md)에 있다.

2026-09-22 종료 오류 격리: 분석 결과 생성 또는 녹화 종료 실패가 운동 기록 종료를 막지 않게 수정했다. 종료 보고서/종료 사유는 최초 요청에서 고정하며 재시도 대기 중 운동 타이머를 멈춘다. 수동/자동 종료와 재시도 단위 검사 및 팝업 검사 통과. 카메라 통합 검사는 장치 재개방 실패/녹화 비활성의 간헐 실패 후 최종 실행에서 녹화 재생·재시도·PWA까지 통과했으나, 간헐 문제 해결 증거로 간주하지 않는다. 촬영 준비 안내와 실제 앞손 표시를 세션 화면에 추가했다.

2026-09-21 최신 사용자 범위: 영상이 없으므로 실제 영상 검증은 제외하고 우선 구현/가능한 검증을 진행한다. 실제 펀치 정확도와 권장 각도는 미검증으로 구분한다. `tools/predict_motion_video.cjs`에 로컬 영상→실시간 Worker 예측 JSON 경로를 마련했고 빈 합성 영상에서 실행/동작 0건을 확인했다. 평가기는 좌우 오류와 정답 회수 시점 기준 점수 갱신 지연도 계산한다. 촬영 없이 진행 가능한 남은 구현·녹화 안정성·호환성 검증을 계속한다.

2026-09-21 코치 인터페이스 추가: 사용자가 무료 Gemini 키/프로젝트 미준비로 미연결 UI·인터페이스 진행을 선택했다. 텍스트/음성 서비스 연결 계약, 최소 운동 요약 전송, 중복/시간 초과/종료 후 응답 차단을 구현했다. 음성 입력/재생 상호 중단, 진폭 전달 및 취소 인터페이스는 합성 제공자로 검사했다. 실제 AI·마이크·음성 출력과 WebView2 지원은 미검증/미연결이다. [09](box/docs/refoundation/09-coach-service.md) 참고.

새 목표인 섀도복싱 모션 인식·점수·라운드 종료 AI 코치는 진행 중이다. 아래는 이전 관리 UI 목표의 완료 기록이다. 새 계획/성능 기준은 [07](box/docs/refoundation/07-motion-coaching.md)을 따른다. 아직 실제 동작 정확도나 카메라 각도를 확정하지 않았다.

2026-09-21 추가: 라운드 점수/5초 감지 요약과 종료 보고서 전송을 프론트에 연결했다. SQLite 저장/재시도 및 PostgreSQL 권한 테스트 통과, staging에 17번째 `202609210001_motion_rounds.sql` 적용 후 실제 합성 계정으로 점수 재계산·저장/재조회·동일 재시도·변경 거부·감사 1건·센터 격리를 확인했다. 기존 개발 서버는 새 백엔드로 재시작하지 않았으므로 실행 상태 확인이 필요하다. 실제 사람 인식 정확도, 성능 기준 달성, 교정 피드백, 무료 AI 연결 인터페이스와 음성은 완료 전이다.

관리 UI 정리·센터 정보·선택 이용권 만료일·간편결제 기록의 구현과 격리 DB 검증, Supabase staging 적용을 완료했다. 사용자 별도 승인 후 기존 개발 DB를 백업하고 schema 2 → 3 전환·동일 DB 서버 재시작을 완료했다. http://127.0.0.1:8000 에서 기존 admin 로그인과 업무 API 조회를 확인했다.

- 운동 세션 외 반복 설명 정리, 회원 수정/삭제 버튼, 표 중앙 정렬, 설정/센터 폭 조정.
- 링·샌드백 UI 제거, 분/초 한 줄 입력과 초 단위 저장. 연락처·주소·운영시간은 센터 공통 API에 저장.
- 회원 프로필·메모와 선택 이용권 만료일 원자 저장, SET_END 이력. 등록일·숨긴 상태·과거 기록 보존.
- 카카오페이/기타 간편결제 수납 기록. 실제 결제 API는 미연결.
- 출석 상단 수동 버튼 제거, 주말 색상, 센터 오늘 기본값·월/연도 전환 및 과거 선택 유지.

상세 구현과 계약은 [04](box/docs/refoundation/04-frontend.md), [05](box/docs/refoundation/05-frontend-api-contract.md), [06](box/docs/refoundation/06-operations-integration.md)을 따른다. 직원 업무 서비스·실제 PG·알림은 범위 밖이며 미연결 상태를 유지한다.

## 검증

최종 변경 후 Python 전체 101개를 다시 실행해 통과했다. git diff --check도 통과했다.

Python 99개와 전체 JS/브라우저/PostgreSQL 권한/Edge 모의 회귀 통과. 이후 추가한 복수 이용권·이용권 없는 회원 검사를 포함해 업무 Python 11개 통과. 로컬 HTTP에서 센터·회원·만료일·메모·수납/부분/전체 환불·출석·재조회·보존형 삭제를 확인했다. Chrome 합성 카메라·기본 코덱 녹화·재시도·PWA도 통과했다. 실제 WebView2/Android와 카메라 하드웨어는 미검증이다.

boxingcoach-staging은 초기 빈 상태를 확인한 후 16개 마이그레이션과 admin-create-user/register-member Edge를 적용했다. 사용자 별도 승인에 따라 staging에만 이메일 자동 확인과 custom_access_token_hook을 활성화했다. 실제 Auth 로그인, Edge 회원 등록/응답 유실 재시도, 프로필/만료일/이력, 수납/부분 환불, 출석, 역할 및 다른 센터 접근 차단을 검증했다. 운영 프로젝트는 변경하지 않았다. staging 검증은 실제 Auth/Edge/RPC 호출이며 배포된 웹/네이티브 앱의 종단 검증과 구분한다.

## 실행

루트 `start_boxing_coach.bat`는 `box/tools/start-local.ps1`을 호출한다. 기존 `box/artifacts/development-db.txt`가 지정한 DB만 사용하며 파일이 없으면 새 DB를 만들지 않고 중단한다. 정상 실행 중인 로컬 BoxingCoach 서버가 있으면 재사용하고, 없으면 숨김 서버를 시작해 health 확인 후 브라우저를 연다. 로그는 `box/artifacts/launcher-*.log`다. 실행창이 닫혀도 서버는 백그라운드에서 유지된다. `-CheckOnly`는 DB 경로 확인만, `-NoBrowser`는 브라우저를 열지 않고 실행/재사용한다. 배포용 `box/START_BOXING_COACH.bat`와는 별개다.

Python 3.12.14 venv, portable Node 22와 Chrome이 준비돼 있다. 루트 PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File box/tools/dev.ps1 -Action test -NodeDirectory .tools/node-v22.20.0-win-x64
```

staging 재확인(아래는 box/에서 실행):

```powershell
.venv/Scripts/python.exe tools/staging_migrations.py --settings .env.staging.local
.venv/Scripts/python.exe tools/staging_smoke.py --settings .env.staging.local
```

staging smoke는 합성 계정/업무 데이터만 사용하고 멱등 키로 재시도한다. 토큰과 계정 비밀번호는 출력하지 않는다. .env.staging.local, artifacts의 합성 계정 설정과 CLI .temp는 Git에서 제외한다. 적용된 SQL은 수정하지 않고 추가 마이그레이션을 사용한다.

## 개발 DB 적용 완료

현재 개발 DB는 box/artifacts/development-db.txt가 가리키는 schema 3 파일이며 admin 계정과 기존 비밀번호를 보존한다. Git 제외 box/artifacts/dev-admin.credentials.txt에 로그인 설정이 있다. 새 DB/계정으로 교체하거나 비밀번호를 초기화하지 않는다.

백업은 box/artifacts/development-schema2-backup-20260920-190923.db다. 기존 18개 테이블의 5개 레코드 전체와 관리자 비밀번호 해시가 동일함을 확인했다. 기존 센터에 Asia/Seoul 기본 시간대 행 1개만 추가됐다. FK 오류 0개, 무결성 정상이며 같은 DB로 재시작 후 로그인/업무 조회를 확인했다. 기존 DB·실제 녹화는 삭제하지 않았다.

운영 배포·실제 PG·실제 장치 검증은 별도 작업이다. 커밋/푸시는 하지 않았다. DB·녹화·로그인/localStorage·개인 환경설정·런타임·의존성·생성 스크린샷은 전달 대상이 아니다.
