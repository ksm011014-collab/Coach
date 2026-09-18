# 웹과 장치 경계

## 책임

- 중앙 서버: 계정, 센터, 역할/구독/feature flag, 프로필과 세션 기록. Supabase RLS가 데이터 접근을 결정한다.
- 고객 장치: 브라우저 카메라 권한·장치 목록·미리보기·녹화. Windows 로컬 worker는 녹화 변환을 처리한다. 현재 추론·캘리브레이션·자동 피드백 엔진은 없다.
- SQLite와 Android 오프라인은 기존 로컬 사용 경로다. 장치 소유자는 로컬 저장소를 변경할 수 있으므로 중앙 계정 권한의 근거로 사용하지 않는다.

## 현재 상태 계약

`GET /api/system/health`는 인증 없이 상태를 조회한다. 기존 `status`, `service`, `version`을 유지하고 다음 `capabilities`를 추가한다.

| 필드 | 의미 |
|---|---|
| `contract_version` | 1 |
| `engine_version` | 현재 API 구현 버전 0.3.0. 추론 엔진 설치 여부가 아니다. |
| `data_mode` | local / supabase / android-local |
| `analysis.available` | false |
| `analysis.status` | not_installed |
| `camera.owner`, `camera.capture` | device, browser |
| `recording_conversion.route_available` | 해당 서버에 변환 경로가 있는지. ffmpeg 설치 성공을 보장하지 않는다. 중앙 서버와 Android는 false. |

Windows `platform.get`은 bridgeProtocol 1, worker의 실제 engineVersion, workerAvailable, capabilities를 제공한다. WPF 시작 시 loopback health를 최대 3초 동안 조회하며 실패하면 버전을 추정하지 않고 unavailable로 전달한다. 이는 시작 시점의 상태이며 이후 worker 종료는 실제 장치 API 요청 실패로 드러난다. 앱 재시작으로 상태를 다시 조회한다.

웹은 녹화 변환 전에 bridgeProtocol 1, engineVersion >= 0.3.0, capability 계약 1을 검사한다. 이전 WPF의 앱 버전을 worker 버전으로 사용한 응답에는 capability가 없으므로 장치 호출이 차단된다. 새 계약을 쓰려면 이번 WPF/worker 업데이트가 필요하다. 일반 중앙 웹 API는 이 장치 호환 검사와 분리된다.

## 전송 경계

- worker 기본 바인딩은 127.0.0.1이며 임의 LAN 공개를 하지 않는다.
- worker/중앙 HTTP 서버는 Host와 Origin을 검사한다. reverse proxy의 공개 주소는 `BOXING_COACH_ALLOWED_ORIGINS`에 정확한 origin으로 명시해야 한다. wildcard를 사용하지 않는다.
- Windows 브리지는 승인된 origin과 메시지 타입/ID/크기 제한을 검사한다. 원격 웹에서 로컬 worker로 허용하는 경로는 현재 POST `/recordings/convert`뿐이다. native proxy가 bridge secret을 붙이고 worker가 확인한다.
- 중앙 웹 네트워크 장애나 버전 불일치를 가짜 성공·분석 결과로 바꾸지 않는다. 실제 오류를 표시하고 카메라/세션 상태를 안전하게 복구한다.

## 향후 확장

새 MotionEvent/FeedbackEvent는 별도 엔진의 관측 결과로 추가할 수 있다. 향후 설계에서 세션 ID, 관측 시각, 실제 엔진 버전과 출처, 신뢰도 및 저장 동의 정책을 정해야 한다. 현재는 이벤트 API·더미 이벤트·분류 알고리즘을 만들지 않는다. 기존 카메라/녹화/세션 수명 주기에 분석 판정 코드를 다시 끼워 넣지 않는다.

검증 및 미검증 환경: [백엔드 인수인계](02-backend.md).
