using System.Net.Http;
using System.Text.Json;

namespace BoxingCoach.Desktop.Services;

internal sealed record WorkerStatus(string EngineVersion, JsonElement? Capabilities, bool Available)
{
    public static WorkerStatus Unavailable => new("0.0.0", null, false);

    public static WorkerStatus Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.GetProperty("status").GetString() != "ok"
            || root.GetProperty("service").GetString() != "boxing-coach-local") return Unavailable;
        var version = root.GetProperty("version").GetString();
        var capabilities = root.GetProperty("capabilities");
        if (!Version.TryParse(version, out _)
            || capabilities.GetProperty("contract_version").GetInt32() != 1
            || capabilities.GetProperty("engine_version").GetString() != version) return Unavailable;
        return new WorkerStatus(version!, capabilities.Clone(), true);
    }

    public static async Task<WorkerStatus> ReadAsync(Uri localOrigin)
    {
        try
        {
            using var client = new HttpClient(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false })
            {
                Timeout = TimeSpan.FromSeconds(3),
            };
            return Parse(await client.GetStringAsync(new Uri(localOrigin, "/api/system/health")));
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException
            or JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
        {
            return Unavailable;
        }
    }
}
