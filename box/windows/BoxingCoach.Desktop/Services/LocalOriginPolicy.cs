namespace BoxingCoach.Desktop.Services;

internal static class LocalOriginPolicy
{
    public static bool IsAllowed(IEnumerable<Uri> allowedOrigins, string candidate) =>
        allowedOrigins.Any(allowedOrigin => IsSameOrigin(allowedOrigin, candidate));

    public static bool IsSameOrigin(Uri allowedOrigin, string candidate)
    {
        return Uri.TryCreate(candidate, UriKind.Absolute, out var candidateUri)
            && string.Equals(candidateUri.Scheme, allowedOrigin.Scheme, StringComparison.OrdinalIgnoreCase)
            && string.Equals(candidateUri.IdnHost, allowedOrigin.IdnHost, StringComparison.OrdinalIgnoreCase)
            && candidateUri.Port == allowedOrigin.Port;
    }
}
