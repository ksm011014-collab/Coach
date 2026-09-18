# 기존 분석 엔진 제거 결과

## 범위와 호출 관계

2026-09-15 기준 저장소 루트 `AGENTS.md`를 확인했다. 하위 디렉터리의 추가 지침은 없었고, 작업 시작 시 Git 작업 트리는 깨끗했다.

기존 흐름은 다음과 같이 결합돼 있었다.

- `app.js` → `session-pose.js`: 카메라 시작과 MediaPipe 모델 로딩, 포즈 루프가 세션 시작에 결합.
- `preferences.js`: 카메라 설정, 관절 샘플 수집, 보정 API 호출과 회원 리치 변경을 함께 담당.
- `session-pose.js` → `feedback.js`: 자세 지표, 펀치·콤비네이션 판정, 모션 히스토리, 잠금, 지시 동작과 점수 계산.
- 세션 종료 → 점수·피드백 리포트 생성 → 음성·Jarvis 모달 → 세션 저장.
- 웹 로컬 API 어댑터 → WPF 허용 경로 → Python `pose3d.py`; Android 오프라인 어댑터에도 별도 보정 성공/포즈 상태 응답 존재.

현재 흐름은 `app.js` → `session.js` → 카메라·녹화·세션 API다. 카메라 준비에 분석 모델이 필요하지 않다. 별도의 분석 엔진이나 대체 판정 로직은 만들지 않았다.

## 삭제 파일

- `web/scripts/feedback.js`: 분류 규칙, 모션 히스토리, 펀치 잠금, 고정·임의 피드백, 점수, 음성 상태와 Jarvis 장식.
- `web/scripts/session-pose.js`: 기존 포즈 루프와 자세 지표 계산. 필요한 기반 기능은 `session.js`로 추출.
- `backend/pose3d.py`: 보정, 삼각측량, 포즈 처리.
- `tests/test_motion_classifier.js`: 제거된 분류기 전용 테스트.
- `web/vendor/mediapipe/pose_landmarker_lite.task`, `vision_bundle.mjs`, `wasm/vision_wasm_internal.js`, `wasm/vision_wasm_internal.wasm`, `wasm/vision_wasm_nosimd_internal.js`, `wasm/vision_wasm_nosimd_internal.wasm`.
- Git에 추적되던 `backend/__pycache__/domain.cpython-312.pyc`, `domain.cpython-313.pyc`, `pose_worker.cpython-312.pyc`, `pose_worker.cpython-313.pyc`, `server.cpython-313.pyc`, `tests/__pycache__/test_domain.cpython-313.pyc`: 오래된 실행 코드가 소스 없이 남지 않도록 삭제.

## 추가·변경 파일과 유지 기반

| 영역 | 파일 | 결과 |
| --- | --- | --- |
| 카메라·세션 | `web/scripts/session.js` (신규) | 독립 미리보기, 다중 장치 확인, 세션 시작/종료, 경과 시간, 자동 종료, 원본 녹화·재생·다운로드·FFmpeg 변환 유지 |
| 카메라 메타데이터 | `backend/camera.py` (신규) | 카메라 ID, 이름, 방향, 장치 ID, 활성 여부만 신규 세션에 허용 |
| 설정 | `web/scripts/preferences.js` | 장치 검색·권한 요청·선택, 테마, 세션 알림과 시작/종료 신호음 유지. 보정과 음성 피드백 설정 제거 |
| 화면과 상태 | `web/app.js`, `web/index.html`, `web/scripts/config.js`, `auth-shell.js`, `styles.css` | 분석 상태·리스너·CSS 제거. “분석 엔진 준비 중”과 실제 세션 상태 표시 |
| 회원·기록 | `web/scripts/members.js`, `member-home.js`, `dashboard.js`, `business.js` | 회원·센터·기본 기록 유지. 과거 점수 랭킹과 자동 피드백 판정·다운로드 제거. 로그아웃 전 진행 중 세션 종료 |
| API·저장소 | `backend/server.py`, `domain.py`, `central_gateway.py` | 보정 API·처리 제거. 종료 요청은 종료 시각만 갱신하고 전달된 점수·피드백은 사용하지 않음 |
| 브리지 | `web/scripts/desktop-bridge.js`, `windows/BoxingCoach.Desktop/Services/LocalApiPolicy.cs` | 보정·포즈 경로 제거. 녹화 변환, origin 검증, 프로토콜 호환성 검사와 인증 저장소 유지 |
| Android | `web/scripts/android-offline.js` | 가짜 보정 성공·포즈 응답 제거. 오프라인 계정·회원·세션 저장과 녹화 기반 유지 |
| 캐시·패키징 | `web/service-worker.js`, `web/version.json`, `requirements.txt`, `BoxingCoach.spec`, `BoxingCoach.Worker.spec` | 캐시 목록 갱신, 웹 버전 0.4.0, MediaPipe/OpenCV/NumPy 의존성 제거. FFmpeg 유지 |
| 테스트·문서 | `tests/test_session_browser.js` (신규), 기존 Python/Android/Windows 테스트, `.env.example`, `README.md`, `docs/CENTRAL_SAAS_PLAN.md`, `supabase/README.md`, 저장소 루트 `AGENTS.md`의 테스트 예시 | 회귀 테스트와 운영·DB 후속 설명 갱신 |

`accounts.js`, `platform-admin.js`, 출석 기능, Android 네이티브 권한·origin 정책, WPF/WebView2 셸, DPAPI, MSIX/App Installer 구조와 기존 RLS는 유지했다. Android 네이티브 소스에는 별도 보정/포즈 메시지 처리기가 없었으며 관련 응답은 공유 웹 어댑터에서 제거했다.

### 추출한 최소 동작

- 카메라 연결 버튼은 미리보기만 시작한다. 세션 생성이나 인식 결과를 만들지 않는다.
- 설정한 여러 카메라는 서로 다른 장치를 사용하며, 부족하거나 중복이면 열린 스트림을 해제하고 오류를 표시한다.
- 녹화는 주 카메라의 원본 영상이다. 보조 카메라는 미리보기로 유지하며 분석 오버레이는 합성하지 않는다.
- MediaRecorder 미지원/시작 실패 시 기본 세션 기록을 유지한다.
- 중복 시작을 차단한다. 세션 생성 실패 시 카메라를 해제하고, 종료 저장 실패 시 세션 ID를 유지해 재시도할 수 있다.
- 신규 엔진은 카메라 소스를 소비하는 별도 모듈로 연결할 수 있다. 카메라나 기본 세션 저장이 분석 결과를 기다리게 하지 않는다.

## 데이터 보존과 후속 DB 계획

실제 SQLite와 Supabase 데이터를 삭제·변경하거나 마이그레이션을 실행하지 않았다. 테스트는 메모리 또는 임시 DB를 사용했다. SQLite의 `member_calibrations`, 세션의 `overall_score`/`feedback_report`, 기존 카메라 메타데이터와 수동 코치 라벨은 보존한다. 백업·이관 도구도 유지한다.

- 기존 SQLite 스키마 호환을 위해 신규 세션의 필수 점수 열은 `0`, 피드백 열은 빈 값이다. 계산 결과가 아니며 프론트에서 점수로 표시하지 않는다.
- 세션 종료는 과거 점수·피드백을 덮어쓰지 않는다. 과거 DB 필드는 호환용 직렬화/이관 대상으로만 남고, 새 UI에서 분석 결과로 사용하지 않는다.
- 제거된 보정/포즈 애플리케이션 API는 404다. 기존 localStorage 보정 레코드도 더 이상 읽거나 생성하지 않는다.
- **과거 Supabase 마이그레이션은 수정하지 않았다.** 이미 배포된 PostgREST 테이블 권한과 보정 RPC는 이 소스 변경만으로 폐기되지 않는다. 구버전 클라이언트·직접 DB 호출까지 차단하려면 별도 DB 배포가 필요하다.

현재 앱 실행을 위해 테이블 삭제는 필요하지 않다. 추후 정리 시 다음 순서를 따른다.

1. 별도 승인 후 SQLite 일관된 백업과 Supabase 백업을 만들고 복구 가능성을 확인한다. 센터별 건수, 회원/세션 연결 관계와 대표 레코드를 기록한다.
2. 기존 RPC·RLS·직접 테이블 쓰기 권한과 구버전 클라이언트 의존성을 조사한다.
3. 새 순번의 비파괴 마이그레이션으로 보정 RPC 실행 및 관련 쓰기 권한을 중단한다. 기존 분석 열을 수정하는 경로도 차단하도록 설계하되 계정·센터 권한이나 기본 세션 종료 권한을 넓히지 않는다.
4. staging에서 허용/거부, 교차 센터 접근, 데이터 건수·대표 레코드 보존과 롤백을 검증한다. 승인 후에만 운영 적용한다.
5. 보존 기간과 이관 대상이 확정된 뒤 **별도 파괴적 마이그레이션 승인**으로 테이블/열 삭제를 검토한다. 이번 작업에는 DROP/TRUNCATE 또는 운영 마이그레이션이 없다.

## 검증

작업 디렉터리: `box/`.

- Python: `python -B -m unittest discover -s tests` — **57개 통과**. 기본 Python 명령이 PATH에 없어 번들 Python을 사용했다.
- JavaScript: `node tests/test_android_offline.js` — 통과. 계정/세션 흐름, 제거 API 404, 신규 카메라 메타데이터 정리, 점수·피드백 입력 무시 확인.
- Chromium: `node tests/test_session_browser.js` — 모든 역할 화면 렌더링, 미리보기, 실제 MediaRecorder/IndexedDB 저장, 시작/종료, 중복 시작 방지, 저장 실패 후 재시도, 권한 거부와 서비스워커 캐시를 검증. 테스트 전용 가상 카메라를 사용하며 앱에 가짜 카메라/분석 코드는 추가하지 않았다.
- 브라우저에서 콘솔 오류와 삭제된 분석 파일/API 요청이 없었다. JavaScript 구문 검사와 잔여 함수·상태·스타일 참조 검사도 수행했다.
- SQLite 재오픈 시 기존 보정 행 보존, 세션 종료 시 과거 점수/피드백 보존을 임시 DB로 확인했다.
- Windows `dotnet test`, smoke 실행(`dotnet run --project ...`), `dotnet build`는 시도했으나 **.NET SDK 미설치**로 실행되지 않았다. 기존 Python 기반 Windows/Android 계약 테스트는 통과했다.
- 실제 USB 카메라, Android 하드웨어 및 설치된 WPF 앱 실행은 검증하지 않았다. Supabase 실서버 검증·staging 적용은 하지 않았다.

## 배포·호환성

커밋, 푸시, 배포, 패키지 발행과 운영 DB 변경은 수행하지 않았다. 기존 `release/`, Android APK 등 생성된 배포물은 수정하지 않았다.

공유 웹 UI 변경은 일반 웹 배포로 반영할 수 있지만, **로컬 Python 처리 코드와 WPF 허용 경로 제거를 설치된 제품에도 적용하려면 후속 데스크톱 패키지 업데이트가 필요하다.** Android 번들 모드도 다음 APK 빌드에 공유 웹 변경을 포함해야 한다. 이전 배포물에 들어 있는 엔진은 소스 정리만으로 변경되지 않는다.
