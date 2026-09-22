# 관리 화면 업무 API 계약

2026-09-20: SQLite 실제 HTTP와 Supabase staging의 Auth·Edge·업무 RPC·센터 격리를 검증했다. 사용자 별도 승인 후 현재 개발 DB의 백업·schema 3 전환·동일 DB 재시작을 완료했다. 운영 배포와 실제 장치는 미검증이다.

## 연결 상태

| 기능 | 실제 어댑터 |
|---|---|
| 회원 목록 | 기존 /api/members와 업무 metadata 병합 |
| 회원 생성·수정·보존형 삭제 | /api/operations: member.create/update/delete |
| 상품·이용권·출석·수납·환불·메모 | /api/operations: SQLite 또는 중앙 RPC |
| 원형·6개월 차트 | 실제 업무 snapshot 집계 |
| 운동·녹화 | 기존 /api/sessions와 장치 저장소 |
| 로그인 계정·본인 프로필 | 기존 API 유지 |
| 센터 연락처·주소·평일/주말 운영시간 | snapshot.center 및 center.save, SQLite/Supabase 공통 저장 |
| 라운드·장치 설정 / 직원 업무 프로필 | 기존 장치 저장 유지 / 직원 서비스 미연결 |

개발용은 전용 합성 저장소만 사용하고 실제 API에 preview- ID를 보내지 않는다. 개발용 회원은 로그인 계정 없는 UNCONNECTED 프로필이다.

## 조회·변경

GET /api/operations?date=YYYY-MM-DD는 referenceDate, 회원 metadata·상품·이용권/이력·방문·수납/조정·메모 배열, 선택일 roster와 최근 6개월 revenue를 반환한다. 회원은 본인 자료만 받으며 상담 메모는 받지 않는다. 현재 허용 범위 전체 snapshot을 받아 화면에서 검색·페이지 이동한다. 대규모 센터의 서버 페이지 처리는 별도 확장이 필요하다.

POST /api/operations 요청은 {operation, input, request_id}, 응답은 {result}다. 변경은 center.save, product.save, pass.assign, pass.change, attendance.mark/cancel, payment.register/adjust, note.add, member.create/update/delete다.

center.save는 소유자만 호출하며 id, version, phone, address, weekday_hours, weekend_hours를 받는다. 최초 version은 0이다. 센터 구성원은 공통 정보를 조회할 수 있다. 기존 브라우저에 남은 연락처를 자동 업로드하지 않는다. 라운드 분·초는 합산한 초 단위로 기존 장치 설정에 저장한다. 링·샌드백 필드는 UI에서만 제거했다.

member.update의 height_cm, weight_kg, training_level(1~5), stance, injury_note는 기존 프로필 필드를 사용한다. injury_note의 화면 이름은 메모이며 본인에게도 보인다. 직원 전용 상담 메모 note.add와 다르다. 만료일 변경은 pass_id, pass_version, end_on, reason을 명시한다. 선택 이용권 소유자·센터·버전·시작일을 검증하고 프로필과 만료일·SET_END 이력을 한 트랜잭션으로 저장한다. 등록일은 UI에서 수정하지 않는다. 이용권이 없으면 만료일을 생성하지 않는다.

수납 method는 CARD, CASH, TRANSFER, KAKAOPAY, EASY_PAY다. 간편결제도 수납 사실 기록이며 실제 승인·환불 송금은 실행하지 않는다. 후속 PG 연동은 별도 거래 식별자·승인 상태·웹훅 중복 방지 계약을 추가한 후 수납 사실에 연결해야 한다.

기존 행 변경은 조회된 version을 보낸다. 같은 행위자·키·본문 재전송은 기존 결과를 반환하고 다른 본문이나 오래된 버전은 409다. 모달은 중복 제출을 막고 요청 키를 유지한다. 저장 후 조회 실패는 조회만 재시도한다. 중앙 등록 결과가 불명확하면 원래 입력·키로 재시도한다.

검증 400, 권한 403, 대상 없음 404, 충돌 409, 서비스 불가 503을 화면 오류로 매핑한다. 기존 인증 계약을 유지하며 미연결 서비스를 성공으로 표시하지 않는다. 회원 ID는 user_id, 기존 프로필 API에는 profile.id를 별도로 매핑한다. 기존 프로필 API도 업무 버전을 갱신하고 삭제 회원 수정·계정 재활성화를 거부한다.

## 권한

센터 소유자만 회원 생성·삭제, 상품·수납을 변경한다. 소유자/코치는 회원 수정·이용권·방문·메모를 변경한다. 회원은 본인 조회와 기존 본인 프로필/운동 권한을 유지한다. 플랫폼 관리자는 신규 업무 API에서 거부하며 기존 관리 조회만 유지한다. 모든 업무 데이터는 center_id로 격리한다. Supabase는 RLS 조회, 직접 쓰기 거부, RPC의 역할·센터·버전 재검증을 적용한다.

## 날짜·집계

- 일자는 YYYY-MM-DD, 시각은 오프셋 있는 ISO 8601, 금액은 KRW 원 정수다. 센터 기본 시간대는 Asia/Seoul이다.
- 출결 명단은 등록일 이상·삭제 효력일 미만이다. 미래 UPCOMING, 유효 방문 PRESENT, 나머지 ABSENT다. 이용권 만료와 등록 여부를 구분한다. 등록일 미확보는 집계에서 제외하고 건수를 표시한다.
- 대시보드는 오늘 등록 회원 대비 출석, 이번 달 포함 6개월 수납−환불/유상 취소다. 사실의 발생월에 반영하고 빈 달은 0이다. 비용 차감 순이익이 아니다. 기간 밖 원수납 환불도 환불월에 차감한다.
- 미납은 paid_on=null이며 수익에 포함하지 않는다. 환불 누계는 원수납 이하이다. PG·송금·자동 청구·환불 산식은 범위 밖이다.
- 휴회·재개는 자동 연장하지 않는다. 연장에는 새 날짜·사유가 필요하며 출석은 횟수를 자동 차감하지 않는다.
- 회원권 PAUSED/UPCOMING/NONE은 필터에서 제외하고 배지는 ‘—’로 표시한다. 원본 상태와 이력·해당 회원은 보존한다. 출석의 미래 UPCOMING은 계속 미도래다.
- 출석 최초 진입·탭 재진입은 센터의 오늘을 기본으로 한다. 오늘 조회 중에는 60초 간격과 창 포커스 복귀 시 날짜/월을 갱신한다. 과거 날짜나 다른 달을 선택하면 선택을 유지하며 입력·모달 중에는 자동 조회하지 않는다.

## 기존 장치 동작

운동 세션은 방문과 별도다. epoch 초는 어댑터에서 ISO로 변환한다. 서버 운동 삭제 후 장치 삭제가 실패하면 같은 모달에서 장치 삭제만 재시도한다. 재로드를 넘는 분산 복구는 별도 과제다. 실행 중 세션은 종료 후 삭제한다. 녹화 interrupted는 장치 전용이며 수신 데이터를 보존하고 중단을 표시한다. 빈 녹화는 성공 처리하지 않는다.

검증·전환 및 중앙 등록 복구 설계는 [06](06-operations-integration.md)을 따른다.
