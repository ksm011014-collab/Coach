namespace BoxingCoach.Desktop.Services;

internal static class LocalApiPolicy
{
    private const string ProxyPrefix = "/__local_api";

    private static readonly IReadOnlyDictionary<string, string> AllowedMethods =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["/system/pose3d"] = "GET",
            ["/pose/3d"] = "POST",
            ["/calibration/human"] = "POST",
            ["/recordings/convert"] = "POST",
        };

    public static bool TryMap(Uri requestUri, string method, out string localApiPath)
    {
        localApiPath = string.Empty;
        if (!requestUri.AbsolutePath.StartsWith(ProxyPrefix + "/", StringComparison.Ordinal))
        {
            return false;
        }

        var relativePath = requestUri.AbsolutePath[ProxyPrefix.Length..];
        if (!AllowedMethods.TryGetValue(relativePath, out var allowedMethod)
            || !string.Equals(method, allowedMethod, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        localApiPath = "/api" + relativePath;
        return true;
    }
}
