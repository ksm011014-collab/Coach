# 다른 기기에서 이어서 작업하기

## 다음 Codex에게 전달할 프롬프트

> 이 저장소의 `AGENTS.md`, `box/docs/refoundation/00-frontend-objective.md`와 `01-removal.md`부터 `05-frontend-api-contract.md`까지 읽고, BoxingCoach 프론트엔드 완성 작업을 이어서 구현·검증해줘. 00 문서가 원본 목표이며 04·05는 진행 중 인수인계다. 현재 코드와 테스트를 기준으로 남은 요구사항을 감사하고 완료할 때까지 진행해줘. 신규 백엔드/API/DB/결제 서비스는 만들지 마라. 커밋·푸시·배포·운영 DB 변경·기존 DB 및 녹화 삭제는 금지한다. 프론트 완료와 백엔드 미구현을 구분해서 한국어로 보고해줘.

## 환경 준비

저장소 외부의 Codex 첨부파일이나 개인 런타임 경로가 필요하지 않다.
Windows에 Python 3.12 이상, Node.js 22 이상(npm 포함), Chrome이 설치돼 있어야 한다.
의존성 최초 설치에는 인터넷이 필요하다. 저장소 루트 PowerShell에서:

```powershell
powershell -ExecutionPolicy Bypass -File box/tools/dev.ps1 -Action setup
powershell -ExecutionPolicy Bypass -File box/tools/dev.ps1 -Action test
powershell -ExecutionPolicy Bypass -File box/tools/dev.ps1 -Action serve
```

Python 탐색이 실패하면 setup에 `-Python C:\path\to\python.exe`를 지정한다.
serve는 loopback에서 실행하고 `box/artifacts/development.db`만 사용한다.
기존 `box/backend/boxing_coach.db`를 열거나 마이그레이션하지 않는다.
새 개발 DB에는 기본 계정이 없다. 로그인 화면에서 관리자 가입을 하거나,
`http://127.0.0.1:8000/preview.html?enable=1`에서 격리된 합성 데이터로 확인한다.
서버는 Ctrl+C로 종료한다. 테스트는 별도 임시 DB를 사용한다.

## 현재 상태와 우선 작업

- 기존 모션/캘리브레이션/자동 피드백 제거 및 백엔드 안정화 변경도 현재 소스에 포함돼 있다. 되돌리지 않는다.
- 실제 회원 생성·수정, 운동 목록 및 녹화 재생 연결과 개발용 관리 서비스가 구현됐다.
- 아직 목표 완료가 아니다. 원본 목표 A~H를 현재 구현과 대조해야 한다.
- 미리보기의 직원/센터/본인 프로필, 운동 합성 기록 시나리오를 보강한다.
- 역할별 UI 권한, 저장 후 조회 실패, 모달 포커스 복귀·탭 키보드, 긴 목록·빈 상태·조회/저장 오류 검증이 남아 있다.
- 기존 실제 기록 관리/다운로드/삭제 기능의 UI 연결 누락 여부를 확인한다. 테스트 외 실제 기록을 삭제하지 않는다.
- operations-shell.js의 큰 렌더링과 남은 CSS/상태/리스너를 정리한다.
- 04·05 문서를 최종 구현 및 테스트 근거에 맞춰 완성한다.

최근 Python 80개와 신규/기존 JS·Chrome 테스트가 통과했지만, 변경 후 필요한 검증은 다시 한다.
.NET SDK가 없던 기기에서 작업했으므로 WPF 빌드·실제 WebView2/Android 기기 검증은 미검증이다.
새 기기에서도 실행 불가능한 환경은 별도로 보고한다.

## Git으로 전달하지 않는 것

DB·녹화·브라우저 로그인/localStorage·개인 .env·node_modules·가상환경·생성 빌드·스크린샷은 필요하지 않다.
환경과 합성 데이터는 위 명령으로 다시 준비하고 스크린샷은 테스트로 다시 생성할 수 있다.
변경 전 스크린샷은 이전 기기의 artifacts에만 있으므로 없을 경우 미확보라고 명시한다.
기존 Git 이력에 들어간 DB는 추적 해제만으로 과거 이력에서 지워지지는 않는다.
