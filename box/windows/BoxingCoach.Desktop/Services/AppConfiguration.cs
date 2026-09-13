using System.IO;
using System.Text.Json;

namespace BoxingCoach.Desktop.Services;

internal sealed class AppConfiguration
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private AppConfiguration(
        IReadOnlyDictionary<string, string> workerEnvironment,
        string uiMode,
        Uri? hostedAppUri,
        bool allowBundledFallback)
    {
        WorkerEnvironment = workerEnvironment;
        UiMode = uiMode;
        HostedAppUri = hostedAppUri;
        AllowBundledFallback = allowBundledFallback;
    }

    public IReadOnlyDictionary<string, string> WorkerEnvironment { get; }
    public string UiMode { get; }
    public Uri? HostedAppUri { get; }
    public bool AllowBundledFallback { get; }
    public bool UsesHostedUi => UiMode == "hosted";

    public static AppConfiguration Load()
    {
        var settings = new WorkerSettings();
        settings = Merge(settings, ReadSettings(Path.Combine(AppContext.BaseDirectory, "appsettings.json")));
        settings = Merge(
            settings,
            ReadSettings(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BoxingCoach",
                "appsettings.json")));
        settings = Merge(
            settings,
            new WorkerSettings
            {
                DataMode = Environment.GetEnvironmentVariable("BOXING_COACH_DATA_MODE"),
                SupabaseUrl = Environment.GetEnvironmentVariable("BOXING_COACH_SUPABASE_URL"),
                SupabasePublishableKey = Environment.GetEnvironmentVariable("BOXING_COACH_SUPABASE_PUBLISHABLE_KEY"),
                AuthEmailDomain = Environment.GetEnvironmentVariable("BOXING_COACH_AUTH_EMAIL_DOMAIN"),
                UiMode = Environment.GetEnvironmentVariable("BOXING_COACH_UI_MODE"),
                HostedAppUrl = Environment.GetEnvironmentVariable("BOXING_COACH_HOSTED_APP_URL"),
                AllowBundledFallback = ParseBoolean(Environment.GetEnvironmentVariable("BOXING_COACH_ALLOW_BUNDLED_FALLBACK")),
            });

        var mode = string.IsNullOrWhiteSpace(settings.DataMode) ? "local" : settings.DataMode.Trim().ToLowerInvariant();
        if (mode is not ("local" or "supabase"))
        {
            throw new InvalidOperationException("DataMode는 local 또는 supabase여야 합니다.");
        }
        if (mode == "supabase" && (string.IsNullOrWhiteSpace(settings.SupabaseUrl) || string.IsNullOrWhiteSpace(settings.SupabasePublishableKey)))
        {
            throw new InvalidOperationException("중앙 계정 모드에는 SupabaseUrl과 SupabasePublishableKey가 필요합니다.");
        }

        var uiMode = string.IsNullOrWhiteSpace(settings.UiMode) ? "local" : settings.UiMode.Trim().ToLowerInvariant();
        if (uiMode is not ("local" or "hosted"))
        {
            throw new InvalidOperationException("UiMode는 local 또는 hosted여야 합니다.");
        }
        if (uiMode == "hosted" && mode != "supabase")
        {
            throw new InvalidOperationException("hosted UI 모드는 Supabase 데이터 모드가 필요합니다.");
        }
        Uri? hostedAppUri = null;
        if (uiMode == "hosted")
        {
            if (!Uri.TryCreate(settings.HostedAppUrl, UriKind.Absolute, out hostedAppUri))
            {
                throw new InvalidOperationException("HostedAppUrl에 올바른 절대 URL이 필요합니다.");
            }
            var allowInsecureLoopback = hostedAppUri.IsLoopback
                && Environment.GetEnvironmentVariable("BOXING_COACH_ALLOW_INSECURE_HOSTED_UI") == "1";
            if (!string.Equals(hostedAppUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
                && !allowInsecureLoopback)
            {
                throw new InvalidOperationException("운영 HostedAppUrl은 HTTPS여야 합니다.");
            }
        }

        var environment = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["BOXING_COACH_DATA_MODE"] = mode,
            ["BOXING_COACH_AUTH_EMAIL_DOMAIN"] = settings.AuthEmailDomain?.Trim() ?? "accounts.boxingcoach.app",
        };
        if (!string.IsNullOrWhiteSpace(settings.SupabaseUrl))
        {
            environment["BOXING_COACH_SUPABASE_URL"] = settings.SupabaseUrl.Trim().TrimEnd('/');
        }
        if (!string.IsNullOrWhiteSpace(settings.SupabasePublishableKey))
        {
            environment["BOXING_COACH_SUPABASE_PUBLISHABLE_KEY"] = settings.SupabasePublishableKey.Trim();
        }
        return new AppConfiguration(
            environment,
            uiMode,
            hostedAppUri,
            settings.AllowBundledFallback ?? true);
    }

    private static WorkerSettings? ReadSettings(string path)
    {
        if (!File.Exists(path))
        {
            return null;
        }
        try
        {
            return JsonSerializer.Deserialize<WorkerSettings>(File.ReadAllText(path), JsonOptions);
        }
        catch (Exception error) when (error is IOException or JsonException)
        {
            throw new InvalidOperationException($"앱 설정 파일을 읽지 못했습니다: {path}", error);
        }
    }

    private static WorkerSettings Merge(WorkerSettings current, WorkerSettings? overlay)
    {
        if (overlay is null)
        {
            return current;
        }
        return new WorkerSettings
        {
            DataMode = Value(overlay.DataMode, current.DataMode),
            SupabaseUrl = Value(overlay.SupabaseUrl, current.SupabaseUrl),
            SupabasePublishableKey = Value(overlay.SupabasePublishableKey, current.SupabasePublishableKey),
            AuthEmailDomain = Value(overlay.AuthEmailDomain, current.AuthEmailDomain),
            UiMode = Value(overlay.UiMode, current.UiMode),
            HostedAppUrl = Value(overlay.HostedAppUrl, current.HostedAppUrl),
            AllowBundledFallback = overlay.AllowBundledFallback ?? current.AllowBundledFallback,
        };
    }

    private static string? Value(string? overlay, string? current) =>
        string.IsNullOrWhiteSpace(overlay) ? current : overlay;

    private static bool? ParseBoolean(string? value) =>
        bool.TryParse(value, out var parsed) ? parsed : null;

    private sealed class WorkerSettings
    {
        public string? DataMode { get; init; }
        public string? SupabaseUrl { get; init; }
        public string? SupabasePublishableKey { get; init; }
        public string? AuthEmailDomain { get; init; }
        public string? UiMode { get; init; }
        public string? HostedAppUrl { get; init; }
        public bool? AllowBundledFallback { get; init; }
    }
}
