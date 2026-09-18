# 2단계 백엔드 안정화

## 결과 — 2026-09-17

요청 범위의 로컬 구현과 아래 실행 가능한 검증을 마쳤다. 운영 적용 승인을 의미하지 않는다. 실제 사용자 SQLite DB, Supabase 운영 데이터, 커밋·푸시·배포는 변경하지 않았다. 이전 분석 제거 변경을 보존했다. 새 모션인식·캘리브레이션·자동 피드백은 만들지 않았다.

환경 부재로 실행하지 못한 WPF 빌드와 실제 Supabase 통합 검증은 아래 별도 항목에 남긴다. SQL 문자열 검사로 RLS 검증을 대체하지 않았다.

## 시작 시 확인한 문제와 수정

`AGENTS.md` 및 [이전 단계 재구성](01-removal.md)을 확인했다. 변경 전 Python 57개와 Android 테스트가 통과했지만 다음 결함이 있었다.

| 문제 | 수정과 주요 코드 |
|---|---|
| Store를 열 때마다 고정 비밀번호 재설정·자동 seed/마이그레이션 | `backend/domain.py`: seed 제거, 빈 DB만 초기화, 기존 미버전 DB 시작 차단 |
| 가입 일부만 커밋·공유 SQLite 연결 경쟁 | 재진입 잠금과 중첩 SAVEPOINT 트랜잭션, 가입/관리자 생성 원자성 |
| Android 고정 계정·사용자 ID로 위조 가능한 토큰·JSON 오류 덮어쓰기 | `web/scripts/android-offline.js`: 빈 초기 DB, 임의 opaque 토큰/만료/버전 검사, PBKDF2 salt, 손상 데이터 보존, 쓰기 직렬화 |
| 계정 상태·권한 변경 후 이전 토큰 사용 | SQLite 현재 상태/버전 검사, Supabase Auth Hook과 RLS 버전 검사, 관리 변경 감사 |
| 타 센터 회원 ID와 본인 센터 ID를 조합한 세션 생성 | 계정/센터, 라벨/세션/센터 복합 외래키와 RLS; PostgreSQL에서 재현 후 수정 |
| 플랫폼 관리자 본인 기록에 대한 쓰기 예외 | 세션 정책과 프로필 RPC에서 플랫폼 운동 데이터 쓰기 차단 |
| 세션 중복 생성·종료 시각 덮어쓰기 | 요청 ID 고유성, 시작/종료 RPC, 첫 종료 시각 유지, 웹/Android 재시도 연결 |
| 프로필 필드·자료형/범위 무검증 | 공유 `profile_input.py`, SQLite/Android/RPC 허용 필드·역할 검증 |
| 회원 한도 미적용·계정 생성 요청 준비 후 권한 변경 경쟁 | DB 정원 검사와 잠금, 생성자 버전 저장 및 요청 소비 직전 재검사 |
| 서버 로그아웃 누락·동시 refresh 경쟁 | 중앙 global 로그아웃+DB access 무효화, 웹 단일 갱신 Promise·늦은 응답 폐기 |
| WPF 앱 버전을 worker 버전으로 전달 | `WorkerStatus.cs`가 실제 health 조회, 브리지가 상태/버전/capability 전달 |
| 원본 URL 로그·잘못된 origin 처리 | HTTP URL 로그 제거, native 거부 URL 로그 제거, Host/Origin·중복 헤더 검사 |
| 실제처럼 표시된 센터 기본값·삭제된 AI 토글 | 더미 센터 연락처/주소/가격 제거, AI 토글 제거, 미적용 flag의 상태 명시 |

이전 단계의 삭제 파일과 유지한 카메라·녹화 기반은 [분석 제거 보고서](../ENGINE_REMOVAL.md)에 있다. 이번 단계 주요 추가 파일은 `backend/errors.py`, `backend/profile_input.py`, `backend/runtime_contract.py`, `tools/migrate_sqlite.py`, `windows/BoxingCoach.Desktop/Services/WorkerStatus.cs`, 신규 SQL 6개, 관련 테스트다.

## 인증·권한 계약

- 역할은 PLATFORM_ADMIN, CENTER_OWNER, COACH, MEMBER이며 로컬 OWNER는 CENTER_OWNER의 기존 별칭이다. 플랫폼 관리자는 중앙 운영 조회/계정 관리를 수행하지만 회원 운동 기록을 임의 수정하지 못한다.
- 센터 운영자/코치는 본인 센터의 허용된 프로필·훈련 기록만, 회원은 본인 것만 접근한다. 회원은 reach_cm/training_level을 수정하지 못한다.
- SQLite 토큰은 서명·만료·사용자·정수 버전과 현재 계정 상태를 검사한다. 서명 비밀 미설정 시 프로세스마다 새 비밀을 사용하여 재시작하면 이전 로그인이 무효화된다. 영속 비밀은 환경 설정으로만 제공한다.
- Supabase `app_token_version`은 Auth Hook이 현재 DB 값으로 발급한다. user_metadata는 권한 근거가 아니다. 누락/다른 버전 토큰은 RLS와 관리자 RPC에서 거부된다.
- 웹 `POST /api/auth/logout`은 서버 처리 후 로컬 자격을 지운다. 중앙/SQLite는 계정 전체 토큰에 영향을 주며 Android는 해당 장치 발급 토큰을 폐기한다. 중앙은 refresh 세션 해제 후 DB 토큰 버전을 변경한다. 두 서비스 호출은 분산 원자적이지 않으므로 실패를 성공으로 표시하지 않고 재시도한다.
- 동시 401 응답은 갱신 하나를 공유한다. 이미 갱신된 뒤 도착한 오래된 401은 새 토큰으로 재시도한다. 로그인 상태가 바뀐 뒤 도착한 갱신 응답은 폐기한다. 일시적인 503에서 refresh 자격을 지우지 않는다.
- Android는 장치 내 로컬 모드다. 장치 소유자의 localStorage 변조에 대한 중앙 보안 경계가 아니며 중앙 권한의 근거로 사용하지 않는다.
- 기존 DB의 과거 seed 계정/비밀번호는 자동 변경하지 않았다. 실제 이전 설치를 전환할 때 알려진 기본 비밀번호를 쓰는 계정은 운영자가 확인하여 별도 승인된 자격 증명 교체를 해야 한다.

## API와 프론트 계약

- `POST /api/sessions`: user_id, camera_config, focus와 선택 request_id(1~128자 문자열). 동일 생성자·키·내용은 같은 ID/시작 시각을 반환한다. 다른 내용으로 키를 재사용하면 거부한다. 키가 없는 구형 요청은 중복 방지를 제공하지 않는다.
- `PATCH /api/sessions/{id}/end`: 첫 종료 시각을 유지한다. 점수/피드백을 새로 계산하지 않으며 과거 기록의 분석 열은 보존한다. Supabase direct write도 임의 신규 분석 값과 기존 분석 변경을 차단한다.
- 웹은 시작 요청 본문과 UUID를 응답 확인까지 메모리에 유지한다. 결과 미확인 상태에서 다른 회원으로 시작하려 하면 원래 회원으로 재시도를 안내한다. 페이지 새로고침을 넘는 요청 복구는 제공하지 않는다.
- 종료 요청 실패 시 활성 세션을 유지하고 재시도한다. 녹화는 별도 장치 저장이며 가짜 결과로 대체하지 않는다.
- 프로필 PATCH는 알려지지 않은 필드와 ID/센터 변경을 거부한다. 회원 폼은 코치 전용 필드를 전송하지 않아야 한다. 기존 일반 회원 폼은 이 계약과 호환된다.
- 인증 실패는 401, 권한 거부는 403, 없는 정확한 경로/자원은 404, 입력 오류는 400이다. SQLite 시작 키 내용 충돌은 현재 400, Android/Supabase는 409이다. 클라이언트는 이를 성공으로 처리하거나 새 키로 자동 재시도하면 안 된다.
- 서버 응답과 로그에서 내부 예외 상세·원본 요청 URL을 노출하지 않는다. 구성한 origin 이외의 요청과 중복 Host/Origin을 거부한다.

## 기존 운영 정책

- 계정/센터/구독 활성 상태와 기존 유효 기간 정책을 유지했다. 플랫폼 관리자의 계정 운영 권한과 운동 기록 쓰기를 분리했다.
- max_members는 MEMBER 역할 전체를 센다. 기존 관리자 집계와 동일하게 중지 회원도 정원을 차지한다. NULL은 제한 없음이다. 가입/회원 역할 전환을 구독 행 잠금으로 직렬화하며 기존 초과 계정은 삭제하지 않는다.
- 계정 생성 요청은 생성자 버전을 저장하고 실제 Auth 사용자 생성 전 권한을 재검사한다. 버전이 없는 과거 미사용 요청은 거부하지만 삭제하지 않는다. 관리자 생성은 기존 감사 테이블에 역할/상태/버전만 기록한다.
- feature flag 쓰기는 플랫폼 관리자 RPC만 허용하고 조회에는 센터 격리를 적용한다. 현재 web.beta/pwa.enabled는 저장·조회만 구현됐으며 실제 제품 동작을 제어하지 않는다. 정의되지 않은 구독 차단 정책을 만들지 않았다. 관리자 화면에 이 한계를 표시했다. ai.multicamera 토글은 제거했지만 과거 DB flag 행은 보존한다.

## 마이그레이션과 적용 조건

### SQLite

- 현재 스키마 버전은 1이다. 새 빈 DB는 생성할 수 있지만 기존 미버전 DB는 자동 변경하지 않는다.
- worker를 중지하고 사용자의 별도 승인을 받은 다음 `python tools/migrate_sqlite.py --database EXISTING_DB --backup NEW_BACKUP --approve-migration`을 실행한다. 이 문서 자체가 승인에 해당하지 않는다.
- 백업 경로는 새 파일이어야 하며 배타적으로 예약한다. SQLite backup API와 integrity_check 후 업그레이드한다. 실패하면 트랜잭션을 롤백하고 백업을 남긴다. 이미 현재 버전이면 변경·백업 생성 없이 종료한다.
- 과거 역할 제약을 가진 합성 DB에서 센터/계정/프로필/캘리브레이션/세션/코치 라벨의 행 수와 모든 기존 필드를 백업 및 업그레이드 후 비교하여 보존을 확인했다. 외래키 오류 시 원본과 백업 덤프가 그대로임을 확인했다.
- 기존 `backend/boxing_coach.db`는 그대로이며 Git 변경 상태가 없다. 기존 실제 DB 파일을 삭제하거나 자동으로 새 DB로 대체하지 않았다.

### Supabase

기존 적용 이력은 수정하지 않고 다음 파일을 추가했다.

1. `202609160001_owned_record_integrity.sql`: 복합 FK, 소유권 불변, 세션 RLS, 캘리브레이션 RPC 실행 철회.
2. `202609160002_session_requests.sql`: 시작/종료 RPC와 중복 키, 분석 값 쓰기 차단.
3. `202609160003_account_token_version.sql`: Auth Hook과 토큰 버전 검사.
4. `202609160004_account_provisioning_limits.sql`: 생성자 재검사, 회원 한도, 생성 감사.
5. `202609160005_logout.sql`: 본인 access 토큰 무효화.
6. `202609160006_profile_permissions.sql`: 프로필 역할/형식 검사.

- 모두 미배포 상태다. staging 백업 후 순서대로 적용하고 gateway/Edge Function/WPF 업데이트를 검증해야 한다.
- FK는 NOT VALID로 과거 행을 수정하지 않고 신규/변경 행부터 강제한다. 기존 불일치 행의 조사·보정 및 VALIDATE CONSTRAINT는 백업과 별도 승인 계획이 필요하다. 캘리브레이션/분석 테이블 삭제는 이번 작업에 없다.
- [Auth Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)을 hosted Supabase에서도 활성화해야 한다. 로컬 config.toml만으로 hosted 설정이 반영되지 않는다. Hook 없이 버전 검사만 적용하면 로그인 후 데이터 접근도 차단된다. 이전 클레임 없는 토큰은 재로그인이 필요하다.
- gateway와 Edge Function에 같은 BOXING_COACH_AUTH_EMAIL_DOMAIN을 설정한다. 예제에는 accounts.example.invalid를 사용했다. 실제 기존 계정의 합성 이메일 도메인을 무계획하게 변경하지 않는다. SMTP/메일·외부 인증 공급자 연결은 수행하지 않았다.
- [Supabase signout](https://supabase.com/docs/guides/auth/signout)의 refresh 해제와 DB 버전 증가를 함께 사용한다. 실제 Auth/REST 연결은 아래 staging 검증 대상이다.

## 장치·유지보수

[장치 계약](03-device-contract.md)에 capability/status, 버전, 실패 상태 및 미래 MotionEvent/FeedbackEvent 방향을 정리했다. 미래 이벤트 API나 더미 엔진을 만들지 않았다.

WPF/WebView2와 Python worker, Android 브리지는 유지한다. worker 기본 바인딩은 loopback이다. 원격 브리지 허용 경로는 녹화 변환뿐이며 origin·메시지 스키마/크기·bridge secret을 검사한다. 새 웹의 장치 계약은 worker 0.3.0과 capability 계약 1을 요구하므로 이번 native 변경은 앱 업데이트가 필요하다. 일반 중앙 API는 장치 호환 검사와 분리된다.

기존 추적 pyc 삭제 변경을 유지하고 `.gitignore`의 bytecode/DB/log/node_modules/generated output 제외를 확인했다. 실제 DB·기록은 지우지 않았다. PGlite는 테스트 전용 고정 의존성이며 제품 런타임에 포함하지 않는다. 설정 예제에는 자격 증명이 없다.

## 검증 결과

| 검증 | 결과 |
|---|---|
| Python 전체 unittest | 79개 통과; 이후 누락 경로 보강 gateway 16개 별도 통과 |
| Android 오프라인 JS | 가입·인증·토큰 위조 거부·프로필 권한·세션 재시도·손상 데이터 보존 통과 |
| 웹 auth JS | 동시 refresh·늦은 응답·로그아웃·일시 장애 통과 |
| desktop contract JS | 승인/거부 버전·capability·worker 불가 상태 통과 |
| Chrome/Playwright | 역할별 화면, 실제 테스트 카메라 미리보기/녹화, 응답 유실 후 중복 방지, 종료 재시도, 권한 거부, PWA, 로그아웃 후 401 통과. 앱 콘솔 참조 오류·분석 요청 없음 |
| PGlite PostgreSQL | 모든 저장소 SQL 순서 적용 및 실제 authenticated/Auth 역할 실행 통과. 프로필/세션/flag 격리, 토큰, 가입 한도, 감사, 기존 행 보존 검사. [실행법](../../tests/rls/README.md) |
| Edge Function 구문 | Node --check 통과. 실제 Deno/Supabase 실행 검증이 아님 |
| Git diff --check | 저장소 CRLF 설정 기준 통과. 별도 LF 강제 비교는 기존 CRLF를 오탐하여 사용하지 않음 |

테스트는 메모리·임시 DB와 합성 계정만 사용했다. 테스트용 계정의 알려진 비밀번호는 fixtures에만 있으며 제품 seed는 없다.

## 외부 환경에서 남은 검증

- .NET SDK 없음: 지정된 WPF build/test 명령을 시도했지만 `No .NET SDKs were found`로 실패했다. WorkerStatus smoke를 추가했으나 C# 컴파일·실제 WebView2/카메라/변환/MSIX 검증은 SDK가 있는 Windows 환경에서 해야 한다.
- 실제 Supabase staging 자격 증명 없음: GoTrue 토큰 발급/Hook/refresh/global logout, PostgREST RPC·관계 조회, Edge Function, 여러 DB 연결의 동시 정원 경쟁을 검증해야 한다. PGlite는 PostgreSQL 권한/트리거 검증이며 이 통합을 대신하지 않는다.
- 실제 사용자 DB 전환·기존 기본 비밀번호 계정 처리·FK 과거 불일치 보정은 별도 승인/백업 후 운영자가 수행한다. 이번 작업에서 실행하지 않았다.

## 요구사항별 완료 근거

시작 조사·변경 전 테스트는 01 문서와 변경 전 결과, 인증/권한은 Python HTTP·JS·실제 PostgreSQL 역할 테스트, 데이터 보존은 백업/업그레이드 전후 전체 필드 비교, 세션은 브라우저 응답 유실 및 DB RPC 재시도, 운영 정책은 가입 트리거/flag 감사, 장치 경계는 health·origin·JS 호환 테스트와 03 계약, 유지보수는 소스 제거·기본값 정리·ignore/설정 점검으로 확인했다. 외부 환경에 의존하는 검증은 위에 명시했으며 통과했다고 주장하지 않는다.
