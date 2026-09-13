using System.Text.RegularExpressions;

namespace BoxingCoach.Desktop.Services;

internal static partial class BridgeMessagePolicy
{
    public const int ProtocolVersion = 1;
    public const int MaximumMessageCharacters = 64 * 1024;

    private static readonly HashSet<string> AllowedTypes = new(StringComparer.Ordinal)
    {
        "auth.get",
        "auth.set",
        "auth.clear",
        "platform.get",
    };

    public static bool IsMessageSizeAllowed(string message) =>
        message.Length is > 0 and <= MaximumMessageCharacters;

    public static bool IsRequestIdAllowed(string requestId) =>
        RequestIdPattern().IsMatch(requestId);

    public static bool IsTypeAllowed(string type) => AllowedTypes.Contains(type);

    [GeneratedRegex("^[A-Za-z0-9.-]{1,100}$", RegexOptions.CultureInvariant)]
    private static partial Regex RequestIdPattern();
}
