using System.Threading;
using System.Windows;

namespace BoxingCoach.Desktop;

public partial class App : Application
{
    private Mutex? _singleInstanceMutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        DispatcherUnhandledException += (_, eventArgs) =>
        {
            DesktopDiagnostics.Write(eventArgs.Exception);
        };
        AppDomain.CurrentDomain.UnhandledException += (_, eventArgs) =>
        {
            DesktopDiagnostics.Write(eventArgs.ExceptionObject as Exception ?? new Exception(eventArgs.ExceptionObject.ToString()));
        };

        _singleInstanceMutex = new Mutex(true, @"Local\BoxingCoach.Desktop", out var isFirstInstance);
        if (!isFirstInstance)
        {
            _singleInstanceMutex.Dispose();
            _singleInstanceMutex = null;
            MessageBox.Show(
                "BoxingCoach가 이미 실행 중입니다.",
                "BoxingCoach",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            Shutdown();
            return;
        }

        base.OnStartup(e);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        if (_singleInstanceMutex is not null)
        {
            _singleInstanceMutex.ReleaseMutex();
            _singleInstanceMutex.Dispose();
        }

        base.OnExit(e);
    }
}
