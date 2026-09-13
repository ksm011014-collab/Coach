using System.IO;

namespace BoxingCoach.Desktop;

internal static class DesktopDiagnostics
{
    private static readonly object Sync = new();

    public static void Write(Exception error)
    {
        Write(error.ToString());
    }

    public static void Write(string message)
    {
        try
        {
            var configuredPath = Environment.GetEnvironmentVariable("BOXING_COACH_DESKTOP_LOG");
            var path = string.IsNullOrWhiteSpace(configuredPath)
                ? Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "BoxingCoach",
                    "logs",
                    "desktop.log")
                : Path.GetFullPath(configuredPath);
            var directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrWhiteSpace(directory))
            {
                Directory.CreateDirectory(directory);
            }

            lock (Sync)
            {
                File.AppendAllText(path, $"[{DateTimeOffset.Now:O}] {message}\n");
            }
        }
        catch
        {
        }
    }
}
