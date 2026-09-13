using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.IO;
using System.Text;
using Microsoft.Web.WebView2.Core;

namespace BoxingCoach.Desktop.Services;

internal sealed class LocalApiProxy : IDisposable
{
    private const long MaximumRequestBytes = 256L * 1024L * 1024L;
    private readonly CoreWebView2 _webView;
    private readonly Uri _backendBaseUri;
    private readonly string _bridgeSecret;
    private readonly HttpClient _httpClient;

    public LocalApiProxy(CoreWebView2 webView, Uri backendBaseUri, string bridgeSecret)
    {
        if (!backendBaseUri.IsLoopback || backendBaseUri.Scheme != Uri.UriSchemeHttp)
        {
            throw new ArgumentException("The local API proxy requires an HTTP loopback backend.", nameof(backendBaseUri));
        }

        _webView = webView;
        _backendBaseUri = new Uri(backendBaseUri.GetLeftPart(UriPartial.Authority));
        _bridgeSecret = bridgeSecret;
        _httpClient = new HttpClient(new HttpClientHandler { UseProxy = false })
        {
            Timeout = TimeSpan.FromMinutes(10),
        };
        _webView.AddWebResourceRequestedFilter(
            "*://*/__local_api/*",
            CoreWebView2WebResourceContext.All);
        _webView.WebResourceRequested += OnWebResourceRequested;
    }

    private async void OnWebResourceRequested(
        object? sender,
        CoreWebView2WebResourceRequestedEventArgs eventArgs)
    {
        var deferral = eventArgs.GetDeferral();
        try
        {
            if (!Uri.TryCreate(eventArgs.Request.Uri, UriKind.Absolute, out var requestUri)
                || !LocalApiPolicy.TryMap(requestUri, eventArgs.Request.Method, out var localApiPath))
            {
                eventArgs.Response = JsonResponse(HttpStatusCode.Forbidden, "허용되지 않은 로컬 API 요청입니다.");
                return;
            }

            using var request = new HttpRequestMessage(
                new HttpMethod(eventArgs.Request.Method),
                new Uri(_backendBaseUri, localApiPath));
            if (!string.IsNullOrEmpty(_bridgeSecret))
            {
                request.Headers.TryAddWithoutValidation("X-BoxingCoach-Bridge", _bridgeSecret);
            }
            CopyHeader(eventArgs.Request.Headers, request.Headers, "Authorization");

            if (eventArgs.Request.Content is not null
                && eventArgs.Request.Method is not ("GET" or "HEAD"))
            {
                var length = HeaderValue(eventArgs.Request.Headers, "Content-Length");
                if (long.TryParse(length, out var requestLength) && requestLength > MaximumRequestBytes)
                {
                    eventArgs.Response = JsonResponse(HttpStatusCode.RequestEntityTooLarge, "로컬 API 요청이 너무 큽니다.");
                    return;
                }
                var body = new MemoryStream();
                var buffer = new byte[81920];
                long totalBytes = 0;
                int bytesRead;
                while ((bytesRead = await eventArgs.Request.Content.ReadAsync(buffer)) > 0)
                {
                    totalBytes += bytesRead;
                    if (totalBytes > MaximumRequestBytes)
                    {
                        body.Dispose();
                        eventArgs.Response = JsonResponse(HttpStatusCode.RequestEntityTooLarge, "로컬 API 요청이 너무 큽니다.");
                        return;
                    }
                    await body.WriteAsync(buffer.AsMemory(0, bytesRead));
                }
                body.Position = 0;
                request.Content = new StreamContent(body);
                var contentType = HeaderValue(eventArgs.Request.Headers, "Content-Type");
                if (!string.IsNullOrWhiteSpace(contentType))
                {
                    request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
                }
            }

            using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            if (response.Content.Headers.ContentLength > MaximumRequestBytes)
            {
                eventArgs.Response = JsonResponse(HttpStatusCode.RequestEntityTooLarge, "로컬 API 응답이 너무 큽니다.");
                return;
            }
            var responseBytes = await response.Content.ReadAsByteArrayAsync();
            var responseStream = new MemoryStream(responseBytes, writable: false);
            var responseHeaders = new StringBuilder("Cache-Control: no-store\r\n");
            if (response.Content.Headers.ContentType is not null)
            {
                responseHeaders.Append("Content-Type: ")
                    .Append(response.Content.Headers.ContentType)
                    .Append("\r\n");
            }
            if (response.Content.Headers.ContentDisposition is not null)
            {
                responseHeaders.Append("Content-Disposition: ")
                    .Append(response.Content.Headers.ContentDisposition)
                    .Append("\r\n");
            }
            eventArgs.Response = _webView.Environment.CreateWebResourceResponse(
                responseStream,
                (int)response.StatusCode,
                response.ReasonPhrase ?? response.StatusCode.ToString(),
                responseHeaders.ToString());
        }
        catch (Exception error)
        {
            DesktopDiagnostics.Write(error);
            eventArgs.Response = JsonResponse(HttpStatusCode.BadGateway, "Windows 로컬 AI 엔진에 연결할 수 없습니다.");
        }
        finally
        {
            deferral.Complete();
        }
    }

    private CoreWebView2WebResourceResponse JsonResponse(HttpStatusCode status, string message)
    {
        var json = System.Text.Json.JsonSerializer.Serialize(new { error = message });
        var stream = new MemoryStream(Encoding.UTF8.GetBytes(json), writable: false);
        return _webView.Environment.CreateWebResourceResponse(
            stream,
            (int)status,
            status.ToString(),
            "Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n");
    }

    private static void CopyHeader(
        CoreWebView2HttpRequestHeaders source,
        HttpRequestHeaders destination,
        string name)
    {
        var value = HeaderValue(source, name);
        if (!string.IsNullOrWhiteSpace(value))
        {
            destination.TryAddWithoutValidation(name, value);
        }
    }

    private static string HeaderValue(CoreWebView2HttpRequestHeaders headers, string name) =>
        headers.Contains(name) ? headers.GetHeader(name) : string.Empty;

    public void Dispose()
    {
        _webView.WebResourceRequested -= OnWebResourceRequested;
        _httpClient.Dispose();
    }
}
