# BoxingCoach Windows 설치 안내

## 고객 설치

1. 운영자가 전달한 `BoxingCoach-stable.appinstaller`를 실행합니다.
2. Windows App Installer에서 게시자 이름과 버전을 확인한 뒤 **설치**를 선택합니다.
3. 시작 메뉴에서 **APEX Boxing AI Coach**를 실행합니다. 별도 브라우저나 Python 설치는 필요하지 않습니다.
4. 처음 카메라를 사용할 때 Windows 카메라 권한을 허용합니다.

운영 배포 파일은 신뢰할 수 있는 코드 서명 인증서로 서명되어야 합니다. 개발용 자체 서명 인증서를 사용한 테스트 장치는 공개 인증서(`.cer`)를 `신뢰할 수 있는 사용자` 저장소에 먼저 설치해야 합니다. 비밀키가 든 `.pfx` 파일은 고객에게 전달하지 않습니다.

## 자동 업데이트

- 앱은 App Installer를 통해 실행 시마다 새 버전을 확인하고 백그라운드 검사도 수행합니다.
- 선택 업데이트는 사용자가 안내창에서 설치 시점을 선택할 수 있습니다.
- 강제 업데이트 릴리스는 새 버전을 설치하기 전까지 기존 앱 실행을 차단할 수 있습니다.
- stable과 beta는 서로 다른 패키지 ID와 App Installer 파일을 사용하므로 한 PC에 함께 설치할 수 있습니다.
- 업데이트에 실패하면 Windows가 한국어 오류를 표시합니다. 인터넷 연결, 디스크 여유 공간, 게시자 인증서 신뢰 여부를 확인한 뒤 App Installer 파일을 다시 실행합니다.

업데이트가 반복해서 실패하면 `%LOCALAPPDATA%\BoxingCoach\logs\desktop.log`를 운영자에게 전달합니다. 로그인 토큰이나 코드 서명 비밀키는 이 로그에 기록되지 않습니다.

## 로컬 데이터

- 카메라 영상과 실시간 자세 처리는 기본적으로 PC 안에서 수행됩니다.
- 중앙 모드에서는 계정, 회원, 캘리브레이션, 훈련 요약만 Supabase에 저장합니다.
- Windows 로그인 세션은 DPAPI로 암호화되어 현재 Windows 사용자만 읽을 수 있습니다.
- 로컬 개발 모드의 SQLite 파일은 `%LOCALAPPDATA%\BoxingCoach\boxing_coach.db`에 저장됩니다.

## 지원 환경

- Windows 10 2004 이상 또는 Windows 11, x64
- Microsoft Edge WebView2 Evergreen Runtime
- 카메라 사용 권한과 중앙 계정 모드에서의 인터넷 연결
