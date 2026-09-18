using System.IO;
using System.Security.Cryptography;
using System.Windows;
using BoxingCoach.Desktop.Services;
using Microsoft.Web.WebView2.Core;

namespace BoxingCoach.Desktop;

public partial class MainWindow : Window
{
    private readonly List<Uri> _allowedOrigins = [];
    private LocalBackendProcess? _backend;
    private NativeBridge? _nativeBridge;
    private LocalApiProxy? _localApiProxy;
    private Uri? _fallbackOrigin;
    private Uri? _currentOrigin;
    private bool _allowBundledFallback;
    private bool _hostedUi;
    private bool _usingFallback;

    public MainWindow()
    {
        InitializeComponent();
        AppWebView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(5, 10, 16);
        Loaded += OnLoaded;
        DesktopDiagnostics.Write("Main window initialized.");
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        try
        {
            var configuration = AppConfiguration.Load();
            _allowBundledFallback = configuration.AllowBundledFallback;
            _hostedUi = configuration.UsesHostedUi;
            var bridgeSecret = _hostedUi
                ? Convert.ToHexString(RandomNumberGenerator.GetBytes(32))
                : string.Empty;
            var workerEnvironment = configuration.WorkerEnvironment
                .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
            if (_hostedUi)
            {
                workerEnvironment["BOXING_COACH_BRIDGE_SECRET"] = bridgeSecret;
            }

            DesktopDiagnostics.Write("Starting local worker.");
            StatusText.Text = "로컬 장치 서비스를 시작하는 중입니다.";
            _backend = await LocalBackendProcess.StartAsync(TimeSpan.FromSeconds(30), workerEnvironment);
            DesktopDiagnostics.Write($"Local backend ready at {_backend.AppUri} (PID {_backend.ProcessId}).");
            _fallbackOrigin = OriginOf(_backend.AppUri);
            _allowedOrigins.Add(_fallbackOrigin);
            if (configuration.HostedAppUri is not null)
            {
                _allowedOrigins.Add(OriginOf(configuration.HostedAppUri));
            }

            var webViewDataDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BoxingCoach",
                "WebView2");
            Directory.CreateDirectory(webViewDataDirectory);

            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: webViewDataDirectory);
            await AppWebView.EnsureCoreWebView2Async(environment);
            DesktopDiagnostics.Write("WebView2 initialized.");
            ConfigureWebView();

            var workerStatus = await WorkerStatus.ReadAsync(_backend.AppUri);
            _nativeBridge = new NativeBridge(
                AppWebView.CoreWebView2,
                new DpapiSessionStore(),
                _allowedOrigins,
                workerStatus,
                _hostedUi);
            _localApiProxy = new LocalApiProxy(AppWebView.CoreWebView2, _backend.AppUri, bridgeSecret);

            var appSource = configuration.HostedAppUri ?? _backend.AppUri;
            _currentOrigin = OriginOf(appSource);
            AppWebView.Source = appSource;
            StatusText.Text = _hostedUi
                ? "중앙 웹과 로컬 장치 서비스를 연결했습니다."
                : "로컬 장치 서비스에 연결했습니다.";
        }
        catch (Exception error)
        {
            DesktopDiagnostics.Write(error);
            StatusText.Text = "앱을 시작하지 못했습니다.";
            MessageBox.Show(
                $"BoxingCoach를 시작하지 못했습니다.\n\n{error.Message}",
                "시작 오류",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Close();
        }
    }

    private void ConfigureWebView()
    {
        var core = AppWebView.CoreWebView2;
        core.Settings.AreDefaultScriptDialogsEnabled = true;
        core.Settings.AreDevToolsEnabled = IsDevelopmentBuild();
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = true;

        core.NavigationStarting += (_, eventArgs) =>
        {
            if (_currentOrigin is null || !LocalOriginPolicy.IsSameOrigin(_currentOrigin, eventArgs.Uri))
            {
                eventArgs.Cancel = true;
                DesktopDiagnostics.Write("Blocked navigation to an unapproved origin.");
            }
        };
        core.NewWindowRequested += (_, eventArgs) => eventArgs.Handled = true;
        core.NavigationCompleted += async (_, eventArgs) =>
        {
            if (!eventArgs.IsSuccess)
            {
                DesktopDiagnostics.Write($"Navigation failed: {eventArgs.WebErrorStatus}.");
                if (_hostedUi && !_usingFallback && _allowBundledFallback && _backend is not null)
                {
                    _usingFallback = true;
                    _currentOrigin = _fallbackOrigin;
                    StatusText.Text = "중앙 웹에 연결할 수 없어 안전한 번들 화면으로 전환합니다.";
                    AppWebView.Source = _backend.AppUri;
                }
                return;
            }
            var diagnostics = await core.ExecuteScriptAsync(
                "JSON.stringify({authStorage:typeof authSessionStorage,platformOps:typeof renderPlatformOperations,stateReady:typeof state,cameraApi:typeof navigator.mediaDevices?.getUserMedia})");
            DesktopDiagnostics.Write($"Web application ready: {diagnostics}");
        };
        core.PermissionRequested += (_, eventArgs) =>
        {
            var allowedOrigin = _currentOrigin is not null
                && LocalOriginPolicy.IsSameOrigin(_currentOrigin, eventArgs.Uri);
            eventArgs.State = allowedOrigin && eventArgs.PermissionKind == CoreWebView2PermissionKind.Camera
                ? CoreWebView2PermissionState.Allow
                : CoreWebView2PermissionState.Deny;
        };
        core.ProcessFailed += (_, eventArgs) =>
        {
            Dispatcher.Invoke(() => StatusText.Text = $"화면 프로세스 오류: {eventArgs.ProcessFailedKind}");
        };
    }

    protected override void OnClosed(EventArgs e)
    {
        DesktopDiagnostics.Write("Desktop window closing.");
        _localApiProxy?.Dispose();
        _nativeBridge?.Dispose();
        AppWebView.Dispose();
        _backend?.Dispose();
        base.OnClosed(e);
    }

    private static Uri OriginOf(Uri uri) => new(uri.GetLeftPart(UriPartial.Authority));

    private static bool IsDevelopmentBuild()
    {
#if DEBUG
        return true;
#else
        return false;
#endif
    }
}
