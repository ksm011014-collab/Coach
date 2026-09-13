using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;

namespace BoxingCoach.Desktop.Services;

internal sealed class LocalBackendProcess : IDisposable
{
    private const string ReadyPrefix = "BOXING_COACH_READY ";
    private readonly Process _process;
    private readonly WindowsJobObject _jobObject;
    private bool _disposed;

    private LocalBackendProcess(Process process, WindowsJobObject jobObject, Uri appUri)
    {
        _process = process;
        _jobObject = jobObject;
        AppUri = appUri;
    }

    public Uri AppUri { get; }
    public int ProcessId => _process.Id;

    public static async Task<LocalBackendProcess> StartAsync(
        TimeSpan timeout,
        IReadOnlyDictionary<string, string>? workerEnvironment = null)
    {
        var startInfo = BuildStartInfo(workerEnvironment);
        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        var stderr = new StringBuilder();
        process.ErrorDataReceived += (_, eventArgs) =>
        {
            if (!string.IsNullOrWhiteSpace(eventArgs.Data))
            {
                stderr.AppendLine(eventArgs.Data);
            }
        };

        if (!process.Start())
        {
            process.Dispose();
            throw new InvalidOperationException("로컬 AI 엔진 프로세스를 실행하지 못했습니다.");
        }

        var jobObject = new WindowsJobObject();
        try
        {
            jobObject.AddProcess(process);
            process.BeginErrorReadLine();
            using var timeoutSource = new CancellationTokenSource(timeout);

            while (true)
            {
                var line = await process.StandardOutput.ReadLineAsync(timeoutSource.Token);
                if (line is null)
                {
                    throw new InvalidOperationException(
                        $"로컬 AI 엔진이 준비되기 전에 종료되었습니다.\n{stderr}".Trim());
                }

                if (!line.StartsWith(ReadyPrefix, StringComparison.Ordinal))
                {
                    continue;
                }

                var payload = JsonSerializer.Deserialize<ReadyPayload>(
                    line[ReadyPrefix.Length..],
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (payload?.Url is null || !Uri.TryCreate(payload.Url, UriKind.Absolute, out var appUri))
                {
                    throw new InvalidOperationException("로컬 AI 엔진이 잘못된 준비 정보를 반환했습니다.");
                }

                return new LocalBackendProcess(process, jobObject, appUri);
            }
        }
        catch
        {
            TryTerminate(process);
            jobObject.Dispose();
            process.Dispose();
            throw;
        }
    }

    private static ProcessStartInfo BuildStartInfo(IReadOnlyDictionary<string, string>? workerEnvironment)
    {
        var configuredWorker = Environment.GetEnvironmentVariable("BOXING_COACH_WORKER");
        var packagedWorker = Path.Combine(AppContext.BaseDirectory, "worker", "BoxingCoach.Worker.exe");
        ProcessStartInfo startInfo;

        if (!string.IsNullOrWhiteSpace(configuredWorker) || File.Exists(packagedWorker))
        {
            startInfo = new ProcessStartInfo(configuredWorker ?? packagedWorker);
        }
        else
        {
            var projectRoot = FindProjectRoot();
            var python = Environment.GetEnvironmentVariable("BOXING_COACH_PYTHON") ?? "python";
            startInfo = new ProcessStartInfo(python);
            startInfo.ArgumentList.Add("-u");
            startInfo.ArgumentList.Add(Path.Combine(projectRoot, "backend", "server.py"));
            startInfo.WorkingDirectory = projectRoot;
        }

        startInfo.UseShellExecute = false;
        startInfo.CreateNoWindow = true;
        startInfo.RedirectStandardOutput = true;
        startInfo.RedirectStandardError = true;
        startInfo.StandardOutputEncoding = Encoding.UTF8;
        startInfo.StandardErrorEncoding = Encoding.UTF8;
        startInfo.Environment["BOXING_COACH_HOST"] = "127.0.0.1";
        startInfo.Environment["BOXING_COACH_PORT"] = "0";
        startInfo.Environment["BOXING_COACH_OPEN_BROWSER"] = "0";
        startInfo.Environment["PYTHONUNBUFFERED"] = "1";
        if (workerEnvironment is not null)
        {
            foreach (var (key, value) in workerEnvironment)
            {
                startInfo.Environment[key] = value;
            }
        }
        return startInfo;
    }

    private static string FindProjectRoot()
    {
        var configuredRoot = Environment.GetEnvironmentVariable("BOXING_COACH_PROJECT_ROOT");
        if (!string.IsNullOrWhiteSpace(configuredRoot) && File.Exists(Path.Combine(configuredRoot, "backend", "server.py")))
        {
            return Path.GetFullPath(configuredRoot);
        }

        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "backend", "server.py")))
            {
                return directory.FullName;
            }
        }

        throw new FileNotFoundException(
            "로컬 AI 엔진을 찾지 못했습니다. BOXING_COACH_WORKER 또는 BOXING_COACH_PROJECT_ROOT를 설정하세요.");
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        TryTerminate(_process);
        _jobObject.Dispose();
        _process.Dispose();
    }

    private static void TryTerminate(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                process.WaitForExit(3000);
            }
        }
        catch (InvalidOperationException)
        {
        }
        catch (System.ComponentModel.Win32Exception)
        {
        }
    }

    private sealed record ReadyPayload(string Url);
}
