using BoxingCoach.Desktop.Services;

var directory = Path.Combine(Path.GetTempPath(), "BoxingCoach", "dpapi-smoke", Guid.NewGuid().ToString("N"));
var path = Path.Combine(directory, "session.bin");
try
{
    var worker = WorkerStatus.Parse("""
        {"status":"ok","service":"boxing-coach-local","version":"0.3.0",
         "capabilities":{"contract_version":1,"engine_version":"0.3.0","analysis":{"available":false,"status":"not_installed"}}}
        """);
    if (!worker.Available || worker.EngineVersion != "0.3.0"
        || worker.Capabilities!.Value.GetProperty("analysis").GetProperty("available").GetBoolean())
        throw new InvalidOperationException("Worker health contract was not preserved.");
    if (WorkerStatus.Parse("""
        {"status":"ok","service":"boxing-coach-local","version":"0.3.0",
         "capabilities":{"contract_version":2,"engine_version":"0.3.0"}}
        """).Available)
        throw new InvalidOperationException("Unsupported worker contract was accepted.");

    var store = new DpapiSessionStore(path);
    var expected = new AuthSession("access-token", "refresh-token", 1234567890);
    store.Save(expected);
    var loaded = store.Load();
    if (loaded != expected)
    {
        throw new InvalidOperationException("DPAPI session round trip failed.");
    }

    store.Clear();
    if (store.Load() is not null)
    {
        throw new InvalidOperationException("DPAPI session clear failed.");
    }

    var origin = new Uri("http://127.0.0.1:54321");
    if (!LocalOriginPolicy.IsSameOrigin(origin, "http://127.0.0.1:54321/dashboard"))
    {
        throw new InvalidOperationException("Expected local navigation to be allowed.");
    }
    if (LocalOriginPolicy.IsSameOrigin(origin, "http://127.0.0.1:54321@evil.example/"))
    {
        throw new InvalidOperationException("User-info origin bypass was accepted.");
    }
    if (LocalOriginPolicy.IsSameOrigin(origin, "http://127.0.0.1.evil.example:54321/"))
    {
        throw new InvalidOperationException("Host suffix origin bypass was accepted.");
    }
    var hostedOrigin = new Uri("https://app.boxingcoach.example");
    if (!LocalOriginPolicy.IsAllowed(
            new[] { origin, hostedOrigin },
            "https://app.boxingcoach.example/platform"))
    {
        throw new InvalidOperationException("Expected hosted application origin to be allowed.");
    }
    if (LocalOriginPolicy.IsAllowed(
            new[] { origin, hostedOrigin },
            "https://app.boxingcoach.example.evil.invalid/"))
    {
        throw new InvalidOperationException("Hosted origin suffix bypass was accepted.");
    }

    if (!LocalApiPolicy.TryMap(
            new Uri("https://app.boxingcoach.example/__local_api/recordings/convert"),
            "POST",
            out var localApiPath)
        || localApiPath != "/api/recordings/convert")
    {
        throw new InvalidOperationException("Approved recording route was not mapped.");
    }
    if (LocalApiPolicy.TryMap(
            new Uri("https://app.boxingcoach.example/__local_api/members"),
            "GET",
            out _))
    {
        throw new InvalidOperationException("Central member API was exposed through the local proxy.");
    }
    if (LocalApiPolicy.TryMap(
            new Uri("https://app.boxingcoach.example/__local_api/recordings/convert"),
            "GET",
            out _))
    {
        throw new InvalidOperationException("Recording route accepted an invalid method.");
    }
    foreach (var retiredPath in new[] { "/pose/3d", "/system/pose3d", "/calibration/human" })
    {
        foreach (var method in new[] { "GET", "POST" })
        {
            if (LocalApiPolicy.TryMap(new Uri($"https://app.boxingcoach.example/__local_api{retiredPath}"), method, out _))
            {
                throw new InvalidOperationException("Retired analysis route was exposed through the local proxy.");
            }
        }
    }

    if (!BridgeMessagePolicy.IsRequestIdAllowed("request-123")
        || BridgeMessagePolicy.IsRequestIdAllowed("../invalid")
        || BridgeMessagePolicy.IsTypeAllowed("local.exec")
        || !BridgeMessagePolicy.IsTypeAllowed("platform.get"))
    {
        throw new InvalidOperationException("Native bridge message policy failed.");
    }

    Console.WriteLine("DPAPI session storage smoke test passed.");
    Console.WriteLine("Local origin policy smoke test passed.");
    Console.WriteLine("Hosted bridge policy smoke test passed.");
}
finally
{
    if (Directory.Exists(directory))
    {
        Directory.Delete(directory, true);
    }
}
