# BoxingCoach Windows Desktop

제품 클라이언트는 .NET 8 WPF + WebView2 셸과 PyInstaller 로컬 워커로 구성된다. 기존 HTML/JavaScript 코칭 UI를 재사용하면서 WinUI 3보다 런타임 의존성과 패키징 복잡도가 낮아 WPF를 선택했다.

## 런타임 구조

- WPF가 운영체제 할당 loopback 포트에서 `worker\BoxingCoach.Worker.exe`를 시작한다.
- 워커가 `BOXING_COACH_READY`를 출력한 뒤에만 WebView2가 로컬 앱을 연다.
- WebView2는 같은 loopback origin에만 카메라 권한을 부여하고 외부 탐색과 새 창을 차단한다.
- 단일 인스턴스 mutex가 중복 실행을 막고 Windows Job Object가 앱 종료·충돌 시 워커 트리를 종료한다.
- 로그인 세션은 WebView2 `localStorage` 대신 Windows DPAPI 저장소를 사용한다.

## 개발 실행

필수 항목은 Windows 10/11 x64, .NET 8 SDK, WebView2 Evergreen Runtime, Python 3.10/3.11과 `requirements.txt` 의존성이다.

```powershell
$env:BOXING_COACH_PROJECT_ROOT = (Resolve-Path .)
dotnet run --project .\windows\BoxingCoach.Desktop\BoxingCoach.Desktop.csproj
```

Supabase 자격 증명이 없어도 기본 `local` 모드로 실행된다. 중앙 모드는 `%LOCALAPPDATA%\BoxingCoach\appsettings.json` 또는 빌드 인수로 URL과 publishable key만 주입한다. `service_role` 키와 데이터베이스 비밀번호는 데스크톱 앱에 넣지 않는다.

## 빌드 도구

전체 Windows SDK가 없다면 공식 Microsoft Windows SDK Build Tools NuGet 패키지를 저장소 밖의 무시된 `.tools` 폴더에 설치한다.

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\install-build-tools.ps1
```

개발용 unsigned MSIX와 App Installer 생성:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\build-release.ps1 `
  -Version 1.0.0 `
  -Channel stable `
  -PackageBaseUri https://download.example.com/boxingcoach
```

중앙 계정 설정을 포함하려면 `-SupabaseUrl`, `-SupabasePublishableKey`를 추가한다. URL이나 키를 생략하면 패키지는 로컬 개발 모드로 만들어진다.

## 서명

테스트 전용 인증서는 다음 스크립트로 만들 수 있다. 생성된 `.cer`만 테스트 장치의 `신뢰할 수 있는 사용자`에 설치하고 `.pfx`는 외부에 배포하지 않는다.

```powershell
$developmentPassword = Read-Host 'Temporary development PFX password'
powershell -ExecutionPolicy Bypass -File .\windows\new-development-certificate.ps1 -Password $developmentPassword
$developmentPassword = $null
```

서명된 릴리스:

```powershell
$env:BOXING_COACH_CERT_PASSWORD = Read-Host 'PFX password'
powershell -ExecutionPolicy Bypass -File .\windows\build-release.ps1 `
  -Version 1.0.0 `
  -Channel stable `
  -Publisher 'CN=Your certificate subject' `
  -CertificatePath C:\secure\BoxingCoach.pfx `
  -TimestampUrl https://your-timestamp-service.example `
  -PackageBaseUri https://download.example.com/boxingcoach `
  -SupabaseUrl https://PROJECT.supabase.co `
  -SupabasePublishableKey sb_publishable_REPLACE_ME
$env:BOXING_COACH_CERT_PASSWORD = $null
```

`Publisher`는 서명 인증서 Subject와 정확히 같아야 한다. 실제 고객 배포에는 공인 코드 서명 인증서 또는 Microsoft Store 서명을 사용한다.

## 배포 디렉터리

스크립트는 다음 URI 구조를 생성한다.

```text
artifacts/
  stable/
    BoxingCoach-stable.appinstaller
    1.0.0.0/
      BoxingCoach.Apex-1.0.0.0-x64.msix
      release.json
  beta/
    BoxingCoach-beta.appinstaller
    1.0.0.0/
      BoxingCoach.Apex.Beta-1.0.0.0-x64.msix
      release.json
```

1. 새 버전의 서명된 MSIX를 App Installer가 참조하는 HTTPS 경로에 먼저 업로드한다.
2. 파일 다운로드와 서명을 검증한다.
3. 채널 루트의 `.appinstaller`를 마지막에 교체한다.
4. 선택 업데이트는 기본 빌드를 사용하고, 즉시 강제해야 할 보안 업데이트만 `-ForceUpdate`로 빌드한다.
5. 이전 코드로 되돌려야 하면 버전을 낮추지 말고, 이전 코드를 더 높은 새 버전으로 다시 빌드한다.

웹 서버는 HTTPS를 사용하고 `.appinstaller`와 `.msix`를 다운로드 가능한 정적 파일로 제공해야 한다. stable과 beta의 `PackageBaseUri`, 패키지 ID, App Installer 파일을 서로 섞지 않는다.

## GitHub Actions

`.github/workflows/windows-release.yml`은 Python/JavaScript 테스트, DPAPI smoke test, 자체 포함 WPF 게시, PyInstaller 워커, MSIX, App Installer를 생성한다.

필요한 저장소 설정:

- Secret `MSIX_CERTIFICATE_BASE64`: PFX 파일의 Base64. 없으면 unsigned 테스트 산출물만 생성한다.
- Secret `MSIX_CERTIFICATE_PASSWORD`: PFX 비밀번호.
- Secret `MSIX_PUBLISHER`: 인증서 Subject.
- Variable `BOXING_COACH_RELEASE_BASE_URI`: 채널 폴더 전까지의 HTTPS 기본 URI.
- Variable `BOXING_COACH_SUPABASE_URL`: Supabase 프로젝트 URL.
- Variable `BOXING_COACH_SUPABASE_PUBLISHABLE_KEY`: 공개 가능한 publishable key.
- Variable `MSIX_TIMESTAMP_URL`: 인증서 발급자가 권장하는 RFC 3161 타임스탬프 URL.

워크플로 산출물은 자동으로 외부 서버에 게시하지 않는다. 검증 후 별도 승인된 배포 단계에서 업로드한다.

## 비용 발생 지점

- 로컬 개발, WPF, WebView2, PyInstaller, 개발용 자체 서명은 별도 서버 비용 없이 가능하다.
- 실제 중앙 계정 운영은 Supabase 사용량에 따라 무료 구간 이후 비용이 생길 수 있다.
- HTTPS 파일 호스팅/CDN, GitHub Actions 사용량, 공인 코드 서명 또는 관리형 서명은 선택한 공급자와 사용량에 따라 비용이 생길 수 있다.
- Microsoft Store 배포를 선택하면 계정 등록 및 정책 요건을 별도로 확인한다.
