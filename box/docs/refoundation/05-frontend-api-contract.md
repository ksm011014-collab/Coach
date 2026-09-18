# 관리 화면 백엔드 연결 명세 — 작업 중 초안

신규 백엔드는 구현하지 않았다. 아래는 개발용 어댑터를 향후 교체하기 위한 초안이다. 기존 `/api/members`, `/api/sessions`, 인증·계정 계약을 변경하지 않는다.

## 공통 규칙

- 개발용 ID는 `preview-` 접두사이며 실제 API에 보내면 안 된다. 실제 어댑터의 회원 ID는 기존 프로필 ID와 `user_id`를 구분하여 명시적으로 매핑해야 한다.
- 모든 신규 업무 행은 `center_id`, 회원 소유 행은 `member_id`를 갖는다. 서버는 토큰으로 행위자·센터·권한을 검증해야 한다. 프론트의 role/center_id 필터는 보안 경계가 아니다.
- 일자는 `YYYY-MM-DD`, 시각은 오프셋 있는 ISO 8601. 기존 세션 API의 epoch **초**는 화면 어댑터에서 변환한다. 금액은 KRW 원 단위 안전한 정수이며 부동소수점 통화 계산은 하지 않는다.
- 목록 초안: `items`, `total`, `page` (1부터), `page_size`; 날짜·상태·회원·검색·정렬 조건. 개발용 화면은 전체 합성 snapshot에서 필터·페이지 이동한다. 서버 목록으로 전환 시 전체 집계와 현재 페이지를 혼동하지 않아야 한다.
- 변경 요청마다 `request_id` 사용. 같은 행위자·키·본문이면 기존 결과, 본문이 다르면 CONFLICT. 서버 고유 제약·트랜잭션이 필요하다.
- 오류: `VALIDATION` (필드 검증), `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `NOT_CONNECTED`, `UNAVAILABLE`, `STORAGE`. 권장 HTTP는 400/403/404/409/503이며 저장 실패를 성공으로 표시하지 않는다. 실제 adapter에서 기존 API 응답과 매핑한다.

## 개발용 모델 및 변경 인터페이스

| 모델 | 주요 필드 | 서비스 |
|---|---|---|
| 회원 | id, center_id, name, phone, joined_on, account_status | saveMember |
| 상품 | id, center_id, name, kind(PERIOD/COUNT/TRIAL), days, count, price | saveProduct |
| 회원 이용권 | member_id, product_id, start_on, end_on, remaining(null=기간권), status(ACTIVE/PAUSED/CANCELLED), history | assignPass, changePass |
| 이용권 이력 | action, reason, author, at, previous_end_on, end_on | 변경과 함께 기록 |
| 방문 | member_id, visited_on, status(PRESENT/CANCELLED), reason, created_at, cancelled_at | markAttendance, cancelAttendance |
| 수납 | member_id, product_id, amount, method(CARD/CASH/TRANSFER), paid_on(null=미납), status, adjustments | registerPayment, adjustPayment |
| 수납 조정 | action(CANCEL/REFUND), amount, reason, on, author, at | 부분 환불 누계는 수납액 초과 불가 |
| 코치 메모 | member_id, content, author_id, author_name, created_at | addNote |

표시상의 EXPIRED/UPCOMING은 기준일·잔여 횟수로 계산한다. 회원권 상태는 로그인 계정 ACTIVE/SUSPENDED와 다른 필드다. 개발용 신규 회원의 계정은 UNCONNECTED이며 가입 성공을 가장하지 않는다.

## 권한과 미확정 정책

현재 개발용 관리자만 상품·수납을 변경하고 관리자/코치가 회원 프로필·회원권·출석·메모를 변경한다. 회원은 본인 이용권·방문·수납·운동만 읽으며 상담 메모와 직원 목록을 받지 않는다. PLATFORM_ADMIN은 이 센터 업무 어댑터에서 거부한다. 이 구분은 미리보기 가정이며 실제 권한 정책 확정과 서버 검증이 필요하다.

- 휴회·재개는 만료일을 자동 연장하지 않는다. 연장 메뉴에서 이유와 새 날짜를 명시한다. 휴회 기간·한도·자동 연장 정책 미확정.
- 출석은 회원당 날짜별 유효 방문 하나. 횟수 차감을 하지 않는다. 실제 차감 시점·취소 복원 정책 미확정.
- 장기 미방문은 방문 또는 등록 이후 30일 기준의 개발용 가정. 센터 운영 정책 확정 필요.
- 환불은 입력된 사실의 기록만 다룬다. 환불액 산식·회계 인식·PG·자동 청구·재등록/양도 정책을 만들지 않는다.
- 기준일 시각은 재현 가능한 정오(KST)를 사용한다. 운영에서는 서버가 행위 시각을 기록한다.
- 실제 API endpoint 이름, 필드 오류 형식, 페이지 크기 상한, 낙관적 동시성 버전, 센터 시간대는 후속 백엔드 설계에서 확정한다.

## 다음 연결 작업

| 기능 | 운영 어댑터 | 개발용 |
|---|---|---|
| 회원 목록 | 기존 GET `/api/members` | 전용 합성 회원 |
| 회원 생성 | 기존 POST `/api/members`, 아이디/이메일/비밀번호 포함 | 프로필만 생성, 계정 UNCONNECTED |
| 회원 수정 | 기존 PATCH `/api/members/{profile_id}` | 전용 합성 프로필 변경 |
| 운동 목록 | 기존 GET `/api/sessions`, epoch 초→ISO 변환 | 현재 빈 목록, 시나리오 보강 예정 |
| 녹화 | 기존 `playRecording`과 장치 저장소 | 실제 파일 접근 없음 |
| 계정 권한 | 기존 `/api/admin/accounts`, 서버 역할 규칙 유지 | 별도 가짜 로그인 권한 변경 없음 |
| 센터 정보 | 로그인 센터 표시, 연락처/시설/라운드는 기존 장치 로컬 설정 | 후속 화면 보강 예정 |
| 회원권/방문/수납/메모 | NOT_CONNECTED 오류, 변경 HTTP 호출 없음 | 전용 비동기 서비스 |

`operations-live.js`가 화면의 member.id를 기존 user_id로 통일하고, 프로필 수정 시 실제 profile.id를 찾아 기존 URL 계약을 유지한다. 알 수 없는 가입 날짜나 계정 상태는 추정하지 않는다. 신규 endpoint/테이블을 구현했다는 의미가 아니다. 기존 실제 DB·녹화·인증 localStorage에 대한 개발용 접근은 금지한다.
