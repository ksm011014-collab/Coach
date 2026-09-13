using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace BoxingCoach.Desktop.Services;

internal sealed class NativeBridge : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly CoreWebView2 _webView;
    private readonly DpapiSessionStore _sessionStore;
    private readonly IReadOnlyCollection<Uri> _allowedOrigins;
    private readonly string _engineVersion;
    private readonly bool _hostedUi;

    public NativeBridge(
        CoreWebView2 webView,
        DpapiSessionStore sessionStore,
        IReadOnlyCollection<Uri> allowedOrigins,
        string engineVersion,
        bool hostedUi)
    {
        _webView = webView;
        _sessionStore = sessionStore;
        _allowedOrigins = allowedOrigins;
        _engineVersion = engineVersion;
        _hostedUi = hostedUi;
        _webView.WebMessageReceived += OnWebMessageReceived;
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        string requestId = string.Empty;
        try
        {
            if (!LocalOriginPolicy.IsAllowed(_allowedOrigins, eventArgs.Source))
            {
                DesktopDiagnostics.Write($"Rejected native message source: {eventArgs.Source}");
                return;
            }

            var rawMessage = eventArgs.WebMessageAsJson;
            if (!BridgeMessagePolicy.IsMessageSizeAllowed(rawMessage))
            {
                throw new InvalidOperationException("Native bridge message size is invalid.");
            }

            using var message = JsonDocument.Parse(rawMessage);
            var root = message.RootElement;
            requestId = root.GetProperty("id").GetString() ?? string.Empty;
            var type = root.GetProperty("type").GetString() ?? string.Empty;
            if (!BridgeMessagePolicy.IsRequestIdAllowed(requestId)
                || !BridgeMessagePolicy.IsTypeAllowed(type))
            {
                throw new InvalidOperationException("Native bridge message schema is invalid.");
            }

            object? payload = type switch
            {
                "auth.get" => _sessionStore.Load(),
                "auth.set" => SaveSession(root.GetProperty("payload")),
                "auth.clear" => ClearSession(),
                "platform.get" => new
                {
                    platform = "windows",
                    secureStorage = "dpapi",
                    bridgeProtocol = BridgeMessagePolicy.ProtocolVersion,
                    engineVersion = _engineVersion,
                    hostedUi = _hostedUi,
                    localApiBase = "/__local_api",
                },
                _ => throw new InvalidOperationException("지원하지 않는 데스크톱 브리지 메시지입니다."),
            };
            Reply(requestId, true, payload, null);
        }
        catch (Exception error)
        {
            DesktopDiagnostics.Write(error);
            if (BridgeMessagePolicy.IsRequestIdAllowed(requestId))
            {
                Reply(requestId, false, null, "Windows 보안 브리지 요청을 처리하지 못했습니다.");
            }
        }
    }

    private object SaveSession(JsonElement payload)
    {
        var session = payload.Deserialize<AuthSession>(JsonOptions)
            ?? throw new InvalidOperationException("로그인 세션 형식이 올바르지 않습니다.");
        _sessionStore.Save(session);
        return new { saved = true };
    }

    private object ClearSession()
    {
        _sessionStore.Clear();
        return new { cleared = true };
    }

    private void Reply(string requestId, bool ok, object? payload, string? error)
    {
        var response = JsonSerializer.Serialize(new { id = requestId, ok, payload, error }, JsonOptions);
        _webView.PostWebMessageAsJson(response);
    }

    public void Dispose()
    {
        _webView.WebMessageReceived -= OnWebMessageReceived;
    }
}
